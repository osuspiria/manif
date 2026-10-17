import { Hono } from 'hono';
import municipalities from '../../data/geo/municipalities.geo.json';
import { GEO_SNAP_METERS } from '../config/app';
import type { Env } from './env';
import { geoRoutes } from './routes/geo';
import { createGeoService, type MunicipalityCollection } from './services/geo-service';

// Built once per isolate.
const geo = createGeoService(municipalities as MunicipalityCollection, GEO_SNAP_METERS);

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.route('/geo', geoRoutes(geo));

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  // Never log request bodies, headers or IPs.
  console.error(err.message);
  return c.json({ error: 'internal_error' }, 500);
});
