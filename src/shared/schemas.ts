/**
 * Zod schemas shared by client and server. Every input is validated on the
 * server with these, even when the client already did.
 */
import { z } from 'zod';
import { LIMITS } from '../config/app';
import { EVENT_TYPE_KEYS } from '../config/event-types';
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

// --- Events (used from phase 4) ------------------------------------------------

export const OccurrenceInputSchema = z
  .object({
    localDate: LocalDate,
    startTime: LocalTime.nullable(),
    endTime: LocalTime.nullable(),
    note: z.string().trim().max(LIMITS.occurrenceNoteMax).nullable(),
  })
  .refine((o) => o.endTime === null || o.startTime !== null, {
    message: 'end_without_start',
    path: ['endTime'],
  })
  .refine((o) => o.endTime === null || o.endTime !== o.startTime, {
    message: 'end_equals_start',
    path: ['endTime'],
  });
export type OccurrenceInput = z.infer<typeof OccurrenceInputSchema>;

export const EventInputSchema = z.object({
  type: z.enum(EVENT_TYPE_KEYS),
  title: z.string().trim().min(LIMITS.titleMin).max(LIMITS.titleMax),
  description: z.string().trim().max(LIMITS.descriptionMax).nullable(),
  organizer: z.string().trim().max(LIMITS.titleMax).nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  placeLabel: z.string().trim().max(LIMITS.titleMax).nullable(),
  contactEmail: z.email().nullable(),
  occurrences: z.array(OccurrenceInputSchema).min(LIMITS.occurrencesMin).max(LIMITS.occurrencesMax),
});
export type EventInput = z.infer<typeof EventInputSchema>;

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
