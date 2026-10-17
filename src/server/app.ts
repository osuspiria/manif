import { Hono, type Context } from 'hono';
import municipalities from '../../data/geo/municipalities.geo.json';
import { GEO_SNAP_METERS } from '../config/app';
import { defaultDeps, type AppDeps } from './deps';
import type { Env } from './env';
import { adminRoutes } from './routes/admin';
import { devRoutes } from './routes/dev';
import { eventsRoutes } from './routes/events';
import { geoRoutes } from './routes/geo';
import { glyphRoutes } from './routes/glyphs';
import { sharePageRoutes } from './routes/share-page';
import { signaturesRoutes } from './routes/signatures';
import { tilesRoutes } from './routes/tiles';
import { createGeoService, type MunicipalityCollection } from './services/geo-service';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

function toHome(c: Context) {
  return c.redirect(`/${new URL(c.req.url).search}`, 301);
}

// Built once per isolate.
const geo = createGeoService(municipalities as MunicipalityCollection, GEO_SNAP_METERS);

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const clock = deps.clock;
  const api = new Hono<{ Bindings: Env }>()
    .route('/geo', geoRoutes(geo, deps))
    .route('/', eventsRoutes(geo, deps));
  // Switched off at launch (FEATURES): the routes are not even registered.
  if (deps.features.signatures) api.route('/', signaturesRoutes(deps));
  api.route('/dev', devRoutes()).route('/admin', adminRoutes(geo, deps));

  const app = new Hono<{ Bindings: Env }>()
    // Same security headers as public/_headers, for what the Worker serves itself.
    .use('*', async (c, next) => {
      await next();
      const missing = Object.entries(SECURITY_HEADERS).filter(([n]) => !c.res.headers.has(n));
      if (!missing.length) return;
      // Responses passed through from ASSETS have immutable headers: copy first.
      const res = new Response(c.res.body, c.res);
      for (const [name, value] of missing) res.headers.set(name, value);
      c.res = res;
    })
    .route('/api', api)
    .route('/tiles', tilesRoutes())
    .route('/map/fonts', glyphRoutes())
    .route('/mapa/e', sharePageRoutes(clock))
    // The map moved to the home page; old links keep their filters.
    .get('/mapa', toHome)
    .get('/mapa/', toHome);

  app.notFound((c) => {
    if (new URL(c.req.url).pathname.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });
  app.onError(async (err, c) => {
    // Never log request bodies, headers or IPs.
    console.error(err.message);
    if (new URL(c.req.url).pathname.startsWith('/api/')) {
      return c.json({ error: 'internal_error' }, 500);
    }
    // Pages the Worker renders (e.g. /mapa/e/:id): the static error page.
    try {
      const page = await c.env.ASSETS.fetch(new URL('/500.html', c.req.url));
      if (page.ok) {
        return new Response(page.body, {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    } catch {
      // Fall through to plain text.
    }
    return c.text('Erro interno.', 500);
  });
  return app;
}

export const app = createApp();
