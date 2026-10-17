/**
 * Serves .pmtiles archives from R2 with HTTP Range support (the PMTiles client
 * reads the archive with range requests). Same origin: no third-party tiles.
 */
import { Hono } from 'hono';
import type { Env } from '../env';

const FILE_RE = /^[a-z0-9-]+\.pmtiles$/;

function contentRange(range: R2Range, size: number): string {
  let start: number;
  let end: number;
  if ('suffix' in range && range.suffix !== undefined) {
    start = Math.max(0, size - range.suffix);
    end = size - 1;
  } else {
    const r = range as { offset?: number; length?: number };
    start = r.offset ?? 0;
    end = r.length !== undefined ? Math.min(size, start + r.length) - 1 : size - 1;
  }
  return `bytes ${start}-${end}/${size}`;
}

export function tilesRoutes() {
  return new Hono<{ Bindings: Env }>().get('/:file', async (c) => {
    const file = c.req.param('file');
    if (!FILE_RE.test(file)) return c.text('Not found', 404);

    const hasRange = c.req.header('Range') !== undefined;
    const obj = await c.env.TILES.get(file, {
      range: c.req.raw.headers,
      onlyIf: c.req.raw.headers,
    });
    if (obj === null) return c.text('Not found', 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('ETag', obj.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');

    if (!('body' in obj)) return new Response(null, { status: 304, headers });

    if (hasRange && obj.range) {
      headers.set('Content-Range', contentRange(obj.range, obj.size));
      return new Response(obj.body, { status: 206, headers });
    }
    return new Response(obj.body, { headers });
  });
}
