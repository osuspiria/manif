/**
 * Zod schemas shared by client and server. Every input is validated on the
 * server with these, even when the client already did.
 */
import { z } from 'zod';
import { LIMITS } from '../config/app';
import { EVENT_TYPE_KEYS } from '../config/event-types';
import { REPORT_REASONS } from '../config/reports';
import { TIME_ZONES } from './dates';

export const TzSchema = z.enum(TIME_ZONES);

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');

// --- Geo ---------------------------------------------------------------------

/** Query-string number: rejects empty strings (which z.coerce would turn into 0). */
const QueryNumber = (min: number, max: number) =>
  z.string().trim().min(1).transform(Number).pipe(z.number().min(min).max(max));

export const ReverseQuerySchema = z.object({
  lat: QueryNumber(-90, 90),
  lng: QueryNumber(-180, 180),
});
export type ReverseQuery = z.infer<typeof ReverseQuerySchema>;

export const ReverseResultSchema = z.object({
  municipality: z.string(),
  municipalityCode: z.string(),
  district: z.string(),
  island: z.string().nullable(),
  tz: TzSchema,
});
export type ReverseResult = z.infer<typeof ReverseResultSchema>;

// --- Events: input ---------------------------------------------------------
// Error messages are codes; the UI maps them to pt-PT text (pt.errors.codes).

/** Optional free text: trimmed; empty becomes null. */
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'too_long')
    .nullish()
    .transform((v) => (v ? v : null));

const OptionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.email('invalid_email').nullable());

const OccurrenceFields = z.object({
  localDate: LocalDate,
  startTime: LocalTime.nullable(),
  endTime: LocalTime.nullable(),
  note: OptionalText(LIMITS.occurrenceNoteMax),
});

type OccurrenceShape = { startTime: string | null; endTime: string | null };

/** end time needs a start time and must differ from it (end < start = next day). */
function occurrenceRules<T extends z.ZodType<OccurrenceShape>>(schema: T) {
  return schema
    .refine((o) => o.endTime === null || o.startTime !== null, {
      message: 'end_without_start',
      path: ['endTime'],
    })
    .refine((o) => o.endTime === null || o.endTime !== o.startTime, {
      message: 'end_equals_start',
      path: ['endTime'],
    });
}

export const OccurrenceInputSchema = occurrenceRules(OccurrenceFields);
export type OccurrenceInput = z.infer<typeof OccurrenceInputSchema>;

const EventFields = {
  type: z.enum(EVENT_TYPE_KEYS, 'required'),
  title: z.string().trim().min(LIMITS.titleMin, 'too_short').max(LIMITS.titleMax, 'too_long'),
  description: OptionalText(LIMITS.descriptionMax),
  organizer: OptionalText(LIMITS.titleMax),
  placeLabel: OptionalText(LIMITS.titleMax),
};

export const EventInputSchema = z.object({
  ...EventFields,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  contactEmail: OptionalEmail,
  occurrences: z
    .array(OccurrenceInputSchema)
    .min(LIMITS.occurrencesMin, 'required')
    .max(LIMITS.occurrencesMax, 'too_many_occurrences'),
});
export type EventInput = z.infer<typeof EventInputSchema>;

/** POST /api/events body. `website` is the honeypot and must stay empty. */
export const CreateEventRequestSchema = EventInputSchema.extend({
  turnstileToken: z.string().min(1, 'captcha_required').max(4096),
  website: z.string().max(500).optional(),
});
export type CreateEventRequest = z.input<typeof CreateEventRequestSchema>;

export const CreateEventResponseSchema = z.object({
  id: z.string(),
  editUrl: z.string(),
  status: z.enum(['pending', 'published']),
});
export type CreateEventResponse = z.infer<typeof CreateEventResponseSchema>;

/** Occurrence as edited by the owner: existing ones carry their id. */
export const EditOccurrenceSchema = occurrenceRules(
  OccurrenceFields.extend({ id: z.string().max(40).optional(), cancelled: z.boolean() }),
);
export type EditOccurrence = z.infer<typeof EditOccurrenceSchema>;

/** PATCH /api/events/:id bodies (header X-Edit-Token): update, or cancel everything. */
export const UpdateEventRequestSchema = z.object({
  ...EventFields,
  occurrences: z
    .array(EditOccurrenceSchema)
    .min(LIMITS.occurrencesMin, 'required')
    .max(LIMITS.occurrencesMax, 'too_many_occurrences'),
});
export const CancelEventRequestSchema = z.object({ cancelEvent: z.literal(true) });

/** Picks the right schema explicitly: a Zod union would hide the per-field errors. */
export function editRequestSchema(body: unknown) {
  return body && typeof body === 'object' && 'cancelEvent' in body
    ? CancelEventRequestSchema
    : UpdateEventRequestSchema;
}
export const EditEventRequestSchema = z.union([CancelEventRequestSchema, UpdateEventRequestSchema]);
export type EditEventRequest = z.input<typeof EditEventRequestSchema>;

export const ReportRequestSchema = z.object({
  reason: z.enum(REPORT_REASONS, 'required'),
  detail: OptionalText(500),
});
export type ReportRequest = z.input<typeof ReportRequestSchema>;

// --- Geo search --------------------------------------------------------------

export const GeoSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'too_short').max(100, 'too_long'),
});

export const PlaceResultSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type PlaceResult = z.infer<typeof PlaceResultSchema>;

// --- Public event (API output) ------------------------------------------------
// Whitelist of fields that may leave the public API. Never add contact_email,
// edit_token_hash or anything personal here.

export const PublicOccurrenceSchema = z.object({
  id: z.string(),
  localDate: LocalDate,
  startTime: LocalTime.nullable(),
  endTime: LocalTime.nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  note: z.string().nullable(),
  cancelled: z.boolean(),
});
export type PublicOccurrence = z.infer<typeof PublicOccurrenceSchema>;

export const PublicEventSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPE_KEYS),
  title: z.string(),
  description: z.string().nullable(),
  organizer: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  placeLabel: z.string().nullable(),
  municipality: z.string(),
  district: z.string(),
  tz: TzSchema,
  verified: z.boolean(),
  occurrences: z.array(PublicOccurrenceSchema),
});
export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const PublicEventCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: z.string(),
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: PublicEventSchema,
    }),
  ),
});
export type PublicEventCollection = z.infer<typeof PublicEventCollectionSchema>;

/** GET /api/events/:id/edit (owner only): public fields + moderation status. */
export const EditableEventSchema = PublicEventSchema.extend({
  status: z.enum(['pending', 'published', 'hidden']),
});
export type EditableEvent = z.infer<typeof EditableEventSchema>;

/** API validation error: issues carry a path and a code (see pt.errors.codes). */
export interface ApiIssue {
  path: (string | number)[];
  code: string;
}
