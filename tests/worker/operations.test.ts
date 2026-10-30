/** Cron jobs (docs/decisions.md #82): retention with an alert, morning digest, admin activity. */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CRONS } from '../../src/config/app';
import { FakeMailer } from '../../src/server/mailer';
import { adminEventsRepo } from '../../src/server/repos/admin-repo';
import { d1Db } from '../../src/server/repos/db';
import { kvOpsStore } from '../../src/server/repos/ops-store';
import { r2PosterStore } from '../../src/server/repos/poster-store';
import { runScheduled } from '../../src/server/scheduled';
import { adminActivity, buildDigest, runDailyJob } from '../../src/server/services/operations';
import { IDS, insertEvent, resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 08:00 Lisbon.
const NOW = new Date('2026-11-11T08:00:00Z');
const ADMINS = 'admin@exemplo.pt, outra.admin@exemplo.pt';
let mailer: FakeMailer;

const run = (cron: string, now = NOW) =>
  runScheduled(
    cron,
    { ...env, ADMIN_EMAILS: ADMINS },
    {
      clock: () => now,
      mailer: () => mailer,
      posters: (e) => r2PosterStore(e.POSTERS),
      ops: (e) => kvOpsStore(e.RATE_LIMIT),
    },
  );
const ops = () => kvOpsStore(env.RATE_LIMIT);

beforeEach(async () => {
  await resetDb();
  mailer = new FakeMailer();
  // KV is shared between the tests of this file.
  const { keys } = await env.RATE_LIMIT.list({ prefix: 'ops:' });
  await Promise.all(keys.map((k) => env.RATE_LIMIT.delete(k.name)));
});

const none = { unverified: 0, pending: 0, reported: 0, hidden: 0, posters: 0 };

describe('buildDigest', () => {
  it('sends nothing when there is nothing to moderate (hidden events are not work)', () => {
    expect(buildDigest({ ...none, hidden: 4 }, [], 'https://exemplo.invalid')).toBeNull();
  });

  it('lists the queues that hold events, the urgent ones and a link to the admin', () => {
    const digest = buildDigest(
      { ...none, unverified: 3, posters: 1, reported: 2 },
      [{ title: 'Concentração de exemplo', startsAt: '2026-11-12T18:00:00Z' }],
      'https://exemplo.invalid',
    );
    expect(digest?.subject).toBe('Manifesta: 3 por confirmar, 2 reportados, 1 cartaz por aprovar');
    expect(digest?.text).toContain('- 3 por confirmar\n- 2 reportados\n- 1 cartaz por aprovar');
    // Lisbon time.
    expect(digest?.text).toContain('- Concentração de exemplo (qui 12 nov 2026, 18:00)');
    expect(digest?.text).toContain('Administração: https://exemplo.invalid/admin/');
  });

  it('without a known origin, points to the path', () => {
    const digest = buildDigest({ ...none, pending: 1 }, [], null);
    expect(digest?.subject).toBe('Manifesta: 1 pendente');
    expect(digest?.text).toContain('Administração: /admin/');
    expect(digest?.text).not.toContain('48 horas');
  });
});

describe('daily job', () => {
  it('records when it finished and emails nobody', async () => {
    await run(CRONS.daily);
    expect(await ops().lastRetentionAt()).toBe('2026-11-11T08:00:00Z');
    expect(mailer.sent).toEqual([]);
  });

  it('emails every admin when it fails, with the error name only, and records nothing', async () => {
    const result = await runDailyJob(
      () => Promise.reject(new TypeError('D1 broke on a row with someone@exemplo.pt')),
      {
        events: adminEventsRepo(d1Db(env.DB)),
        ops: ops(),
        mailer,
        admins: ['admin@exemplo.pt', 'outra.admin@exemplo.pt'],
        origin: 'https://exemplo.invalid',
        now: NOW,
      },
    );
    expect(result).toBeNull();
    expect(mailer.sent.map((m) => m.to)).toEqual(['admin@exemplo.pt', 'outra.admin@exemplo.pt']);
    expect(mailer.last()?.subject).toBe('Manifesta: o trabalho diário falhou');
    expect(mailer.last()?.text).toContain('"TypeError"');
    expect(mailer.last()?.text).not.toContain('someone@');
    expect(await ops().lastRetentionAt()).toBeNull();
  });
});

describe('morning digest', () => {
  it('sends nothing when there is nothing to moderate', async () => {
    await insertEvent({
      id: IDS.a,
      verified: true,
      occurrences: [{ localDate: '2026-11-12', startTime: '18:00' }],
    });
    await run(CRONS.digest);
    expect(mailer.sent).toEqual([]);
  });

  it('emails every admin the queues and the unconfirmed events starting within 48 hours', async () => {
    await insertEvent({
      id: IDS.a,
      title: 'Amanhã, por confirmar',
      occurrences: [{ localDate: '2026-11-12', startTime: '18:00' }],
    });
    await insertEvent({
      id: IDS.b,
      title: 'Daqui a um mês, por confirmar',
      occurrences: [{ localDate: '2026-12-12', startTime: '18:00' }],
    });
    await run(CRONS.digest);
    expect(mailer.sent.map((m) => m.to)).toEqual(['admin@exemplo.pt', 'outra.admin@exemplo.pt']);
    const text = mailer.last()?.text ?? '';
    expect(mailer.last()?.subject).toBe('Manifesta: 2 por confirmar');
    expect(text).toContain('- Amanhã, por confirmar (qui 12 nov 2026, 18:00)');
    expect(text).not.toContain('Daqui a um mês');
  });
});

describe('admin activity', () => {
  it('counts events created and imports per Lisbon day, and flags a stale daily job', async () => {
    // Fixtures are created at 2026-11-01T00:00:00Z (00:00 in Lisbon, winter time).
    await insertEvent({ id: IDS.a, occurrences: [{ localDate: '2026-11-20', startTime: null }] });
    await insertEvent({ id: IDS.b, occurrences: [{ localDate: '2026-11-20', startTime: null }] });
    await ops().countExtraction('2026-11-10');
    await ops().countExtraction('2026-11-10');
    const deps = { events: adminEventsRepo(d1Db(env.DB)), ops: ops(), now: NOW };

    const before = await adminActivity(deps);
    expect(before.days).toHaveLength(14);
    expect(before.days[0]?.date).toBe('2026-11-11');
    expect(before.days.find((d) => d.date === '2026-11-01')?.events).toBe(2);
    expect(before.days.find((d) => d.date === '2026-11-10')?.extractions).toBe(2);
    expect(before.dailyJobStale).toBe(true);
    expect(before.lastDailyJobAt).toBeNull();

    // Stale after 26 hours without a successful run.
    await ops().setLastRetentionAt('2026-11-10T03:17:00Z');
    const at = async (iso: string) =>
      (await adminActivity({ ...deps, now: new Date(iso) })).dailyJobStale;
    expect(await at('2026-11-11T05:17:00Z')).toBe(false);
    expect(await at('2026-11-11T05:18:00Z')).toBe(true);
    expect((await adminActivity(deps)).lastDailyJobAt).toBe('2026-11-10T03:17:00Z');
  });
});
