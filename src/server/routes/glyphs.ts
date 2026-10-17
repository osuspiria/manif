/**
 * /map/fonts/:font/:range.pbf — we only self-host Latin glyph ranges. For any
 * other range (e.g. Arabic labels in Morocco) answer with an empty glyph set
 * instead of a 404, so the browser console stays clean; MapLibre then skips
 * those characters.
 */
import { Hono } from 'hono';
import type { Env } from '../env';

const RANGE_RE = /^\d+-\d+\.pbf$/;

export function glyphRoutes() {
  return new Hono<{ Bindings: Env }>().get('/:font/:range', async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404 || !RANGE_RE.test(c.req.param('range'))) return res;
    return new Response(new Uint8Array(0), {
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });
}
