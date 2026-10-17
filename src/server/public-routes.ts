/**
 * Every public (non-admin) endpoint, with sample requests. The privacy test
 * (tests/worker/public-privacy.test.ts) calls each sample against fixture data
 * and checks that no personal data leaks; it also fails if a route registered
 * in the app is missing from this list.
 *
 * Placeholders in sample URLs: {eventId} = a published event fixture,
 * {hiddenEventId} = a pending event fixture.
 */
export interface PublicRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Route pattern as registered in Hono, e.g. '/api/events/:id'. */
  route: string;
  /** Concrete requests exercising the route (success and error paths). */
  samples: { url: string; init?: RequestInit }[];
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    method: 'GET',
    route: '/api/geo/reverse',
    samples: [
      { url: '/api/geo/reverse?lat=41.1496&lng=-8.6109' },
      { url: '/api/geo/reverse?lat=37.7412&lng=-25.6756' },
      { url: '/api/geo/reverse?lat=40&lng=-15' },
      { url: '/api/geo/reverse?lat=abc' },
    ],
  },
  {
    method: 'GET',
    route: '/api/events.geojson',
    samples: [{ url: '/api/events.geojson' }],
  },
  {
    method: 'GET',
    route: '/api/events/:id',
    samples: [
      { url: '/api/events/{eventId}' },
      { url: '/api/events/{hiddenEventId}' },
      { url: '/api/events/nope' },
    ],
  },
  {
    method: 'GET',
    route: '/mapa/e/:id',
    samples: [{ url: '/mapa/e/{eventId}' }, { url: '/mapa/e/{hiddenEventId}' }],
  },
  {
    method: 'GET',
    route: '/map/fonts/:font/:range',
    samples: [{ url: '/map/fonts/Noto%20Sans%20Regular/1536-1791.pbf' }],
  },
  {
    method: 'GET',
    route: '/tiles/:file',
    samples: [{ url: '/tiles/missing.pmtiles' }],
  },
];
