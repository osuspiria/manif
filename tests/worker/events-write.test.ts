import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { AppDeps } from '../../src/server/deps';
import { FakeMailer } from '../../src/server/mailer';
import { FakeCaptcha } from '../../src/server/security/captcha';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import {
  CreateEventResponseSchema,
  EditableEventSchema,
  PublicEventCollectionSchema,
} from '../../src/shared/schemas';
import { resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');

let mailer: FakeMailer;
let limiter: MemoryRateLimiter;

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    clock: () => NOW,
    captcha: () => new FakeCaptcha(true),
    mailer: () => mailer,
    rateLimiter: () => limiter,
    placeSearch: () => ({
      search: (q: string) => Promise.resolve([{ label: `Resultado ${q}`, lat: 38.71, lng: -9.14 }]),
    }),
    // The contact email is off at launch (FEATURES); these tests cover it switched on.
    features: { signatures: false, privacyPage: false, eventContactEmail: true },
    ...overrides,
  });
}

function call(
  path: string,
  init: RequestInit & { json?: unknown; ip?: string; token?: string } = {},
  opts: { app?: ReturnType<typeof makeApp>; env?: Partial<typeof env> } = {},
) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.ip) headers.set('CF-Connecting-IP', init.ip);
  if (init.token) headers.set('X-Edit-Token', init.token);
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  return (opts.app ?? makeApp()).request(
    `http://localhost${path}`,
    { ...init, headers, body },
    { ...env, ...opts.env },
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'rally',
    title: 'Concentração de teste',
    description: 'Uma descrição.',
    organizer: '',
    placeLabel: 'Praça de Teste',
    lat: 41.1496,
    lng: -8.6109,
    contactEmail: 'Pessoa@Exemplo.pt ',
    occurrences: [
      { localDate: '2026-11-12', startTime: '18:00', endTime: '20:00', note: null },
      { localDate: '2026-11-19', startTime: '18:00', endTime: '20:00', note: 'Segunda data' },
      { localDate: '2026-11-26', startTime: null, endTime: null, note: '' },
    ],
    turnstileToken: 'token-de-teste',
    website: '',
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}, app = makeApp()) {
  const res = await call('/api/events', { method: 'POST', json: validBody(overrides) }, { app });
  expect(res.status).toBe(201);
  const body = CreateEventResponseSchema.parse(await res.json());
  const token = new URLSearchParams(new URL(body.editUrl).hash.slice(1)).get('t') ?? '';
  return { ...body, token };
}

async function visibleIds(): Promise<string[]> {
  const fc = PublicEventCollectionSchema.parse(await (await call('/api/events.geojson')).json());
  return fc.features.map((f) => f.id);
}

beforeEach(async () => {
  await resetDb();
  mailer = new FakeMailer();
  limiter = new MemoryRateLimiter();
});

