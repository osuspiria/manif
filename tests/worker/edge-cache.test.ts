/**
 * With EDGE_CACHE=on (production): the event list is cached at the edge, never
 * by browsers, and a write drops the cached copy so its author sees it at once.
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { FakeMailer } from '../../src/server/mailer';
import { FakeCaptcha } from '../../src/server/security/captcha';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import { PublicEventCollectionSchema } from '../../src/shared/schemas';
import { insertEvent, IDS, resetDb } from './fixtures';

const NOW = new Date('2026-11-11T10:00:00Z');
const app = createApp({
  clock: () => NOW,
  captcha: () => new FakeCaptcha(true),
  mailer: () => new FakeMailer(),
  rateLimiter: () => new MemoryRateLimiter(),
});
const prodEnv = { ...env, EDGE_CACHE: 'on' };

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await app.request(`http://localhost${path}`, init, prodEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const titles = async () =>
  PublicEventCollectionSchema.parse(await (await call('/api/events.geojson')).json()).features.map(
    (f) => f.properties.title,
  );

beforeEach(async () => {
  await resetDb();
  await (caches as unknown as { default: Cache }).default.delete(
    'http://localhost/api/events.geojson',
  );
});

describe('edge cache of the event list', () => {
  it('browsers are told not to keep it, on a miss and on a hit', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await call('/api/events.geojson');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('serves the cached copy, and a new event drops it', async () => {
    await insertEvent({
      id: IDS.a,
      title: 'Primeiro',
      occurrences: [{ localDate: '2026-11-18', startTime: '18:00' }],
    });
    expect(await titles()).toEqual(['Primeiro']);

    // Written behind the API's back: the cached copy is still served.
    await insertEvent({
      id: IDS.b,
      title: 'Escondido',
      occurrences: [{ localDate: '2026-11-18', startTime: '19:00' }],
    });
    expect(await titles()).toEqual(['Primeiro']);

    const res = await call('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'rally',
        title: 'Criado agora',
        lat: 41.1496,
        lng: -8.6109,
        occurrences: [{ localDate: '2026-11-19', startTime: '18:00', endTime: null, note: null }],
        turnstileToken: 'token',
      }),
    });
    expect(res.status).toBe(201);
    expect((await titles()).sort()).toEqual(['Criado agora', 'Escondido', 'Primeiro']);
  });
});
