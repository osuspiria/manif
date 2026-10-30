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

describe('GET /api/past-events.geojson', () => {
  it('returns published events with an ended, non-cancelled occurrence', async () => {
    await insertEvent({
      id: IDS.g,
      status: 'hidden',
      occurrences: [{ localDate: '2026-11-01', startTime: '10:00' }],
    });
    await insertEvent({
      id: IDS.h,
      ongoing: true,
      occurrences: [{ localDate: '2026-10-01', startTime: null }],
    });
    await insertEvent({
      id: IDS.j,
      occurrences: [{ localDate: '2026-11-02', startTime: '10:00', cancelled: true }],
    });
    const res = await get('/api/past-events.geojson');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/geo+json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const fc = PublicEventCollectionSchema.parse(await res.json());
    expect(fc.features.map((f) => f.id).sort()).toEqual([IDS.a, IDS.b]);
  });

  it('includes all occurrences of each event, past and future', async () => {
    const fc = PublicEventCollectionSchema.parse(
      await (await get('/api/past-events.geojson')).json(),
    );
    const a = fc.features.find((f) => f.id === IDS.a);
    expect(a?.properties.occurrences.map((o) => o.localDate)).toEqual([
      '2026-11-04',
      '2026-11-18',
      '2026-11-25',
    ]);
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

describe('GET /mapa (old map address)', () => {
  it.each(['/mapa', '/mapa/'])(
    '%s redirects to the home page, keeping the filters',
    async (path) => {
      const res = await get(`${path}?quando=fds&tipo=rally`);
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe('/?quando=fds&tipo=rally');
    },
  );
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

  it('uses the approved poster as preview image and in the Event data, never a pending one', async () => {
    const key = `${IDS.a}/01JC0000000000000000000PST`;
    const setPoster = (status: string) =>
      env.DB.prepare(
        `UPDATE events SET poster_key = ?, poster_status = ?, poster_width = 1131,
           poster_height = 1600, poster_alt = 'Cartaz da concentração' WHERE id = ?`,
      )
        .bind(key, status, IDS.a)
        .run();

    await setPoster('pending');
    let html = await (await get(`/mapa/e/${IDS.a}`)).text();
    expect(html).toContain('<meta property="og:image" content="http://localhost/og.png">');
    expect(html).not.toContain(key);

    await setPoster('approved');
    html = await (await get(`/mapa/e/${IDS.a}`)).text();
    const image = `http://localhost/posters/${key}`;
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).toContain(`<meta property="og:image" content="${image}">`);
    expect(html).toContain('<meta property="og:image:width" content="1131">');
    expect(html).toContain('<meta property="og:image:height" content="1600">');
    expect(html).toContain('<meta property="og:image:alt" content="Cartaz da concentração">');
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    expect(JSON.parse(ld ?? '[]')[0]).toMatchObject({ image });
  });

  it('has a canonical URL, schema.org Event data and the event text for search engines', async () => {
    const html = await (await get(`/mapa/e/${IDS.a}`)).text();
    // The home page has a canonical only when dist/ was built with PUBLIC_SITE_URL
    // (not in e2e mode); the event page then points it at the event, same origin.
    const home = await (await env.ASSETS.fetch('http://localhost/')).text();
    const canonical = home.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
    expect(html.match(/rel="canonical"/g) ?? []).toHaveLength(canonical ? 1 : 0);
    if (canonical) {
      const expected = new URL(`/mapa/e/${IDS.a}`, canonical).toString();
      expect(html).toContain(`<link rel="canonical" href="${expected}">`);
    }
    expect(html).not.toContain('"@type":"WebSite"');
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    expect(JSON.parse(ld ?? 'null')).toEqual([
      expect.objectContaining({
        '@type': 'Event',
        name: 'Várias datas',
        startDate: '2026-11-18T18:00:00Z',
        url: `http://localhost/mapa/e/${IDS.a}`,
      }),
    ]);
    const noscript = html.slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'));
    expect(noscript).toContain('<h1>Várias datas</h1>');
    expect(noscript).toContain('Praça de Teste, Porto');
    expect(noscript).toContain('Descrição de teste.');
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

describe('GET /manifestacoes/:slug/ (district page)', () => {
  it("lists the district's upcoming events, linking to their pages", async () => {
    const res = await get('/manifestacoes/porto/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Manifestações no Porto</h1>');
    const list = html.slice(html.indexOf('<ol class="district-events">'), html.indexOf('</ol>'));
    // Upcoming, published, not all cancelled — in date order.
    expect(list).toContain(`href="/mapa/e/${IDS.a}"`);
    expect(list).toContain('Várias datas');
    expect(list).not.toContain(IDS.b); // past
    expect(list).not.toContain(IDS.c); // pending
    expect(list).not.toContain(IDS.d); // hidden
    expect(list).not.toContain(IDS.e); // cancelled
    const ld = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ?? 'null',
    );
    expect(ld['@type']).toBe('ItemList');
    expect(ld.itemListElement.map((i: { url: string }) => i.url)).toContain(
      `http://localhost/mapa/e/${IDS.a}`,
    );
  });

  it('says so when the district has no events', async () => {
    const html = await (await get('/manifestacoes/acores/')).text();
    expect(html).toContain('<h1>Manifestações nos Açores</h1>');
    expect(html).toContain('De momento não há eventos anunciados nos Açores.');
    expect(html).not.toContain('application/ld+json');
  });

  it('404s for an unknown district', async () => {
    expect((await get('/manifestacoes/atlantida/')).status).toBe(404);
  });

  it('shows how many events each of the other districts has', async () => {
    const html = await (await get('/manifestacoes/porto/')).text();
    expect(html).toMatch(
      /<a href="\/manifestacoes\/acores\/" class="district-link-empty">Açores<span class="visually-hidden">, 0 eventos<\/span><span class="district-count" aria-hidden="true">0<\/span><\/a>/,
    );
  });
});

describe('GET /manifestacoes/ (district index)', () => {
  it('counts the upcoming events of every district and dims the empty ones', async () => {
    const res = await get('/manifestacoes/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const html = await res.text();
    const link = (slug: string) =>
      html.match(new RegExp(`<a href="/manifestacoes/${slug}/"[^>]*>.*?</a>`))?.[0] ?? '';
    // As many as the district page lists (upcoming, published, not cancelled).
    const porto = await (await get('/manifestacoes/porto/')).text();
    const listed = porto.match(/<li><a href="\/mapa\/e\//g)?.length ?? 0;
    expect(listed).toBeGreaterThan(1);
    expect(link('porto')).toContain(
      `<span class="district-count" aria-hidden="true">${listed}</span>`,
    );
    expect(link('porto')).toContain(`, ${listed} eventos<`);
    expect(link('porto')).not.toContain('district-link-empty');
    expect(link('acores')).toContain('class="district-link-empty"');
    expect(link('acores')).toContain('>0</span>');
  });
});

describe('GET /sitemap.xml', () => {
  it('lists the home, district pages and upcoming events only', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>http://localhost/</loc>');
    expect(xml).toContain('<loc>http://localhost/manifestacoes/</loc>');
    expect(xml).toContain('<loc>http://localhost/manifestacoes/lisboa/</loc>');
    expect(xml).toContain(`<loc>http://localhost/mapa/e/${IDS.a}</loc>`);
    for (const id of [IDS.b, IDS.c, IDS.d, IDS.e]) expect(xml).not.toContain(id);
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
