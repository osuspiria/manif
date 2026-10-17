import type { Features } from '../config/app';

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
  /** Registered only when this feature is on (FEATURES). */
  feature?: keyof Features;
}

/** The public routes registered with the given features. */
export function publicRoutes(features: Features): PublicRoute[] {
  return PUBLIC_ROUTES.filter((r) => !r.feature || features[r.feature]);
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** HTML form POST (the signature form without JavaScript). */
const form = (fields: Record<string, string>): RequestInit => ({
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

const NEW_SIGNATURE = {
  kind: 'individual',
  firstName: 'Ana',
  lastName: 'Exemplo',
  email: 'ana.assina@exemplo.pt',
  municipality: '1312',
  phone: '912 000 111',
  isPublic: true,
  canContact: true,
  consent: true,
  turnstileToken: 'token',
};

const NEW_ORG_SIGNATURE = {
  kind: 'organization',
  orgName: 'Associação Fictícia de Teste',
  orgType: 'association',
  contactName: 'Pessoa Responsável Fictícia',
  email: 'geral@associacao-ficticia.pt',
  municipality: '1106',
  legitimacy: true,
  isPublic: true,
  consent: true,
  turnstileToken: 'token',
};

const NEW_EVENT = {
  type: 'rally',
  title: 'Concentração de teste',
  lat: 41.1496,
  lng: -8.6109,
  contactEmail: 'pessoa@exemplo.pt',
  occurrences: [{ localDate: '2026-11-18', startTime: '18:00', endTime: null, note: null }],
  turnstileToken: 'token',
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    method: 'POST',
    route: '/api/signatures',
    feature: 'signatures',
    samples: [
      { url: '/api/signatures', init: json(NEW_SIGNATURE) },
      { url: '/api/signatures', init: json(NEW_ORG_SIGNATURE) },
      { url: '/api/signatures', init: json({ ...NEW_SIGNATURE, municipality: 'x' }) },
      // Without JavaScript: HTML answers (validation errors; missing Turnstile token).
      {
        url: '/api/signatures',
        init: form({ kind: 'individual', email: 'sem.js@exemplo.pt', phone: '912000111' }),
      },
      {
        url: '/api/signatures',
        init: form({
          kind: 'individual',
          pseudonym: 'Sem JS',
          email: 'sem.js@exemplo.pt',
          municipality: '1312',
          consent: 'on',
        }),
      },
    ],
  },
  {
    method: 'GET',
    route: '/api/signatures/confirm',
    feature: 'signatures',
    samples: [{ url: '/api/signatures/confirm?token=nope' }],
  },
  {
    method: 'POST',
    route: '/api/signatures/withdraw',
    feature: 'signatures',
    samples: [{ url: '/api/signatures/withdraw', init: json({ token: 'x'.repeat(43) }) }],
  },
  {
    method: 'GET',
    route: '/api/signatures/stats',
    feature: 'signatures',
    samples: [{ url: '/api/signatures/stats' }],
  },
  {
    method: 'GET',
    route: '/api/signatures/public',
    feature: 'signatures',
    samples: [
      { url: '/api/signatures/public' },
      { url: '/api/signatures/public?municipality=1312' },
      { url: '/api/signatures/public?page=2' },
      { url: '/api/signatures/public?municipality=nope' },
    ],
  },
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
    route: '/api/geo/search',
    samples: [{ url: '/api/geo/search?q=Rossio' }, { url: '/api/geo/search?q=a' }],
  },
  {
    method: 'POST',
    route: '/api/events',
    samples: [
      { url: '/api/events', init: json(NEW_EVENT) },
      { url: '/api/events', init: json({ ...NEW_EVENT, title: 'x' }) },
    ],
  },
  {
    method: 'GET',
    route: '/api/events/:id/edit',
    samples: [
      { url: '/api/events/{eventId}/edit', init: { headers: { 'X-Edit-Token': 'wrong' } } },
    ],
  },
  {
    method: 'PATCH',
    route: '/api/events/:id',
    samples: [
      {
        url: '/api/events/{eventId}',
        init: json({ cancelEvent: true }, { 'X-Edit-Token': 'wrong' }),
      },
    ],
  },
  {
    method: 'POST',
    route: '/api/events/:id/report',
    samples: [{ url: '/api/events/{eventId}/report', init: json({ reason: 'fake' }) }],
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
    route: '/mapa',
    samples: [{ url: '/mapa?quando=hoje' }],
  },
  {
    method: 'GET',
    route: '/mapa/',
    samples: [{ url: '/mapa/?vista=lista' }],
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
