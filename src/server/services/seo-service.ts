/**
 * Read side for search engines: upcoming events per district and the sitemap.
 * Knows nothing about Hono or D1 (receives the events service).
 */
import { DISTRICTS, districtPath, type District } from '../../config/districts';
import { filterEvents, type FilteredEvent } from '../../shared/event-filter';
import type { PublicEvent } from '../../shared/schemas';
import type { EventsService } from './events-service';

/** Events listed on a district page. */
const MAX_DISTRICT_EVENTS = 100;

export interface SeoService {
  /** Upcoming events in the district, by date of their next occurrence. */
  districtEvents(district: District, now: Date): Promise<FilteredEvent<PublicEvent>[]>;
  /** Paths for sitemap.xml: home, district pages, then every visible event. */
  sitemapPaths(now: Date): Promise<string[]>;
}

export function createSeoService(events: EventsService): SeoService {
  const visible = async (now: Date) =>
    (await events.listVisible(now)).features.map((f) => f.properties);

  return {
    async districtEvents(district, now) {
      const inDistrict = (await visible(now)).filter((e) => e.district === district.name);
      return filterEvents(inDistrict, { when: { kind: 'upcoming' }, types: [] }, now).slice(
        0,
        MAX_DISTRICT_EVENTS,
      );
    },

    async sitemapPaths(now) {
      const upcoming = filterEvents(
        await visible(now),
        { when: { kind: 'upcoming' }, types: [] },
        now,
      );
      return [
        '/',
        '/manifestacoes/',
        ...DISTRICTS.map(districtPath),
        ...upcoming.map((r) => `/mapa/e/${r.event.id}`),
      ];
    },
  };
}
