import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ReverseResultSchema } from '../../src/shared/schemas';

const get = (path: string) => exports.default.fetch(`http://localhost${path}`);

async function reverse(lat: number, lng: number) {
  const res = await get(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
  expect(res.status).toBe(200);
  return ReverseResultSchema.parse(await res.json());
}

describe('GET /api/geo/reverse', () => {
  it.each([
    // [label, lat, lng, municipality, district, tz]
    ['Porto (Aliados)', 41.1496, -8.6109, 'Porto', 'Porto', 'Europe/Lisbon'],
    ['Bragança (centro)', 41.8061, -6.7567, 'Bragança', 'Bragança', 'Europe/Lisbon'],
    ['Lisboa (Praça do Comércio)', 38.7075, -9.1365, 'Lisboa', 'Lisboa', 'Europe/Lisbon'],
    ['Funchal', 32.6497, -16.9086, 'Funchal', 'Região Autónoma da Madeira', 'Atlantic/Madeira'],
    [
      'Porto Santo',
      33.0611,
      -16.3369,
      'Porto Santo',
      'Região Autónoma da Madeira',
      'Atlantic/Madeira',
    ],
    [
      'Ponta Delgada',
      37.7412,
      -25.6756,
      'Ponta Delgada',
      'Região Autónoma dos Açores',
      'Atlantic/Azores',
    ],
    [
      'Corvo (Grupo Ocidental)',
      39.6713,
      -31.1137,
      'Corvo',
      'Região Autónoma dos Açores',
      'Atlantic/Azores',
    ],
  ] as const)('%s', async (_label, lat, lng, municipality, district, tz) => {
    const r = await reverse(lat, lng);
    expect(r).toMatchObject({ municipality, district, tz });
  });

  it('includes the island name for the autonomous regions only', async () => {
    expect((await reverse(37.7412, -25.6756)).island).toBe('Ilha de São Miguel');
    expect((await reverse(41.1496, -8.6109)).island).toBeNull();
  });

  it('returns the DTMN code', async () => {
    expect((await reverse(41.1496, -8.6109)).municipalityCode).toBe('1312');
  });

  it('returns 404 for a point in the ocean', async () => {
    const res = await get('/api/geo/reverse?lat=40&lng=-15');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'outside_portugal' });
  });

  it('returns 404 for a point in Spain', async () => {
    const res = await get('/api/geo/reverse?lat=40.4168&lng=-3.7038'); // Madrid
    expect(res.status).toBe(404);
  });

  it.each([
    ['missing lng', '?lat=41'],
    ['non-numeric', '?lat=abc&lng=-8'],
    ['out of range', '?lat=200&lng=-8'],
    ['no params', ''],
    ['empty values', '?lat=&lng='],
  ])('returns 400 for invalid input (%s)', async (_label, qs) => {
    const res = await get(`/api/geo/reverse${qs}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_query' });
  });

  it('is cacheable', async () => {
    const res = await get('/api/geo/reverse?lat=41.1496&lng=-8.6109');
    expect(res.headers.get('Cache-Control')).toContain('max-age=');
  });
});

describe('API fallbacks', () => {
  it('unknown /api routes return a JSON 404', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('the migrated schema has all tables', async () => {
    const { env } = await import('cloudflare:workers');
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      'event_occurrences',
      'event_reports',
      'events',
      'signatures',
    ]);
  });
});
