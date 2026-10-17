import type { Db } from './db';

/** Public columns of `events`. Personal/secret columns are never selected here. */
export interface EventRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  organizer: string | null;
  lat: number;
  lng: number;
  place_label: string | null;
  municipality: string;
  district: string;
  tz: string;
  verified: number;
}

export interface OccurrenceRow {
  id: string;
  event_id: string;
  local_date: string;
  start_time: string | null;
  end_time: string | null;
  starts_at: string;
  ends_at: string;
  note: string | null;
  cancelled: number;
}

const EVENT_COLUMNS = `e.id, e.type, e.title, e.description, e.organizer, e.lat, e.lng,
  e.place_label, e.municipality, e.district, e.tz, e.verified`;

const OCC_COLUMNS = `o.id, o.event_id, o.local_date, o.start_time, o.end_time,
  o.starts_at, o.ends_at, o.note, o.cancelled`;

export interface EventsRepo {
  /** Published events having at least one non-cancelled occurrence ending after `nowIso`. */
  listPublishedLive(nowIso: string): Promise<EventRow[]>;
  /** Occurrences ending after `nowIso` (cancelled included) for published events. */
  listOccurrencesEndingAfter(nowIso: string): Promise<OccurrenceRow[]>;
  getPublished(id: string): Promise<EventRow | null>;
  listOccurrences(eventId: string): Promise<OccurrenceRow[]>;
}

export function eventsRepo(db: Db): EventsRepo {
  return {
    listPublishedLive(nowIso) {
      return db.all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM events e
         WHERE e.status = 'published'
           AND EXISTS (SELECT 1 FROM event_occurrences o
                       WHERE o.event_id = e.id AND o.cancelled = 0 AND o.ends_at > ?)`,
        [nowIso],
      );
    },
    listOccurrencesEndingAfter(nowIso) {
      return db.all<OccurrenceRow>(
        `SELECT ${OCC_COLUMNS} FROM event_occurrences o
         JOIN events e ON e.id = o.event_id
         WHERE e.status = 'published' AND o.ends_at > ?
         ORDER BY o.starts_at`,
        [nowIso],
      );
    },
    getPublished(id) {
      return db.first<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = ? AND e.status = 'published'`,
        [id],
      );
    },
    listOccurrences(eventId) {
      return db.all<OccurrenceRow>(
        `SELECT ${OCC_COLUMNS} FROM event_occurrences o WHERE o.event_id = ? ORDER BY o.starts_at`,
        [eventId],
      );
    },
  };
}
