/** Posters (SPEC §4.7): owner upload, moderation, public files, replacement. */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../../src/config/app';
import { createApp } from '../../src/server/app';
import { FakeMailer } from '../../src/server/mailer';
import { FakeCaptcha } from '../../src/server/security/captcha';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import {
  AdminEventDetailSchema,
  AdminEventListSchema,
  CreateEventResponseSchema,
  EditableEventSchema,
  PublicEventCollectionSchema,
  PublicEventSchema,
} from '../../src/shared/schemas';
import { jpeg, webpExtended, webpLossy } from '../image-fixtures';
import { clearPosters, resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
const ADMIN_EMAIL = 'admin@exemplo.pt';
const adminEnv = { ...env, ADMIN_EMAILS: ADMIN_EMAIL };

let mailer: FakeMailer;
let limiter: MemoryRateLimiter;

const app = () =>
  createApp({
    clock: () => NOW,
    captcha: () => new FakeCaptcha(true),
    mailer: () => mailer,
    rateLimiter: () => limiter,
  });

const request = (path: string, init: RequestInit = {}) =>
  app().request(`http://localhost${path}`, init, adminEnv);

function posterBody(
  image = webpLossy(1131, 1600),
  thumb = webpLossy(226, 320),
  alt = 'Concentração pela habitação, sábado às 15h',
) {
  const body = new FormData();
  body.set('image', new File([image], 'cartaz.webp'));
  body.set('thumb', new File([thumb], 'mini.webp'));
  body.set('alt', alt);
  return body;
}

async function createEvent(): Promise<{ id: string; token: string }> {
  const res = await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'rally',
      title: 'Concentração de teste',
      lat: 41.1496,
      lng: -8.6109,
      occurrences: [{ localDate: '2026-11-18', startTime: '18:00', endTime: null, note: null }],
      turnstileToken: 'token',
      website: '',
    }),
  });
  expect(res.status).toBe(201);
  const body = CreateEventResponseSchema.parse(await res.json());
  const token = new URLSearchParams(new URL(body.editUrl).hash.slice(1)).get('t') ?? '';
  return { id: body.id, token };
}

const upload = (id: string, token: string, body = posterBody(), ip = '192.0.2.1') =>
  request(`/api/events/${id}/poster`, {
    method: 'PUT',
    headers: { 'X-Edit-Token': token, 'CF-Connecting-IP': ip },
    body,
  });

async function ownerView(id: string, token: string) {
  const res = await request(`/api/events/${id}/edit`, { headers: { 'X-Edit-Token': token } });
  return EditableEventSchema.parse(await res.json());
}

async function publicEvent(id: string) {
  return PublicEventSchema.parse(await (await request(`/api/events/${id}`)).json());
}

async function signIn(): Promise<string> {
  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
    body: JSON.stringify(body),
  });
  await request('/api/admin/login', json({ email: ADMIN_EMAIL }));
  const token = /\/admin\/entrar\/#t=([\w-]+)/.exec(mailer.last()?.text ?? '')?.[1] ?? '';
  const res = await request('/api/admin/session', json({ token }));
  return /admin_session=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
}

function admin(cookie: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', `admin_session=${cookie}`);
  headers.set('X-Admin-Request', '1');
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  return request(`/api/admin${path}`, {
    ...init,
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers,
    body,
  });
}

const moderate = (cookie: string, id: string, action: string) =>
  admin(cookie, `/events/${id}/moderate`, { json: { action } });

const storedKeys = async () => (await env.POSTERS.list()).objects.map((o) => o.key).sort();

beforeEach(async () => {
  await resetDb();
  await clearPosters();
  mailer = new FakeMailer();
  limiter = new MemoryRateLimiter();
});

describe('owner upload', () => {
  it('stores the poster as pending: the owner sees the status, the public sees nothing', async () => {
    const { id, token } = await createEvent();
    const res = await upload(id, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });

    const keys = await storedKeys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(new RegExp(`^${id}/[0-9A-Z]{26}$`));
    expect(keys[1]).toBe(`${keys[0]}/thumb`);

    const owner = await ownerView(id, token);
    expect(owner.posterStatus).toBe('pending');
    expect(owner.poster).toBeNull();
    expect((await publicEvent(id)).poster).toBeNull();
    expect((await request(`/posters/${keys[0]}`)).status).toBe(404);
  });

  it('needs the edit token', async () => {
    const { id } = await createEvent();
    expect((await upload(id, 'errado')).status).toBe(404);
    expect((await upload(id, '')).status).toBe(404);
    expect(await storedKeys()).toEqual([]);
  });

  it('rejects files that are not what the browser sends', async () => {
    const { id, token } = await createEvent();
    const cases: [FormData, string][] = [
      [posterBody(new TextEncoder().encode('<svg/>')), 'invalid_image'],
      [posterBody(webpLossy(2000, 1000)), 'image_too_large'],
      [posterBody(webpExtended(800, 1000, { exif: true })), 'exif_not_allowed'],
      [posterBody(webpLossy(800, 1000), jpeg(256, 320)), 'invalid_image'],
      [posterBody(undefined, undefined, 'x'.repeat(601)), 'alt_too_long'],
    ];
    for (const [body, error] of cases) {
      const res = await upload(id, token, body);
      expect(res.status, error).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    const missing = new FormData();
    missing.set('image', new File([webpLossy(800, 1000)], 'cartaz.webp'));
    expect((await upload(id, token, missing)).status).toBe(400);
    expect(await storedKeys()).toEqual([]);
  });

  it('is rate limited per client', async () => {
    const { id, token } = await createEvent();
    for (let i = 0; i < RATE_LIMITS.poster; i++) {
      expect((await upload(id, token)).status).toBe(200);
    }
    expect((await upload(id, token)).status).toBe(429);
    expect((await upload(id, token, posterBody(), '192.0.2.2')).status).toBe(200);
  });
});

