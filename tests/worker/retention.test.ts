import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { retentionRepo } from '../../src/server/repos/admin-repo';
import { d1Db } from '../../src/server/repos/db';
import { runRetention } from '../../src/server/services/retention';
import { IDS, insertEvent, insertReport, insertSignature, resetDb, SENTINELS } from './fixtures';

// 20 Dec 2026, 10:00 Lisbon: 30 days back is 20 Nov.
const NOW = new Date('2026-12-20T10:00:00Z');
const repo = () => retentionRepo(d1Db(env.DB));

const ids = async (table: string) =>
  (await env.DB.prepare(`SELECT id FROM ${table} ORDER BY id`).all<{ id: string }>()).results.map(
    (r) => r.id,
  );

beforeEach(resetDb);

describe('retention job (SPEC §7)', () => {
  it('deletes unconfirmed signatures older than 7 days, keeps the rest', async () => {
    await insertSignature({
      id: 'old-unconfirmed',
      status: 'unconfirmed',
      createdAt: '2026-12-13T09:00:00Z',
    });
    await insertSignature({
      id: 'new-unconfirmed',
      status: 'unconfirmed',
      createdAt: '2026-12-13T11:00:00Z',
    });
    await insertSignature({ id: 'old-confirmed', createdAt: '2026-01-01T00:00:00Z' });
    const r = await runRetention(repo(), NOW, null);
    expect(r.unconfirmedSignatures).toBe(1);
    expect(await ids('signatures')).toEqual(['new-unconfirmed', 'old-confirmed']);
  });

  it('30 days after the last occurrence, deletes unpublished events with occurrences and reports', async () => {
    await insertEvent({
      id: IDS.a,
      status: 'pending',
      occurrences: [{ localDate: '2026-11-15', startTime: '18:00' }],
    });
    await insertReport(IDS.a);
    await insertEvent({
      id: IDS.b,
      status: 'hidden',
      occurrences: [{ localDate: '2026-11-25', startTime: '18:00' }],
    });
    await insertEvent({
      id: IDS.c,
      status: 'hidden',
      occurrences: [
        { localDate: '2026-11-02', startTime: '18:00' },
        { localDate: '2027-01-10', startTime: '18:00' },
      ],
    });
    await insertEvent({
      id: IDS.d,
      status: 'hidden',
      occurrences: [{ localDate: '2026-11-10', startTime: null }],
    });
    const r = await runRetention(repo(), NOW, null);
    expect(r.events).toBe(2);
    expect(await ids('events')).toEqual([IDS.b, IDS.c]);
    const orphans = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM event_occurrences WHERE event_id IN (?, ?)) +
              (SELECT COUNT(*) FROM event_reports WHERE event_id IN (?, ?)) AS n`,
    )
      .bind(IDS.a, IDS.d, IDS.a, IDS.d)
      .first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });

  it('keeps published past events ("Já aconteceram") but strips contact email, edit link and reports', async () => {
    await insertEvent({
      id: IDS.a,
      occurrences: [{ localDate: '2026-11-15', startTime: '18:00' }],
    });
    await insertReport(IDS.a);
    // Ended less than 30 days ago: untouched.
    await insertEvent({
      id: IDS.b,
      occurrences: [{ localDate: '2026-11-25', startTime: '18:00' }],
    });
    await insertReport(IDS.b);

    const r = await runRetention(repo(), NOW, null);
    expect(r).toMatchObject({ events: 0, anonymizedEvents: 1 });
    expect(await ids('events')).toEqual([IDS.a, IDS.b]);

    const row = (id: string) =>
      env.DB.prepare(
        `SELECT contact_email, edit_token_hash,
           (SELECT COUNT(*) FROM event_occurrences WHERE event_id = e.id) AS occurrences,
           (SELECT COUNT(*) FROM event_reports WHERE event_id = e.id) AS reports
         FROM events e WHERE id = ?`,
      )
        .bind(id)
        .first();
    expect(await row(IDS.a)).toEqual({
      contact_email: null,
      edit_token_hash: '',
      occurrences: 1,
      reports: 0,
    });
    expect(await row(IDS.b)).toEqual({
      contact_email: SENTINELS.contactEmail,
      edit_token_hash: SENTINELS.editTokenHash,
      occurrences: 1,
      reports: 1,
    });

    // Idempotent: nothing left to clean the next day.
    expect((await runRetention(repo(), NOW, null)).anonymizedEvents).toBe(0);
  });

  it('keeps ongoing ("sem fim") events, whatever their dates', async () => {
    await insertEvent({
      id: IDS.a,
      ongoing: true,
      occurrences: [{ localDate: '2026-01-15', startTime: null }],
    });
    await insertEvent({
      id: IDS.b,
      ongoing: true,
      status: 'hidden',
      occurrences: [{ localDate: '2026-01-15', startTime: null }],
    });
    expect(await runRetention(repo(), NOW, null)).toMatchObject({ events: 0, anonymizedEvents: 0 });
    expect(await ids('events')).toEqual([IDS.a, IDS.b]);
  });

  it('keeps signatures until N months after CAMPAIGN_END, then deletes them all', async () => {
    await insertSignature({ id: 's1' });
    await insertSignature({ id: 's2', kind: 'organization', status: 'approved' });
    expect((await runRetention(repo(), NOW, null)).campaignSignatures).toBe(0);
    expect((await runRetention(repo(), NOW, '2026-06-20')).campaignSignatures).toBe(0);
    expect(await ids('signatures')).toHaveLength(2);
    expect((await runRetention(repo(), NOW, '2026-06-19')).campaignSignatures).toBe(2);
    expect(await ids('signatures')).toEqual([]);
  });

  it('removes expired admin login links and sessions', async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO admin_login_tokens VALUES ('t-old', 'a@b.pt', '2026-12-20T09:00:00Z', '2026-12-20T09:15:00Z')",
      ),
      env.DB.prepare(
        "INSERT INTO admin_login_tokens VALUES ('t-new', 'a@b.pt', '2026-12-20T09:50:00Z', '2026-12-20T10:05:00Z')",
      ),
      env.DB.prepare(
        "INSERT INTO admin_sessions VALUES ('s-old', 'a@b.pt', '2026-12-19T09:00:00Z', '2026-12-20T09:00:00Z')",
      ),
    ]);
    await runRetention(repo(), NOW, null);
    const left = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM admin_login_tokens) AS t, (SELECT COUNT(*) FROM admin_sessions) AS s',
    ).first<{ t: number; s: number }>();
    expect(left).toEqual({ t: 1, s: 0 });
  });
});
