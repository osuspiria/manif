import type { Context } from 'hono';
import type { Env } from '../env';

/**
 * What browsers get for data that changes when people add or moderate events:
 * they always ask again (cheap: the edge answers). Otherwise a browser would
 * keep showing its own stale copy right after creating or approving an event.
 */
export const BROWSER_NO_CACHE = 'public, max-age=0, must-revalidate';

type C = Context<{ Bindings: Env }>;
/** Just what a purge needs, so any route's context (admin included) fits. */
type PurgeContext = { env: Env; req: { url: string } };

function edgeCache(c: PurgeContext): Cache | null {
  const on = c.env.EDGE_CACHE === 'on' && typeof caches !== 'undefined';
  return on ? (caches as unknown as { default: Cache }).default : null;
}

function forBrowser(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', BROWSER_NO_CACHE);
  return out;
}

/**
 * Serves a GET response from the edge cache (Workers Cache API) for `ttl`
 * seconds, building it with `build` on a miss. Disabled unless EDGE_CACHE='on'.
 * Browsers are told not to keep it (BROWSER_NO_CACHE).
 */
export async function edgeCached(
  c: C,
  ttl: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache(c);
  const key = new Request(c.req.url, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(key);
    if (hit) return forBrowser(hit);
  }

  const res = await build();
  if (!res.ok) return res;
  if (cache) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set('Cache-Control', `public, max-age=${ttl}`);
    c.executionCtx.waitUntil(cache.put(key, stored));
  }
  return forBrowser(res);
}

/**
 * Drops cached copies after a write, so whoever made the change sees it at
 * once. The Cache API is per data centre: other visitors see the change when
 * their copy expires (at most `ttl`).
 */
export async function purgeEdgeCache(c: PurgeContext, paths: string[]): Promise<void> {
  const cache = edgeCache(c);
  if (!cache) return;
  await Promise.all(
    paths.map((p) =>
      cache.delete(new Request(new URL(p, c.req.url).toString(), { method: 'GET' })),
    ),
  );
}