describe('POST /api/events', () => {
  it('creates a published event (MODERATION_MODE=post) with a secret edit link', async () => {
    const { id, editUrl, status, token } = await create();
    expect(status).toBe('published');
    expect(editUrl).toBe(`http://localhost/editar/#e=${id}&t=${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await visibleIds()).toEqual([id]);

    const row = await env.DB.prepare(
      'SELECT municipality, district, tz, contact_email, edit_token_hash, verified, organizer FROM events WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      municipality: 'Porto',
      district: 'Porto',
      tz: 'Europe/Lisbon',
      contact_email: 'pessoa@exemplo.pt',
      verified: 0,
      organizer: null,
    });
    // Only the hash is stored.
    expect(row?.edit_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.edit_token_hash).not.toBe(token);
  });

  it('emails the edit link when a contact email was given', async () => {
    const { editUrl } = await create();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()?.to).toBe('pessoa@exemplo.pt');
    expect(mailer.last()?.text).toContain(editUrl);
  });

  it('sends no email without a contact email', async () => {
    await create({ contactEmail: '' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('with the contact email switched off (launch): nothing stored, nothing emailed', async () => {
    const app = makeApp({
      features: { signatures: false, privacyPage: false, eventContactEmail: false },
    });
    const { id } = await create({ contactEmail: 'pessoa@exemplo.pt' }, app);
    const row = await env.DB.prepare('SELECT contact_email FROM events WHERE id = ?')
      .bind(id)
      .first<{ contact_email: string | null }>();
    expect(row?.contact_email).toBeNull();
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps new events pending with MODERATION_MODE=pre', async () => {
    const res = await call(
      '/api/events',
      { method: 'POST', json: validBody() },
      { env: { MODERATION_MODE: 'pre' } },
    );
    expect(res.status).toBe(201);
    expect(CreateEventResponseSchema.parse(await res.json()).status).toBe('pending');
    expect(await visibleIds()).toEqual([]);
  });

  it('derives the Azores time zone from the point', async () => {
    const { id } = await create({
      lat: 37.7412,
      lng: -25.6756,
      occurrences: [{ localDate: '2026-11-14', startTime: '23:30', endTime: null, note: null }],
    });
    const occ = await env.DB.prepare('SELECT starts_at FROM event_occurrences WHERE event_id = ?')
      .bind(id)
      .first<{ starts_at: string }>();
    expect(occ?.starts_at).toBe('2026-11-15T00:30:00Z');
  });

  it.each([
    ['title too short', { title: 'ab' }, ['title'], 'too_short'],
    ['unknown type', { type: 'party' }, ['type'], 'required'],
    ['bad email', { contactEmail: 'nope' }, ['contactEmail'], 'invalid_email'],
    [
      'end equals start',
      {
        occurrences: [
          { localDate: '2026-11-12', startTime: '18:00', endTime: '18:00', note: null },
        ],
      },
      ['occurrences', 0, 'endTime'],
      'end_equals_start',
    ],
    [
      'past date',
      { occurrences: [{ localDate: '2026-11-10', startTime: '18:00', endTime: null, note: null }] },
      ['occurrences', 0, 'localDate'],
      'occurrence_past',
    ],
    [
      'more than 12 months ahead',
      { occurrences: [{ localDate: '2027-12-01', startTime: '18:00', endTime: null, note: null }] },
      ['occurrences', 0, 'localDate'],
      'occurrence_too_far',
    ],
    [
      'more than 30 dates',
      {
        occurrences: Array.from({ length: 31 }, (_, i) => ({
          localDate: `2026-12-${String(i + 1).padStart(2, '0')}`,
          startTime: '18:00',
          endTime: null,
          note: null,
        })),
      },
      ['occurrences'],
      'too_many_occurrences',
    ],
    ['no dates', { occurrences: [] }, ['occurrences'], 'required'],
  ])('400 for %s', async (_label, overrides, path, code) => {
    const res = await call('/api/events', { method: 'POST', json: validBody(overrides) });
    expect(res.status).toBe(400);
    const body: { error: string; issues: { path: unknown[]; code: string }[] } = await res.json();
    expect(body.issues).toContainEqual({ path, code });
    expect(await visibleIds()).toEqual([]);
  });

  it('422 for a point outside Portugal', async () => {
    const res = await call('/api/events', {
      method: 'POST',
      json: validBody({ lat: 40.4168, lng: -3.7038 }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('outside_portugal');
  });

  it('rejects submissions that fill the honeypot', async () => {
    const res = await call('/api/events', {
      method: 'POST',
      json: validBody({ website: 'http://spam.example' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'rejected' });
    expect(await visibleIds()).toEqual([]);
  });

  it('rejects a failed Turnstile check', async () => {
    const res = await call(
      '/api/events',
      { method: 'POST', json: validBody() },
      { app: makeApp({ captcha: () => new FakeCaptcha(false) }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'captcha_failed' });
  });

  it('rate-limits to 5 events per hour per client', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      const r = await call(
        '/api/events',
        { method: 'POST', json: validBody(), ip: '203.0.113.7' },
        { app },
      );
      expect(r.status).toBe(201);
    }
    const sixth = await call(
      '/api/events',
      { method: 'POST', json: validBody(), ip: '203.0.113.7' },
      { app },
    );
    expect(sixth.status).toBe(429);
    const other = await call(
      '/api/events',
      { method: 'POST', json: validBody(), ip: '203.0.113.8' },
      { app },
    );
    expect(other.status).toBe(201);
  });

  it('400 for a body that is not JSON', async () => {
    const res = await call('/api/events', { method: 'POST', body: 'xpto' });
    expect(res.status).toBe(400);
  });
});

describe('owner access with the secret link', () => {
  it('GET /api/events/:id/edit returns the event with its status, not the contact email', async () => {
    const { id, token } = await create();
    const res = await call(`/api/events/${id}/edit`, { token });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('exemplo.pt');
    const e = EditableEventSchema.parse(JSON.parse(text));
    expect(e.status).toBe('published');
    expect(e.occurrences).toHaveLength(3);
  });

  it('404 with a wrong or missing token', async () => {
    const { id } = await create();
    expect((await call(`/api/events/${id}/edit`, { token: 'x'.repeat(43) })).status).toBe(404);
    expect((await call(`/api/events/${id}/edit`)).status).toBe(404);
    expect(
      (
        await call(`/api/events/${id}`, {
          method: 'PATCH',
          json: { cancelEvent: true },
          token: 'nope',
        })
      ).status,
    ).toBe(404);
  });
});

describe('PATCH /api/events/:id', () => {
  async function editable(id: string, token: string) {
    return EditableEventSchema.parse(
      await (await call(`/api/events/${id}/edit`, { token })).json(),
    );
  }
  function asEdit(e: Awaited<ReturnType<typeof editable>>) {
    return {
      type: e.type,
      title: e.title,
      description: e.description,
      organizer: e.organizer,
      placeLabel: e.placeLabel,
      occurrences: e.occurrences.map((o) => ({
        id: o.id,
        localDate: o.localDate,
        startTime: o.startTime,
        endTime: o.endTime,
        note: o.note,
        cancelled: o.cancelled,
      })),
    };
  }
  const verify = (id: string) =>
    env.DB.prepare('UPDATE events SET verified = 1 WHERE id = ?').bind(id).run();
  const verified = async (id: string) =>
    (
      await env.DB.prepare('SELECT verified FROM events WHERE id = ?')
        .bind(id)
        .first<{ verified: number }>()
    )?.verified;

  it('cancels one occurrence and keeps the "Confirmado" badge', async () => {
    const { id, token } = await create();
    await verify(id);
    const body = asEdit(await editable(id, token));
    body.occurrences[1]!.cancelled = true;

    const res = await call(`/api/events/${id}`, { method: 'PATCH', json: body, token });
    expect(res.status).toBe(200);
    const e = EditableEventSchema.parse(await res.json());
    expect(e.occurrences.map((o) => o.cancelled)).toEqual([false, true, false]);
    expect(await verified(id)).toBe(1);
  });

  it('changes, adds and removes dates; substantive changes reset "Confirmado"', async () => {
    const { id, token } = await create();
    await verify(id);
    const body = asEdit(await editable(id, token));
    body.occurrences[0]!.startTime = '19:00';
    body.occurrences.splice(2, 1);
    body.occurrences.push({
      id: undefined as unknown as string,
      localDate: '2026-12-03',
      startTime: '18:00',
      endTime: null,
      note: null,
      cancelled: false,
    });

    const res = await call(`/api/events/${id}`, { method: 'PATCH', json: body, token });
    expect(res.status).toBe(200);
    const e = EditableEventSchema.parse(await res.json());
    expect(e.occurrences.map((o) => `${o.localDate} ${o.startTime ?? '-'}`)).toEqual([
      '2026-11-12 19:00',
      '2026-11-19 18:00',
      '2026-12-03 18:00',
    ]);
    expect(e.occurrences[0]?.startsAt).toBe('2026-11-12T19:00:00Z');
    expect(await verified(id)).toBe(0);
  });

  it('keeps past occurrences untouched even if the client omits or changes them', async () => {
    // Created on 1 Nov with a date on the 4th (now past) and one on the 18th.
    const earlier = makeApp({ clock: () => new Date('2026-11-01T10:00:00Z') });
    const { id, token } = await create(
      {
        occurrences: [
          { localDate: '2026-11-04', startTime: '18:00', endTime: null, note: null },
          { localDate: '2026-11-18', startTime: '18:00', endTime: null, note: null },
        ],
      },
      earlier,
    );
    const current = await editable(id, token);
    const future = current.occurrences.find((o) => o.localDate === '2026-11-18');
    const res = await call(`/api/events/${id}`, {
      method: 'PATCH',
      token,
      json: {
        ...asEdit(current),
        occurrences: [
          { ...asEdit(current).occurrences[0], localDate: '2026-11-05' }, // past: ignored
          { ...asEdit(current).occurrences[1], id: future?.id },
        ],
      },
    });
    expect(res.status).toBe(200);
    const e = EditableEventSchema.parse(await res.json());
    expect(e.occurrences.map((o) => o.localDate)).toEqual(['2026-11-04', '2026-11-18']);

    // Omitting the past one does not delete it either.
    const res2 = await call(`/api/events/${id}`, {
      method: 'PATCH',
      token,
      json: { ...asEdit(current), occurrences: [asEdit(current).occurrences[1]] },
    });
    expect(EditableEventSchema.parse(await res2.json()).occurrences).toHaveLength(2);
  });

  it('rejects edits that move a date into the past', async () => {
    const { id, token } = await create();
    const body = asEdit(await editable(id, token));
    body.occurrences[0]!.localDate = '2026-11-01';
    const res = await call(`/api/events/${id}`, { method: 'PATCH', json: body, token });
    expect(res.status).toBe(400);
  });

  it('rejects an occurrence id from another event', async () => {
    const a = await create();
    const b = await create();
    const body = asEdit(await editable(a.id, a.token));
    body.occurrences[0]!.id = (await editable(b.id, b.token)).occurrences[0]!.id;
    const res = await call(`/api/events/${a.id}`, { method: 'PATCH', json: body, token: a.token });
    expect(res.status).toBe(400);
  });

  it('cancels the whole event: it disappears from the map', async () => {
    const { id, token } = await create();
    expect(await visibleIds()).toEqual([id]);
    const res = await call(`/api/events/${id}`, {
      method: 'PATCH',
      json: { cancelEvent: true },
      token,
    });
    expect(res.status).toBe(200);
    const e = EditableEventSchema.parse(await res.json());
    expect(e.occurrences.every((o) => o.cancelled)).toBe(true);
    expect(await visibleIds()).toEqual([]);
  });
});

describe('POST /api/events/:id/report', () => {
  it('hides an event after 3 reports from different clients', async () => {
    const { id } = await create();
    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      const r = await call(`/api/events/${id}/report`, {
        method: 'POST',
        ip,
        json: { reason: 'fake' },
      });
      expect(r.status).toBe(201);
    }
    expect(await visibleIds()).toEqual([id]);
    await call(`/api/events/${id}/report`, {
      method: 'POST',
      ip: '198.51.100.3',
      json: { reason: 'spam', detail: 'Repetido' },
    });
    expect(await visibleIds()).toEqual([]);
  });

  it('counts repeated reports from the same client once', async () => {
    const { id } = await create();
    for (let i = 0; i < 4; i++) {
      const r = await call(`/api/events/${id}/report`, {
        method: 'POST',
        ip: '198.51.100.9',
        json: { reason: 'fake' },
      });
      expect(r.status).toBe(201);
    }
    expect(await visibleIds()).toEqual([id]);
    const n = await env.DB.prepare('SELECT count(*) AS n FROM event_reports').first<{
      n: number;
    }>();
    expect(n?.n).toBe(1);
  });

  it('rate-limits reports to 10 per hour per client', async () => {
    const ids = [];
    for (let i = 0; i < 11; i++)
      ids.push((await create({}, makeApp({ rateLimiter: () => new MemoryRateLimiter() }))).id);
    const app = makeApp();
    const statuses = [];
    for (const id of ids) {
      statuses.push(
        (
          await call(
            `/api/events/${id}/report`,
            { method: 'POST', ip: '198.51.100.20', json: { reason: 'other' } },
            { app },
          )
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('400 for an unknown reason; 404 for an unknown event', async () => {
    const { id } = await create();
    expect(
      (await call(`/api/events/${id}/report`, { method: 'POST', json: { reason: 'x' } })).status,
    ).toBe(400);
    expect(
      (
        await call('/api/events/01JC0000000000000000000ZZZ/report', {
          method: 'POST',
          json: { reason: 'fake' },
        })
      ).status,
    ).toBe(404);
  });
});

describe('GET /api/geo/search', () => {
  it('proxies the search', async () => {
    const res = await call('/api/geo/search?q=Rossio');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ label: 'Resultado Rossio', lat: 38.71, lng: -9.14 }]);
  });

  it('400 for a too short query', async () => {
    expect((await call('/api/geo/search?q=a')).status).toBe(400);
  });

  it('502 when the provider fails', async () => {
    const app = makeApp({
      placeSearch: () => ({ search: () => Promise.reject(new Error('down')) }),
    });
    expect((await call('/api/geo/search?q=Rossio', {}, { app })).status).toBe(502);
  });
});
