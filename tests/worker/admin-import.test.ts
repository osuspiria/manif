/** Admin › Novo evento: import a draft (POST /events/extract) and publish it (POST /events). */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { FakeMailer } from '../../src/server/mailer';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import { FakeExtractor, type EventExtractor } from '../../src/server/services/event-extractor';
import {
  AdminActivitySchema,
  AdminEventDetailSchema,
  AdminExtractResponseSchema,
  PublicEventCollectionSchema,
} from '../../src/shared/schemas';
import { resetDb } from './fixtures';
import { RATE_LIMITS } from '../../src/config/app';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
const ADMIN_EMAIL = 'admin@exemplo.pt';
const adminEnv = { ...env, ADMIN_EMAILS: ADMIN_EMAIL };

let mailer: FakeMailer;
let limiter: MemoryRateLimiter;
let extractor: EventExtractor | null;
let searched: string[];
let extractCalls: { text?: string; image?: unknown; today: string }[];

const app = () =>
  createApp({
    clock: () => NOW,
    mailer: () => mailer,
    rateLimiter: () => limiter,
    extractor: () => extractor,
    placeSearch: () => ({
      search: (q: string) => {
        searched.push(q);
        return Promise.resolve([
          { label: 'Rossio, Lisboa', lat: 38.7139, lng: -9.1394 },
          { label: 'Rossio, Abrantes', lat: 39.46, lng: -8.19 },
        ]);
      },
    }),
    features: { signatures: false, privacyPage: false, eventContactEmail: true },
  });

function call(path: string, json?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'X-Admin-Request': '1' };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = `admin_session=${cookie}`;
  return app().request(
    `http://localhost${path}`,
    {
      method: json !== undefined ? 'POST' : 'GET',
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    },
    adminEnv,
  );
}

async function signIn(): Promise<string> {
  await call('/api/admin/login', { email: ADMIN_EMAIL });
  const token = /\/admin\/entrar\/#t=([\w-]+)/.exec(mailer.last()?.text ?? '')?.[1] ?? '';
  const res = await call('/api/admin/session', { token });
  return /admin_session=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
}

const fake = new FakeExtractor();

beforeEach(async () => {
  await resetDb();
  mailer = new FakeMailer();
  limiter = new MemoryRateLimiter();
  searched = [];
  extractCalls = [];
  extractor = {
    extract: (input, today) => {
      extractCalls.push({ ...input, today });
      return fake.extract(input, today);
    },
  };
});

const IMAGE = { mediaType: 'image/jpeg', data: 'aGVsbG8=' };

describe('POST /api/admin/events/extract', () => {
  it('needs a session', async () => {
    expect((await call('/api/admin/events/extract', { text: 'x' })).status).toBe(401);
    expect(extractCalls).toEqual([]);
  });

  it('reads a draft with the Lisbon date and searches its place', async () => {
    const cookie = await signIn();
    const imports = async () =>
      AdminActivitySchema.parse(await (await call('/api/admin/activity', undefined, cookie)).json())
        .days[0]?.extractions ?? 0;
    const before = await imports();
    const res = await call(
      '/api/admin/events/extract',
      { text: 'Concentração no Rossio\nsábado às 18h', image: IMAGE },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = AdminExtractResponseSchema.parse(await res.json());
    expect(body.draft.title).toBe('Concentração no Rossio');
    expect(body.draft.occurrences[0]?.localDate).toBe('2026-11-18');
    expect(body.places[0]?.label).toBe('Rossio, Lisboa');
    expect(searched).toEqual(['Rossio, Lisboa']);
    expect(extractCalls).toEqual([
      { text: 'Concentração no Rossio\nsábado às 18h', image: IMAGE, today: '2026-11-11' },
    ]);
    // Counted per Lisbon day in the admin activity (decisions #82).
    expect(await imports()).toBe(before + 1);
    expect((await call('/api/admin/activity')).status).toBe(401);
  });

  it('rejects an empty request, a text too long and an invalid or oversized image', async () => {
    const cookie = await signIn();
    for (const body of [
      {},
      { text: '   ' },
      { text: 'x'.repeat(5001) },
      { image: { mediaType: 'image/gif', data: 'aGVsbG8=' } },
      { image: { mediaType: 'image/png', data: 'não é base64' } },
      { image: { mediaType: 'image/png', data: 'A'.repeat(5_000_004) } },
    ]) {
      expect((await call('/api/admin/events/extract', body, cookie)).status).toBe(400);
    }
    expect(extractCalls).toEqual([]);
  });

  it('answers 503 when the import is not configured', async () => {
    extractor = null;
    const cookie = await signIn();
    const res = await call('/api/admin/events/extract', { text: 'x' }, cookie);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'extract_unavailable' });
  });

  it('passes on a failed or refused read as 502', async () => {
    const cookie = await signIn();
    extractor = { extract: () => Promise.resolve({ ok: false, error: 'extract_refused' }) };
    const res = await call('/api/admin/events/extract', { text: 'x' }, cookie);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'extract_refused' });
  });

  it('is rate limited per admin', async () => {
    const cookie = await signIn();
    for (let i = 0; i < RATE_LIMITS.adminExtract; i++) {
      expect((await call('/api/admin/events/extract', { text: 'x' }, cookie)).status).toBe(200);
    }
    expect((await call('/api/admin/events/extract', { text: 'x' }, cookie)).status).toBe(429);
  });
});

const NEW_EVENT = {
  type: 'rally',
  title: 'Concentração importada',
  description: 'Descrição.',
  organizer: 'Coletivo Exemplo',
  placeLabel: 'Rossio',
  lat: 38.7139,
  lng: -9.1394,
  contactEmail: 'nao.guardar@exemplo.pt',
  occurrences: [{ localDate: '2026-11-18', startTime: '18:00', endTime: '20:00', note: null }],
};

describe('POST /api/admin/events', () => {
  it('needs a session', async () => {
    expect((await call('/api/admin/events', NEW_EVENT)).status).toBe(401);
  });

  it('publishes the event as "Confirmado", without a contact email or mail', async () => {
    const cookie = await signIn();
    mailer = new FakeMailer();
    const res = await call('/api/admin/events', NEW_EVENT, cookie);
    expect(res.status).toBe(201);
    const detail = AdminEventDetailSchema.parse(await res.json());
    expect(detail).toMatchObject({
      title: 'Concentração importada',
      status: 'published',
      verified: true,
      contactEmail: null,
      municipality: 'Lisboa',
      tz: 'Europe/Lisbon',
    });
    expect(mailer.sent).toEqual([]);

    const geo = PublicEventCollectionSchema.parse(await (await call('/api/events.geojson')).json());
    expect(geo.features.map((f) => [f.id, f.properties.verified])).toEqual([[detail.id, true]]);
  });

  it('validates like the public form (fields, dates, place)', async () => {
    const cookie = await signIn();
    const bad = await call('/api/admin/events', { ...NEW_EVENT, title: 'x' }, cookie);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: { path: string[] }[] }).issues[0]?.path).toEqual([
      'title',
    ]);
    const past = await call(
      '/api/admin/events',
      { ...NEW_EVENT, occurrences: [{ ...NEW_EVENT.occurrences[0], localDate: '2026-11-01' }] },
      cookie,
    );
    expect(past.status).toBe(400);
    const outside = await call('/api/admin/events', { ...NEW_EVENT, lat: 40, lng: -15 }, cookie);
    expect(outside.status).toBe(422);
  });
});
