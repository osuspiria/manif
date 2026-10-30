/**
 * Write side of events (SPEC §4.4, §4.5): create, edit with the secret link,
 * cancel, report. Knows nothing about Hono or D1.
 */
import { LIMITS, type ModerationMode } from '../../config/app';
import { isEventType } from '../../config/event-types';
import { pt } from '../../i18n/pt';
import { nowIso, TIME_ZONES, toUtcRange, type Tz } from '../../shared/dates';
import { checkOccurrences } from '../../shared/occurrence-rules';
import type {
  ApiIssue,
  CreateEventResponse,
  EditableEvent,
  EditEventRequestSchema,
  EventInput,
  OccurrenceInput,
  ReportRequestSchema,
} from '../../shared/schemas';
import type { Mailer } from '../mailer';
import type {
  EventsRepo,
  EventsWriteRepo,
  NewOccurrenceRow,
  OccurrenceRow,
  OwnerEventRow,
} from '../repos/events-repo';
import { hashToken, newToken, safeEqual } from '../security/tokens';
import { publicPoster } from './events-service';
import type { GeoService } from './geo-service';
import type { z } from 'zod';

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 422; error: string; issues?: ApiIssue[] };

export interface SubmissionDeps {
  read: EventsRepo;
  write: EventsWriteRepo;
  geo: GeoService;
  mailer: Mailer;
  moderation: ModerationMode;
  newId: () => string;
  now: Date;
  /** FEATURES.eventContactEmail: when false, a contact email is neither stored nor used. */
  storeContactEmail: boolean;
}

const fail = (status: 400 | 404 | 422, error: string, issues?: ApiIssue[]) =>
  ({ ok: false, status, error, issues }) as const;

function toTz(value: string): Tz {
  return (TIME_ZONES as readonly string[]).includes(value) ? (value as Tz) : 'Europe/Lisbon';
}

function occurrenceRow(
  id: string,
  eventId: string,
  o: OccurrenceInput & { cancelled?: boolean },
  tz: Tz,
): NewOccurrenceRow {
  const { startsAt, endsAt } = toUtcRange(o, tz);
  return {
    id,
    event_id: eventId,
    local_date: o.localDate,
    start_time: o.startTime,
    end_time: o.endTime,
    starts_at: startsAt,
    ends_at: endsAt,
    note: o.note,
    cancelled: o.cancelled ? 1 : 0,
  };
}

export function editUrl(origin: string, id: string, token: string): string {
  // The token goes in the fragment: never sent to the server in page requests,
  // never in logs or Referer headers.
  return `${origin}/editar/#e=${id}&t=${token}`;
}

// --- create ---------------------------------------------------------------------

/**
 * `asModerator` (admin, SPEC §6): published and "Confirmado" straight away,
 * whatever MODERATION_MODE says, and no contact email is kept or sent.
 */
export async function createEvent(
  input: EventInput,
  origin: string,
  d: SubmissionDeps,
  opts: { asModerator?: boolean } = {},
): Promise<ServiceResult<CreateEventResponse>> {
  const place = d.geo.reverse(input.lat, input.lng);
  if (!place) return fail(422, 'outside_portugal', [{ path: ['lat'], code: 'outside_portugal' }]);

  const issues = checkOccurrences(input.occurrences, place.tz, d.now);
  if (issues.length) return fail(400, 'invalid', issues);

  const id = d.newId();
  const token = newToken();
  const contactEmail = d.storeContactEmail && !opts.asModerator ? input.contactEmail : null;
  const status = d.moderation === 'pre' && !opts.asModerator ? 'pending' : 'published';
  const at = nowIso(d.now);

  await d.write.insert(
    {
      id,
      type: input.type,
      title: input.title,
      description: input.description,
      organizer: input.organizer,
      lat: input.lat,
      lng: input.lng,
      place_label: input.placeLabel,
      municipality: place.municipality,
      district: place.district,
      tz: place.tz,
      status,
      verified: opts.asModerator ? 1 : 0,
      contact_email: contactEmail,
      edit_token_hash: await hashToken(token),
      created_at: at,
    },
    input.occurrences.map((o) => occurrenceRow(d.newId(), id, o, place.tz)),
  );

  const url = editUrl(origin, id, token);
  if (contactEmail) {
    try {
      await d.mailer.send({
        to: contactEmail,
        subject: pt.email.editLinkSubject(input.title),
        text: pt.email.editLinkText(input.title, url),
      });
    } catch {
      // The event exists and the link is shown on screen; never log the address.
      console.error('edit-link email failed');
    }
  }

  return { ok: true, value: { id, editUrl: url, status } };
}

// --- owner access ---------------------------------------------------------------

/** The event if `token` is its edit token, else null. */
export async function ownerRow(
  id: string,
  token: string,
  d: SubmissionDeps,
): Promise<OwnerEventRow | null> {
  const row = await d.write.getOwner(id);
  if (!row) return null;
  return safeEqual(await hashToken(token), row.edit_token_hash) ? row : null;
}

export function toEditable(row: OwnerEventRow, occurrences: OccurrenceRow[]): EditableEvent {
  return {
    id: row.id,
    type: isEventType(row.type) ? row.type : 'other',
    title: row.title,
    description: row.description,
    organizer: row.organizer,
    lat: row.lat,
    lng: row.lng,
    placeLabel: row.place_label,
    municipality: row.municipality,
    district: row.district,
    tz: toTz(row.tz),
    verified: row.verified === 1,
    ongoingSince: row.ongoing_since,
    poster: publicPoster(row),
    posterStatus: row.poster_status,
    status: row.status,
    occurrences: occurrences.map((o) => ({
      id: o.id,
      localDate: o.local_date,
      startTime: o.start_time,
      endTime: o.end_time,
      startsAt: o.starts_at,
      endsAt: o.ends_at,
      note: o.note,
      cancelled: o.cancelled === 1,
    })),
  };
}

