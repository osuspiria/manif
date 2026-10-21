/**
 * Read side of events: builds the public GeoJSON and event sheets.
 * Knows nothing about Hono or D1 (receives a repo).
 */
import { isEventType } from '../../config/event-types';
import { nowIso, TIME_ZONES, type Tz } from '../../shared/dates';
import type { PublicEvent, PublicEventCollection, PublicOccurrence } from '../../shared/schemas';
import type { EventRow, EventsRepo, OccurrenceRow } from '../repos/events-repo';

function toTz(value: string): Tz {
  return (TIME_ZONES as readonly string[]).includes(value) ? (value as Tz) : 'Europe/Lisbon';
}

function toPublicOccurrence(o: OccurrenceRow): PublicOccurrence {
  return {
    id: o.id,
    localDate: o.local_date,
    startTime: o.start_time,
    endTime: o.end_time,
    startsAt: o.starts_at,
    endsAt: o.ends_at,
    note: o.note,
    cancelled: o.cancelled === 1,
  };
}

function toPublicEvent(e: EventRow, occurrences: OccurrenceRow[]): PublicEvent {
  return {
    id: e.id,
    type: isEventType(e.type) ? e.type : 'other',
    title: e.title,
    description: e.description,
    organizer: e.organizer,
    lat: e.lat,
    lng: e.lng,
    placeLabel: e.place_label,
    municipality: e.municipality,
    district: e.district,
    tz: toTz(e.tz),
    verified: e.verified === 1,
    ongoingSince: e.ongoing_since,
    occurrences: occurrences.map(toPublicOccurrence),
  };
}

function toCollection(events: EventRow[], occurrences: OccurrenceRow[]): PublicEventCollection {
  const byEvent = new Map<string, OccurrenceRow[]>();
  for (const o of occurrences) {
    const list = byEvent.get(o.event_id);
    if (list) list.push(o);
    else byEvent.set(o.event_id, [o]);
  }
  return {
    type: 'FeatureCollection',
    features: events.map((e) => ({
      type: 'Feature',
      id: e.id,
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      properties: toPublicEvent(e, byEvent.get(e.id) ?? []),
    })),
  };
}

export interface EventsService {
  /** All visible events with their not-yet-ended occurrences (SPEC §3.1, §4.2). */
  listVisible(now: Date): Promise<PublicEventCollection>;
  /** Events that already happened ("Já aconteceram"), with all their occurrences. */
  listPast(now: Date): Promise<PublicEventCollection>;
  /** A published event with all its occurrences (past ones included), or null. */
  getPublic(id: string): Promise<PublicEvent | null>;
}

export function createEventsService(repo: EventsRepo): EventsService {
  return {
    async listVisible(now) {
      const at = nowIso(now);
      const [events, occurrences] = await Promise.all([
        repo.listPublishedLive(at),
        repo.listOccurrencesEndingAfter(at),
      ]);
      return toCollection(events, occurrences);
    },

    async listPast(now) {
      const at = nowIso(now);
      const [events, occurrences] = await Promise.all([
        repo.listPublishedPast(at),
        repo.listPastEventOccurrences(at),
      ]);
      return toCollection(events, occurrences);
    },

    async getPublic(id) {
      const event = await repo.getPublished(id);
      if (!event) return null;
      return toPublicEvent(event, await repo.listOccurrences(id));
    },
  };
}
