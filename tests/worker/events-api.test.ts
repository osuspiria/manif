import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { PublicEventCollectionSchema, PublicEventSchema } from '../../src/shared/schemas';
import { IDS, insertEvent, resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
const app = createApp({ clock: () => NOW });
const get = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, env);

beforeEach(async () => {
  await resetDb();
  await insertEvent({
    id: IDS.a,
    title: 'Várias datas',
    occurrences: [
      { localDate: '2026-11-04', startTime: '18:00' }, // past
      { localDate: '2026-11-18', startTime: '18:00', endTime: '20:00' },
      { localDate: '2026-11-25', startTime: '18:00', cancelled: true },
    ],
  });
  await insertEvent({ id: IDS.b, occurrences: [{ localDate: '2026-11-01', startTime: '10:00' }] });
  await insertEvent({
    id: IDS.c,
    status: 'pending',
    occurrences: [{ localDate: '2026-11-20', startTime: '10:00' }],
  });
  await insertEvent({
    id: IDS.d,
    status: 'hidden',
    occurrences: [{ localDate: '2026-11-20', startTime: '10:00' }],
  });
  await insertEvent({
    id: IDS.e,
    occurrences: [{ localDate: '2026-11-20', startTime: '10:00', cancelled: true }],
  });
  await insertEvent({
    id: IDS.f,
    tz: 'Atlantic/Azores',
    occurrences: [{ localDate: '2026-11-14', startTime: '23:30' }],
  });
});

describe('GET /api/events.geojson', () => {
  it('returns only visible events (published + a live occurrence)', async () => {
    const res = await get('/api/events.geojson');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/geo+json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const fc = PublicEventCollectionSchema.parse(await res.json());
    expect(fc.features.map((f) => f.id).sort()).toEqual([IDS.a, IDS.f]);
  });

  it('includes only not-yet-ended occurrences, cancelled ones flagged', async () => {
    const fc = PublicEventCollectionSchema.parse(await (await get('/api/events.geojson')).json());
    const a = fc.features.find((f) => f.id === IDS.a);
    expect(a?.properties.occurrences.map((o) => [o.localDate, o.cancelled])).toEqual([
      ['2026-11-18', false],
      ['2026-11-25', true],
    ]);
  });

  it('carries geometry and the event time zone', async () => {
    const fc = PublicEventCollectionSchema.parse(await (await get('/api/events.geojson')).json());
    const f = fc.features.find((x) => x.id === IDS.f);
    expect(f?.geometry.coordinates).toEqual([-8.6109, 41.1496]);
    expect(f?.properties.tz).toBe('Atlantic/Azores');
    expect(f?.properties.occurrences[0]?.startsAt).toBe('2026-11-15T00:30:00Z');
  });
});

describe('GET /api/events/:id', () => {
  it('returns a published event with all its occurrences', async () => {
    const res = await get(`/api/events/${IDS.a}`);
    expect(res.status).toBe(200);
    const e = PublicEventSchema.parse(await res.json());
    expect(e.title).toBe('Várias datas');
    expect(e.occurrences).toHaveLength(3);
  });

  it('returns a published past event (shared links keep working)', async () => {
    expect((await get(`/api/events/${IDS.b}`)).status).toBe(200);
  });

  it.each([
    ['pending', IDS.c],
    ['hidden', IDS.d],
    ['unknown', '01JC0000000000000000000ZZZ'],
    ['malformed', 'not-an-id'],
  ])('404 for %s events', async (_label, id) => {
    const res = await get(`/api/events/${id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /mapa/e/:id (share page)', () => {
  it('serves the map page with the event title and Open Graph tags', async () => {
    const res = await get(`/mapa/e/${IDS.a}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Várias datas · ');
    expect(html).toContain('<meta property="og:title" content="Várias datas">');
    expect(html).toContain('qua, 18 nov · 18:00–20:00');
    expect(html).toContain(`/mapa/e/${IDS.a}`);
  });

  it('404s for an event that is not published', async () => {
    expect((await get(`/mapa/e/${IDS.c}`)).status).toBe(404);
  });

  it("replaces the page's own preview tags: one of each, absolute image", async () => {
    const html = await (await get(`/mapa/e/${IDS.a}`)).text();
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:image" content="http://localhost/og.png">');
    expect(html).toMatch(/<meta name="description" content="qua, 18 nov · 18:00–20:00/);
  });

  it('a failure while rendering answers with the HTML error page (500)', async () => {
    const broken = createApp({
      clock: () => {
        throw new Error('boom');
      },
    });
    const res = await broken.request(`http://localhost/mapa/e/${IDS.a}`, {}, env);
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('Algo correu mal');
  });
});

describe('GET /tiles/:file', () => {
  beforeEach(async () => {
    await env.TILES.put('test.pmtiles', new Uint8Array(Array.from({ length: 100 }, (_, i) => i)));
  });

  it('serves a byte range with 206', async () => {
    const res = await get('/tiles/test.pmtiles', { headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it('serves the whole file without a Range header', async () => {
    const res = await get('/tiles/test.pmtiles');
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('404s for missing or disallowed names', async () => {
    expect((await get('/tiles/missing.pmtiles')).status).toBe(404);
    expect((await get('/tiles/..%2Fsecret')).status).toBe(404);
    expect((await get('/tiles/test.json')).status).toBe(404);
  });
});

describe('security headers', () => {
  it('are set on API responses and on pages the Worker renders', async () => {
    for (const path of ['/api/events.geojson', `/mapa/e/${IDS.a}`, '/api/nope']) {
      const res = await get(path);
      expect(res.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options'), path).toBe('DENY');
      expect(res.headers.get('Content-Security-Policy'), path).toBe("frame-ancestors 'none'");
    }
  });
});
