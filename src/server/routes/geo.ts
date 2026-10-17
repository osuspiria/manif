import { Hono } from 'hono';
import { GeoSearchQuerySchema, ReverseQuerySchema } from '../../shared/schemas';
import { requestClientKey, type AppDeps } from '../deps';
import type { Env } from '../env';
import type { GeoService } from '../services/geo-service';
import { edgeCached } from './edge-cache';

/** Searches per client per hour (the proxy shares one upstream quota). */
const SEARCH_LIMIT = 60;

export function geoRoutes(geo: GeoService, deps: AppDeps) {
  return new Hono<{ Bindings: Env }>()
    .get('/reverse', (c) => {
      const parsed = ReverseQuerySchema.safeParse(c.req.query());
      if (!parsed.success) return c.json({ error: 'invalid_query' }, 400);

      const result = geo.reverse(parsed.data.lat, parsed.data.lng);
      // Municipality boundaries change at most once a year.
      c.header('Cache-Control', 'public, max-age=86400');
      if (!result) return c.json({ error: 'outside_portugal' }, 404);
      return c.json(result);
    })
    .get('/search', async (c) => {
      const parsed = GeoSearchQuerySchema.safeParse(c.req.query());
      if (!parsed.success) return c.json({ error: 'invalid_query' }, 400);

      const now = deps.clock();
      const key = await requestClientKey(c.req.raw, c.env, now);
      if (!(await deps.rateLimiter(c.env).hit(`search:${key}`, SEARCH_LIMIT, 3600, now))) {
        return c.json({ error: 'rate_limited' }, 429);
      }
      return edgeCached(c, 86400, async () => {
        try {
          const results = await deps.placeSearch(c.env).search(parsed.data.q);
          return Response.json(results);
        } catch {
          return Response.json({ error: 'search_unavailable' }, { status: 502 });
        }
      });
    });
}
