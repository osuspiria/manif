import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';

const get = (path: string) => app.request(`http://localhost${path}`, undefined, env);

describe('GET /map/fonts/:font/:range', () => {
  it('serves a self-hosted Latin range from the static assets', async () => {
    const res = await get('/map/fonts/Noto%20Sans%20Regular/0-255.pbf');
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('answers a range we do not host with an empty glyph set, not a 404', async () => {
    const res = await get('/map/fonts/Noto%20Sans%20Regular/1536-1791.pbf');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('still 404s for anything that is not a glyph range', async () => {
    expect((await get('/map/fonts/Noto%20Sans%20Regular/secret.txt')).status).toBe(404);
  });
});
