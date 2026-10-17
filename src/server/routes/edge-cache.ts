import type { Context } from 'hono';
import type { Env } from '../env';

/**
 * Serves a GET response from the edge cache (Workers Cache API) for `ttl`
 * seconds, building it with `build` on a miss. Disabled unless EDGE_CACHE='on'.
 */
export async function edgeCached(
  c: Context<{ Bindings: Env }>,
  ttl: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const useCache = c.env.EDGE_CACHE === 'on' && typeof caches !== 'undefined';
  const cache = useCache ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(c.req.url, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  const res = await build();
  if (res.ok) res.headers.set('Cache-Control', `public, max-age=${ttl}`);
  if (cache && res.ok) c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
}
