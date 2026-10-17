import { Hono } from 'hono';
import municipalities from '../../data/geo/municipalities.geo.json';
import { GEO_SNAP_METERS } from '../config/app';
import { defaultDeps, type AppDeps } from './deps';
import type { Env } from './env';
import { devRoutes } from './routes/dev';
import { eventsRoutes } from './routes/events';
import { geoRoutes } from './routes/geo';
import { glyphRoutes } from './routes/glyphs';
import { sharePageRoutes } from './routes/share-page';
import { signaturesRoutes } from './routes/signatures';
import { tilesRoutes } from './routes/tiles';
import { createGeoService, type MunicipalityCollection } from './services/geo-service';

// Built once per isolate.
const geo = createGeoService(municipalities as MunicipalityCollection, GEO_SNAP_METERS);

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const clock = deps.clock;
  const api = new Hono<{ Bindings: Env }>()
    .route('/geo', geoRoutes(geo, deps))
    .route('/', eventsRoutes(geo, deps))
    .route('/', signaturesRoutes(deps))
    .route('/dev', devRoutes());

  const app = new Hono<{ Bindings: Env }>()
    .route('/api', api)
    .route('/tiles', tilesRoutes())
    .route('/map/fonts', glyphRoutes())
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

export const app = createApp();
