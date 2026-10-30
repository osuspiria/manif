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
  /** Ongoing ("sem fim"): first non-cancelled local date; null for normal events. */
  ongoing_since: string | null;
  /** Poster (SPEC §4.7). Only an approved one may reach the public API (see toPublicEvent). */
  poster_key: string | null;
  poster_status: PosterStatus | null;
  poster_width: number | null;
  poster_height: number | null;
  poster_alt: string | null;
}

export type PosterStatus = 'pending' | 'approved';

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
  e.place_label, e.municipality, e.district, e.tz, e.verified,
  e.poster_key, e.poster_status, e.poster_width, e.poster_height, e.poster_alt,
  CASE WHEN e.ongoing = 1 THEN (SELECT MIN(oo.local_date) FROM event_occurrences oo
    WHERE oo.event_id = e.id AND oo.cancelled = 0) END AS ongoing_since`;

const OCC_COLUMNS = `o.id, o.event_id, o.local_date, o.start_time, o.end_time,
  o.starts_at, o.ends_at, o.note, o.cancelled`;

export interface EventsRepo {
  /** Published events that are ongoing or have a non-cancelled occurrence ending after `nowIso`. */
  listPublishedLive(nowIso: string): Promise<EventRow[]>;
  /** Occurrences ending after `nowIso` (cancelled included) for published events. */
  listOccurrencesEndingAfter(nowIso: string): Promise<OccurrenceRow[]>;
  /** Published, not ongoing events with a non-cancelled occurrence that ended by `nowIso`. */
  listPublishedPast(nowIso: string): Promise<EventRow[]>;
  /** All occurrences (cancelled included) of the events in `listPublishedPast`. */
  listPastEventOccurrences(nowIso: string): Promise<OccurrenceRow[]>;
  getPublished(id: string): Promise<EventRow | null>;
  listOccurrences(eventId: string): Promise<OccurrenceRow[]>;
}

const PAST_EVENT = `e.status = 'published' AND e.ongoing = 0
  AND EXISTS (SELECT 1 FROM event_occurrences po
              WHERE po.event_id = e.id AND po.cancelled = 0 AND po.ends_at <= ?)`;

export function eventsRepo(db: Db): EventsRepo {
  return {
    listPublishedLive(nowIso) {
      return db.all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM events e
         WHERE e.status = 'published'
           AND (e.ongoing = 1 OR EXISTS (SELECT 1 FROM event_occurrences o
                       WHERE o.event_id = e.id AND o.cancelled = 0 AND o.ends_at > ?))`,
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
    listPublishedPast(nowIso) {
      return db.all<EventRow>(`SELECT ${EVENT_COLUMNS} FROM events e WHERE ${PAST_EVENT}`, [
        nowIso,
      ]);
    },
    listPastEventOccurrences(nowIso) {
      return db.all<OccurrenceRow>(
        `SELECT ${OCC_COLUMNS} FROM event_occurrences o
         JOIN events e ON e.id = o.event_id
         WHERE ${PAST_EVENT}
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

// --- write side ----------------------------------------------------------------

export interface NewEventRow {
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
  status: 'pending' | 'published';
  /** "Confirmado": only events created by the moderation start verified. */
  verified: 0 | 1;
  contact_email: string | null;
  edit_token_hash: string;
  created_at: string;
}

export type NewOccurrenceRow = OccurrenceRow;

/** Owner view: includes moderation fields and the token hash (never returned publicly). */
export interface OwnerEventRow extends EventRow {
  status: 'pending' | 'published' | 'hidden';
  edit_token_hash: string;
}

export interface EventFieldsUpdate {
  type: string;
  title: string;
  description: string | null;
  organizer: string | null;
  place_label: string | null;
}

export interface OccurrenceChanges {
  insert: NewOccurrenceRow[];
  update: NewOccurrenceRow[];
  remove: string[];
}

export interface EventsWriteRepo {
  insert(event: NewEventRow, occurrences: NewOccurrenceRow[]): Promise<void>;
  getOwner(id: string): Promise<OwnerEventRow | null>;
  update(
    id: string,
    fields: EventFieldsUpdate,
    changes: OccurrenceChanges,
    resetVerified: boolean,
    nowIso: string,
  ): Promise<void>;
  cancelOccurrencesEndingAfter(id: string, nowIso: string): Promise<void>;
  addReport(r: {
    id: string;
    event_id: string;
    reason: string;
    detail: string | null;
    created_at: string;
  }): Promise<number>;
  setStatus(id: string, status: 'pending' | 'published' | 'hidden', nowIso: string): Promise<void>;
  /** Sets (or, with null, clears) the poster columns. */
  setPoster(id: string, poster: PosterFields | null, nowIso: string): Promise<void>;
  setPosterStatus(id: string, status: PosterStatus, nowIso: string): Promise<void>;
  /** Event id of an approved poster of a published event, or null. */
  approvedPoster(key: string): Promise<string | null>;
}

export interface PosterFields {
  key: string;
  status: PosterStatus;
  width: number;
  height: number;
  alt: string | null;
}

const INSERT_OCC = `INSERT INTO event_occurrences (id, event_id, local_date, start_time, end_time,
  starts_at, ends_at, note, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const occParams = (o: NewOccurrenceRow) => [
  o.id,
  o.event_id,
  o.local_date,
  o.start_time,
  o.end_time,
  o.starts_at,
  o.ends_at,
  o.note,
  o.cancelled,
];

export function eventsWriteRepo(db: Db): EventsWriteRepo {
  return {
    async insert(e, occurrences) {
      await db.batch([
        {
          sql: `INSERT INTO events (id, type, title, description, organizer, lat, lng, place_label,
                  municipality, district, tz, status, verified, contact_email, edit_token_hash,
                  created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            e.id,
            e.type,
            e.title,
            e.description,
            e.organizer,
            e.lat,
            e.lng,
            e.place_label,
            e.municipality,
            e.district,
            e.tz,
            e.status,
            e.verified,
            e.contact_email,
            e.edit_token_hash,
            e.created_at,
            e.created_at,
          ],
        },
        ...occurrences.map((o) => ({ sql: INSERT_OCC, params: occParams(o) })),
      ]);
    },

    getOwner(id) {
      return db.first<OwnerEventRow>(
        `SELECT ${EVENT_COLUMNS}, e.status, e.edit_token_hash FROM events e WHERE e.id = ?`,
        [id],
      );
    },

    async update(id, f, changes, resetVerified, nowIso) {
      await db.batch([
        {
          sql: `UPDATE events SET type = ?, title = ?, description = ?, organizer = ?, place_label = ?,
                  verified = CASE WHEN ? THEN 0 ELSE verified END, updated_at = ?
                WHERE id = ?`,
          params: [
            f.type,
            f.title,
            f.description,
            f.organizer,
            f.place_label,
            resetVerified ? 1 : 0,
            nowIso,
            id,
          ],
        },
        ...changes.remove.map((occId) => ({
          sql: 'DELETE FROM event_occurrences WHERE id = ? AND event_id = ?',
          params: [occId, id],
        })),
        ...changes.update.map((o) => ({
          sql: `UPDATE event_occurrences SET local_date = ?, start_time = ?, end_time = ?, starts_at = ?,
                  ends_at = ?, note = ?, cancelled = ? WHERE id = ? AND event_id = ?`,
          params: [
            o.local_date,
            o.start_time,
            o.end_time,
            o.starts_at,
            o.ends_at,
            o.note,
            o.cancelled,
            o.id,
            id,
          ],
        })),
        ...changes.insert.map((o) => ({ sql: INSERT_OCC, params: occParams(o) })),
      ]);
    },

    async cancelOccurrencesEndingAfter(id, nowIso) {
      await db.batch([
        {
          sql: 'UPDATE event_occurrences SET cancelled = 1 WHERE event_id = ? AND ends_at > ?',
          params: [id, nowIso],
        },
        { sql: 'UPDATE events SET updated_at = ? WHERE id = ?', params: [nowIso, id] },
      ]);
    },

    async addReport(r) {
      await db.run(
        'INSERT INTO event_reports (id, event_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?)',
        [r.id, r.event_id, r.reason, r.detail, r.created_at],
      );
      const row = await db.first<{ n: number }>(
        'SELECT count(*) AS n FROM event_reports WHERE event_id = ?',
        [r.event_id],
      );
      return row?.n ?? 0;
    },

    async setStatus(id, status, nowIso) {
      await db.run('UPDATE events SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        nowIso,
        id,
      ]);
    },

    async setPoster(id, p, nowIso) {
      await db.run(
        `UPDATE events SET poster_key = ?, poster_status = ?, poster_width = ?, poster_height = ?,
           poster_alt = ?, updated_at = ? WHERE id = ?`,
        [
          p?.key ?? null,
          p?.status ?? null,
          p?.width ?? null,
          p?.height ?? null,
          p?.alt ?? null,
          nowIso,
          id,
        ],
      );
    },

    async setPosterStatus(id, status, nowIso) {
      await db.run(
        'UPDATE events SET poster_status = ?, updated_at = ? WHERE id = ? AND poster_key IS NOT NULL',
        [status, nowIso, id],
      );
    },

    async approvedPoster(key) {
      const row = await db.first<{ id: string }>(
        `SELECT id FROM events
         WHERE poster_key = ? AND poster_status = 'approved' AND status = 'published'`,
        [key],
      );
      return row?.id ?? null;
    },
  };
}
