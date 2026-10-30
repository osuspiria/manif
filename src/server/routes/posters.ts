/**
 * /posters/<eventId>/<ulid>[/thumb] (SPEC §4.7): approved posters of published
 * events only. Keys change on every upload, so files never change; a day of
 * caching bounds how long a poster removed later can still be seen.
 */
import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import type { Env } from '../env';
import { d1Db } from '../repos/db';
import { eventsWriteRepo } from '../repos/events-repo';
import { posterResponse } from './poster-files';

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // ULID
export const POSTER_CACHE = 'public, max-age=86400, immutable';

export function postersRoutes(deps: AppDeps) {
  const serve = async (env: Env, eventId: string, id: string, thumb: boolean) => {
    if (!ID_RE.test(eventId) || !ID_RE.test(id)) return null;
    const key = `${eventId}/${id}`;
    if ((await eventsWriteRepo(d1Db(env.DB)).approvedPoster(key)) !== eventId) return null;
    return posterResponse(deps.posters(env), key, thumb ? 'thumb' : 'full', POSTER_CACHE);
  };
  const notFound = () => new Response('Not found', { status: 404 });
  return new Hono<{ Bindings: Env }>()
    .get('/:eventId/:id', async (c) => {
      const p = c.req.param();
      return (await serve(c.env, p.eventId, p.id, false)) ?? notFound();
    })
    .get('/:eventId/:id/thumb', async (c) => {
      const p = c.req.param();
      return (await serve(c.env, p.eventId, p.id, true)) ?? notFound();
    });
}
