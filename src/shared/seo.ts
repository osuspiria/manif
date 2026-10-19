/**
 * Structured data (schema.org JSON-LD) for search engines. Pure: `now` is
 * passed in. Dates come straight from the stored occurrence (UTC instants, or
 * the local date for all-day ones); no tz maths here.
 */
import { APP_NAME } from '../config/app';
import { nowIso } from './dates';
import type { PublicEvent, PublicOccurrence } from './schemas';

export type JsonLd = Record<string, unknown>;

/** Upcoming dates described per event page (one schema.org Event each). */
const MAX_EVENT_DATES = 10;

const SCHEDULED = 'https://schema.org/EventScheduled';
const CANCELLED = 'https://schema.org/EventCancelled';

function occurrenceDates(o: PublicOccurrence): JsonLd {
  if (o.startTime === null) return { startDate: o.localDate, endDate: o.localDate };
  return o.endTime ? { startDate: o.startsAt, endDate: o.endsAt } : { startDate: o.startsAt };
}

/**
 * schema.org Events for an event page: one per upcoming date (a multi-date
 * event is several Events with the same name and place). Without upcoming
 * dates, its last date (cancelled if it was). Only public fields are used.
 */
export function eventJsonLd(event: PublicEvent, url: string, now: Date): JsonLd[] {
  const base: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    ...(event.description ? { description: event.description } : {}),
    url,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.placeLabel ?? event.municipality,
      address: {
        '@type': 'PostalAddress',
        addressLocality: event.municipality,
        addressRegion: event.district,
        addressCountry: 'PT',
      },
      geo: { '@type': 'GeoCoordinates', latitude: event.lat, longitude: event.lng },
    },
    ...(event.organizer ? { organizer: { '@type': 'Organization', name: event.organizer } } : {}),
  };

  if (event.ongoingSince) {
    return [{ ...base, startDate: event.ongoingSince, eventStatus: SCHEDULED }];
  }

  const at = nowIso(now);
  const byStart = [...event.occurrences].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const upcoming = byStart.filter((o) => !o.cancelled && o.endsAt > at).slice(0, MAX_EVENT_DATES);
  const last = byStart.at(-1);
  const chosen = upcoming.length > 0 ? upcoming : last ? [last] : [];
  return chosen.map((o) => ({
    ...base,
    ...occurrenceDates(o),
    eventStatus: o.cancelled ? CANCELLED : SCHEDULED,
  }));
}

/** The site itself, for the home page. */
export function siteJsonLd(siteUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: APP_NAME,
    url: siteUrl,
    inLanguage: 'pt-PT',
  };
}

/** A list page (district): the event pages it links to, in order. */
export function itemListJsonLd(urls: readonly string[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: urls.map((url, i) => ({ '@type': 'ListItem', position: i + 1, url })),
  };
}

/** JSON for a <script type="application/ld+json">: no '<', so it cannot close the tag. */
export function jsonLdText(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}

export function jsonLdScript(data: JsonLd | JsonLd[]): string {
  return `<script type="application/ld+json">${jsonLdText(data)}</script>`;
}