export async function getForOwner(
  id: string,
  token: string,
  d: SubmissionDeps,
): Promise<ServiceResult<EditableEvent>> {
  const row = await ownerRow(id, token, d);
  if (!row) return fail(404, 'not_found');
  return { ok: true, value: toEditable(row, await d.read.listOccurrences(id)) };
}

// --- edit -----------------------------------------------------------------------

export async function editEvent(
  id: string,
  token: string,
  req: z.output<typeof EditEventRequestSchema>,
  d: SubmissionDeps,
): Promise<ServiceResult<EditableEvent>> {
  const row = await ownerRow(id, token, d);
  if (!row) return fail(404, 'not_found');
  return applyEdit(row, req, d, { moderator: false });
}

/** Moderation edit (SPEC §6): same rules, but the "Confirmado" badge is kept. */
export async function moderatorEditEvent(
  id: string,
  req: z.output<typeof EditEventRequestSchema>,
  d: SubmissionDeps,
): Promise<ServiceResult<EditableEvent>> {
  const row = await d.write.getOwner(id);
  if (!row) return fail(404, 'not_found');
  return applyEdit(row, req, d, { moderator: true });
}

async function applyEdit(
  row: OwnerEventRow,
  req: z.output<typeof EditEventRequestSchema>,
  d: SubmissionDeps,
  opts: { moderator: boolean },
): Promise<ServiceResult<EditableEvent>> {
  const id = row.id;
  const at = nowIso(d.now);

  if ('cancelEvent' in req) {
    await d.write.cancelOccurrencesEndingAfter(id, at);
    return { ok: true, value: toEditable(row, await d.read.listOccurrences(id)) };
  }

  const tz = toTz(row.tz);
  const existing = new Map((await d.read.listOccurrences(id)).map((o) => [o.id, o]));
  const isPast = (o: OccurrenceRow) => o.ends_at <= at;

  // Past occurrences are history: kept as they are, whatever the client sends.
  const unknown = req.occurrences.findIndex((o) => o.id !== undefined && !existing.has(o.id));
  if (unknown >= 0)
    return fail(400, 'invalid', [{ path: ['occurrences', unknown], code: 'unknown_occurrence' }]);

  const editable = req.occurrences.filter((o) => {
    const prev = o.id ? existing.get(o.id) : undefined;
    return !prev || !isPast(prev);
  });
  const pastCount = [...existing.values()].filter(isPast).length;
  if (pastCount + editable.length > LIMITS.occurrencesMax) {
    return fail(400, 'invalid', [{ path: ['occurrences'], code: 'too_many_occurrences' }]);
  }

  const issues = checkOccurrences(req.occurrences, tz, d.now, (i) => {
    const o = req.occurrences[i];
    const prev = o?.id ? existing.get(o.id) : undefined;
    return prev !== undefined && isPast(prev);
  });
  if (issues.length) return fail(400, 'invalid', issues);

  const keptIds = new Set(editable.map((o) => o.id).filter(Boolean));
  const update: NewOccurrenceRow[] = [];
  const insert: NewOccurrenceRow[] = [];
  let substantive = false;

  for (const o of editable) {
    const next = occurrenceRow(o.id ?? d.newId(), id, o, tz);
    const prev = o.id ? existing.get(o.id) : undefined;
    if (!prev) {
      insert.push(next);
      substantive = true;
      continue;
    }
    const sameWhen =
      prev.local_date === next.local_date &&
      prev.start_time === next.start_time &&
      prev.end_time === next.end_time;
    if (!sameWhen) substantive = true;
    if (!sameWhen || prev.note !== next.note || prev.cancelled !== next.cancelled)
      update.push(next);
  }
  const remove = [...existing.values()]
    .filter((o) => !isPast(o) && !keptIds.has(o.id))
    .map((o) => o.id);
  if (remove.length) substantive = true;

  const fields = {
    type: req.type,
    title: req.title,
    description: req.description,
    organizer: req.organizer,
    place_label: req.placeLabel,
  };
  if (
    fields.type !== row.type ||
    fields.title !== row.title ||
    fields.description !== row.description ||
    fields.organizer !== row.organizer ||
    fields.place_label !== row.place_label
  ) {
    substantive = true;
  }

  // Substantive changes by the owner lose the "Confirmado" badge until moderation
  // checks again; cancelling dates does not, nor do the moderators' own edits.
  await d.write.update(id, fields, { insert, update, remove }, substantive && !opts.moderator, at);
  const updated = await d.write.getOwner(id);
  return { ok: true, value: toEditable(updated ?? row, await d.read.listOccurrences(id)) };
}

// --- report ---------------------------------------------------------------------

export async function reportEvent(
  id: string,
  req: z.output<typeof ReportRequestSchema>,
  /** false when this client already reported this event today (not counted again). */
  firstReportFromClient: boolean,
  d: SubmissionDeps,
): Promise<ServiceResult<{ received: true }>> {
  const event = await d.read.getPublished(id);
  if (!event) return fail(404, 'not_found');
  if (!firstReportFromClient) return { ok: true, value: { received: true } };

  const at = nowIso(d.now);
  const count = await d.write.addReport({
    id: d.newId(),
    event_id: id,
    reason: req.reason,
    detail: req.detail,
    created_at: at,
  });
  // SPEC §4.5: auto-hide until review.
  if (count >= LIMITS.reportsToAutoHide) await d.write.setStatus(id, 'hidden', at);
  return { ok: true, value: { received: true } };
}
