/**
 * Every public (non-admin) API endpoint, with sample requests. The privacy test
 * (tests/worker/public-privacy.test.ts) calls each sample and checks that no
 * personal data leaks; it also fails if a public route is missing from this list.
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
];