describe('moderation', () => {
  it('approving makes the poster public: event, GeoJSON, files', async () => {
    const { id, token } = await createEvent();
    await upload(id, token);
    const cookie = await signIn();

    const queue = AdminEventListSchema.parse(
      await (await admin(cookie, '/events?filter=posters')).json(),
    );
    expect(queue.items.map((e) => [e.id, e.posterStatus])).toEqual([[id, 'pending']]);
    // The moderation sees the pending file, never cached.
    const preview = await admin(cookie, `/events/${id}/poster`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Cache-Control')).toBe('no-store');
    expect((await admin(cookie, `/events/${id}/poster/thumb`)).status).toBe(200);

    expect((await moderate(cookie, id, 'poster_approve')).status).toBe(200);
    const poster = (await publicEvent(id)).poster;
    expect(poster).toMatchObject({
      width: 1131,
      height: 1600,
      alt: 'Concentração pela habitação, sábado às 15h',
    });
    expect(poster?.thumbUrl).toBe(`${poster?.url}/thumb`);

    const fc = PublicEventCollectionSchema.parse(
      await (await request('/api/events.geojson')).json(),
    );
    expect(fc.features.find((f) => f.id === id)?.properties.poster).toEqual(poster);

    const file = await request(poster?.url ?? '');
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/webp');
    expect(file.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable');
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(webpLossy(1131, 1600));
    expect((await request(poster?.thumbUrl ?? '')).status).toBe(200);

    // Hiding the event hides its poster too.
    await moderate(cookie, id, 'hide');
    expect((await request(poster?.url ?? '')).status).toBe(404);
  });

  it('rejecting deletes the files and clears the poster', async () => {
    const { id, token } = await createEvent();
    await upload(id, token);
    const cookie = await signIn();
    const item = await (await moderate(cookie, id, 'poster_reject')).json();
    expect(item).toMatchObject({ posterStatus: null });
    expect(await storedKeys()).toEqual([]);
    expect((await ownerView(id, token)).posterStatus).toBeNull();
  });

  it('a poster put by the moderation is approved at once', async () => {
    const { id } = await createEvent();
    const cookie = await signIn();
    const res = await admin(cookie, `/events/${id}/poster`, { method: 'PUT', body: posterBody() });
    expect(res.status).toBe(200);
    const detail = AdminEventDetailSchema.parse(await res.json());
    expect(detail.posterStatus).toBe('approved');
    expect((await publicEvent(id)).poster).not.toBeNull();

    const removed = await admin(cookie, `/events/${id}/poster`, { method: 'DELETE' });
    expect(AdminEventDetailSchema.parse(await removed.json()).posterStatus).toBeNull();
    expect(await storedKeys()).toEqual([]);
  });

  it('admin poster routes need a session', async () => {
    const { id } = await createEvent();
    expect((await request(`/api/admin/events/${id}/poster`)).status).toBe(401);
    const put = await request(`/api/admin/events/${id}/poster`, {
      method: 'PUT',
      headers: { 'X-Admin-Request': '1' },
      body: posterBody(),
    });
    expect(put.status).toBe(401);
  });
});

describe('replace and remove', () => {
  it('replacing an approved poster stores a new key, deletes the old files and waits again', async () => {
    const { id, token } = await createEvent();
    await upload(id, token);
    const cookie = await signIn();
    await moderate(cookie, id, 'poster_approve');
    const old = (await publicEvent(id)).poster?.url ?? '';

    expect((await upload(id, token, posterBody(webpLossy(900, 1200)))).status).toBe(200);
    expect((await request(old)).status).toBe(404);
    expect((await publicEvent(id)).poster).toBeNull();
    const keys = await storedKeys();
    expect(keys).toHaveLength(2);
    expect(`/posters/${keys[0]}`).not.toBe(old);
    expect((await ownerView(id, token)).posterStatus).toBe('pending');
  });

  it('the owner can remove the poster', async () => {
    const { id, token } = await createEvent();
    await upload(id, token);
    const res = await request(`/api/events/${id}/poster`, {
      method: 'DELETE',
      headers: { 'X-Edit-Token': token },
    });
    expect(res.status).toBe(200);
    expect(await storedKeys()).toEqual([]);
    expect((await ownerView(id, token)).posterStatus).toBeNull();
    const wrong = await request(`/api/events/${id}/poster`, {
      method: 'DELETE',
      headers: { 'X-Edit-Token': 'errado' },
    });
    expect(wrong.status).toBe(404);
  });
});
