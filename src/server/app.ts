import { Hono } from 'hono';
import municipalities from '../../data/geo/municipalities.geo.json';
import { GEO_SNAP_METERS } from '../config/app';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { eventsRoutes } from './routes/events';
import { geoRoutes } from './routes/geo';
import { sharePageRoutes } from './routes/share-page';
import { tilesRoutes } from './routes/tiles';
import { createGeoService, type MunicipalityCollection } from './services/geo-service';

// Built once per isolate.
const geo = createGeoService(municipalities as MunicipalityCollection, GEO_SNAP_METERS);

export interface AppDeps {
  clock: Clock;
}

export function createApp({ clock }: AppDeps) {
  const api = new Hono<{ Bindings: Env }>()
    .route('/geo', geoRoutes(geo))
    .route('/', eventsRoutes(clock));

  const app = new Hono<{ Bindings: Env }>()
    .route('/api', api)
    .route('/tiles', tilesRoutes())
    .route('/mapa/e', sharePageRoutes(clock));

  app.notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });
  app.onError((err, c) => {
    // Never log request bodies, headers or IPs.
    console.error(err.message);
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}

export const app = createApp({ clock: systemClock });
