import { Hono } from 'hono';
import { ReverseQuerySchema } from '../../shared/schemas';
import type { Env } from '../env';
import type { GeoService } from '../services/geo-service';

export function geoRoutes(geo: GeoService) {
  return new Hono<{ Bindings: Env }>().get('/reverse', (c) => {
    const parsed = ReverseQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'invalid_query' }, 400);

    const result = geo.reverse(parsed.data.lat, parsed.data.lng);
    // Municipality boundaries change at most once a year.
    c.header('Cache-Control', 'public, max-age=86400');
    if (!result) return c.json({ error: 'outside_portugal' }, 404);
    return c.json(result);
  });
}
