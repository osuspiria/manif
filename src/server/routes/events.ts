import { Hono } from 'hono';
import type { Clock } from '../clock';
import type { Env } from '../env';
import { d1Db } from '../repos/db';
import { eventsRepo } from '../repos/events-repo';
import { createEventsService } from '../services/events-service';
import { edgeCached } from './edge-cache';

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // ULID

export function eventsRoutes(clock: Clock) {
  const service = (env: Env) => createEventsService(eventsRepo(d1Db(env.DB)));

  return new Hono<{ Bindings: Env }>()
    .get('/events.geojson', (c) =>
      edgeCached(c, 60, async () => {
        const fc = await service(c.env).listVisible(clock());
        return new Response(JSON.stringify(fc), {
          headers: { 'Content-Type': 'application/geo+json; charset=utf-8' },
        });
      }),
    )
    .get('/events/:id', async (c) => {
      const id = c.req.param('id');
      if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
      const event = await service(c.env).getPublic(id);
      if (!event) return c.json({ error: 'not_found' }, 404);
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(event);
    });
}
