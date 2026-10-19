/**
 * Zod schemas shared by client and server. Every input is validated on the
 * server with these, even when the client already did.
 */
import { z } from 'zod';
import { LIMITS } from '../config/app';
import { EVENT_TYPE_KEYS } from '../config/event-types';
import { REPORT_REASONS } from '../config/reports';
import { ORG_TYPES, SIGNATURE_LIMITS } from '../config/signatures';
import { TIME_ZONES } from './dates';
import { isMunicipalityCode } from './municipalities';

// No runtime code generation: Zod would otherwise probe `new Function`, which the
// Content-Security-Policy forbids (it reports a violation, then falls back anyway).
z.config({ jitless: true });

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

// --- Signatures (SPEC §5) -------------------------------------------------------

/** Contact details typed into a field that gets published (name, activity…). */
const CONTACT_IN_TEXT = [/[^\s@]+@[^\s@]+\.[a-z]{2,}/i, /(?:\+?\d[\s().-]?){9,}/];
const hasContact = (v: string | null) => v !== null && CONTACT_IN_TEXT.some((re) => re.test(v));

/** Optional text that may be published: must not contain an email or a phone number. */
const PublicText = (max: number) =>
  OptionalText(max).refine((v) => !hasContact(v), 'contact_in_public_field');

const RequiredText = (max: number) =>
  z.string('required').trim().min(1, 'required').max(max, 'too_long');

const RequiredEmail = z
  .string('required')
  .trim()
  .toLowerCase()
  .min(1, 'required')
  .max(254, 'too_long')
  .pipe(z.email('invalid_email'));

const Phone = OptionalText(SIGNATURE_LIMITS.phoneMax).refine(
  (v) => v === null || (/^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 9),
  'invalid_phone',
);

const Municipality = z.string('required').refine(isMunicipalityCode, 'required');

/** Checkbox: JSON booleans, or HTML form values ("on"); absent = false. */
const Flag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');
const RequiredFlag = Flag.refine((v) => v, 'required');

/** "Site ou rede social": scheme optional on input, stored as an http(s) URL. */
const Website = OptionalText(SIGNATURE_LIMITS.websiteMax).transform((v, ctx) => {
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) throw new Error();
    return url.toString();
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid_url' });
    return z.NEVER;
  }
});

const SignatureCommon = {
  email: RequiredEmail,
  municipality: Municipality,
  phone: Phone,
  canContact: Flag,
  consent: RequiredFlag,
  /** Missing without JavaScript; the route answers captcha_failed after validation. */
  turnstileToken: z.string().max(4096).optional(),
  /** Honeypot: must stay empty. */
  website: z.string().max(500).optional(),
};

export const IndividualSignatureSchema = z
  .object({
    kind: z.literal('individual', 'required'),
    firstName: PublicText(SIGNATURE_LIMITS.nameMax),
    lastName: PublicText(SIGNATURE_LIMITS.nameMax),
    pseudonym: PublicText(SIGNATURE_LIMITS.nameMax),
    activity: PublicText(SIGNATURE_LIMITS.activityMax),
    isPublic: Flag,
    ...SignatureCommon,
  })
  .superRefine((s, ctx) => {
    // SPEC §5.2: first name + last name, or a pseudonym.
    if (s.pseudonym) return;
    if (!s.firstName)
      ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'name_or_pseudonym' });
    if (!s.lastName)
      ctx.addIssue({ code: 'custom', path: ['lastName'], message: 'name_or_pseudonym' });
  });

export const OrganizationSignatureSchema = z.object({
  kind: z.literal('organization', 'required'),
  orgName: RequiredText(SIGNATURE_LIMITS.orgNameMax).refine(
    (v) => !hasContact(v),
    'contact_in_public_field',
  ),
  orgType: z.enum(ORG_TYPES, 'required'),
  site: Website,
  contactName: RequiredText(SIGNATURE_LIMITS.orgNameMax),
  legitimacy: RequiredFlag,
  /** SPEC §5.2: required for organisations (publishing the name is the point). */
  isPublic: RequiredFlag,
  ...SignatureCommon,
});

/** Picks the schema by `kind` explicitly: a Zod union would hide the per-field errors. */
export function signatureRequestSchema(body: unknown) {
  return body && typeof body === 'object' && 'kind' in body && body.kind === 'organization'
    ? OrganizationSignatureSchema
    : IndividualSignatureSchema;
}
export type IndividualSignature = z.output<typeof IndividualSignatureSchema>;
export type OrganizationSignature = z.output<typeof OrganizationSignatureSchema>;
export type SignatureInput = IndividualSignature | OrganizationSignature;

/** HTML form fields → request body (the Turnstile widget names its field cf-turnstile-response). */
export function signatureFormToBody(form: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === 'string') body[k] = v;
  const token = body['cf-turnstile-response'];
  delete body['cf-turnstile-response'];
  if (typeof token === 'string' && token && !body.turnstileToken) body.turnstileToken = token;
  return body;
}

export const SignResponseSchema = z.object({ status: z.literal('check_email') });

export const WithdrawRequestSchema = z.object({ token: z.string().min(20).max(100) });

export const PublicSignaturesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  municipality: z
    .string()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isMunicipalityCode(v), 'invalid_municipality'),
});

export const SignatureStatsSchema = z.object({
  /** Confirmed individual signatures. */
  supporters: z.number().int(),
  /** Confirmed organisations (approved or awaiting moderation). */
  organizations: z.number().int(),
});
export type SignatureStats = z.infer<typeof SignatureStatsSchema>;

// Whitelists of what the public list shows. Never add email, phone or contact name.
export const PublicIndividualSchema = z.object({
  name: z.string(),
  activity: z.string().nullable(),
  municipality: z.string(),
});
export const PublicOrganizationSchema = z.object({
  name: z.string(),
  type: z.enum(ORG_TYPES),
  municipality: z.string(),
  website: z.string().nullable(),
});
export const PublicSignaturesSchema = z.object({
  /** Approved organisations (all of them, first page only). */
  organizations: z.array(PublicOrganizationSchema),
  individuals: z.array(PublicIndividualSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Public individuals matching the filter. */
  total: z.number().int(),
});
export type PublicSignatures = z.infer<typeof PublicSignaturesSchema>;
export type PublicIndividual = z.infer<typeof PublicIndividualSchema>;
export type PublicOrganization = z.infer<typeof PublicOrganizationSchema>;

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
  /** Ongoing ("sem fim"): first local date, shown every day from then on; null = normal event. */
  ongoingSince: z.string().nullable(),
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

// --- Admin (SPEC §6) -------------------------------------------------------------
// Admin-only responses: these do carry personal data, and are served only to a
// signed-in admin (src/server/routes/admin.ts).

export const AdminLoginRequestSchema = z.object({ email: RequiredEmail });
export const AdminSessionRequestSchema = z.object({ token: z.string().min(20).max(100) });

export const ADMIN_EVENT_FILTERS = ['pending', 'reported', 'hidden', 'all'] as const;
export type AdminEventFilter = (typeof ADMIN_EVENT_FILTERS)[number];

/** Free-text search in admin lists: trimmed, empty = none. */
const AdminSearch = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || null);

export const AdminEventsQuerySchema = z.object({
  filter: z.enum(ADMIN_EVENT_FILTERS).catch('pending'),
  q: AdminSearch,
});

export const AdminEventActionSchema = z.object({
  action: z.enum(['publish', 'hide', 'verify', 'unverify', 'ongoing', 'not_ongoing'], 'required'),
});
export type AdminEventAction = z.infer<typeof AdminEventActionSchema>['action'];

const EventStatusSchema = z.enum(['pending', 'published', 'hidden']);

export const AdminEventListItemSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPE_KEYS),
  title: z.string(),
  status: EventStatusSchema,
  verified: z.boolean(),
  /** Ongoing ("sem fim"): shown every day until hidden or unmarked. */
  ongoing: z.boolean(),
  municipality: z.string(),
  district: z.string(),
  createdAt: z.string(),
  /** Reports still open (dismissed when the event is approved). */
  reports: z.number().int(),
  /** Start of the next occurrence that has not ended (cancelled ones excluded). */
  nextStartsAt: z.string().nullable(),
});
export type AdminEventListItem = z.infer<typeof AdminEventListItemSchema>;
export const AdminEventListSchema = z.object({ items: z.array(AdminEventListItemSchema) });

export const AdminEventDetailSchema = EditableEventSchema.extend({
  ongoing: z.boolean(),
  contactEmail: z.string().nullable(),
  createdAt: z.string(),
  reports: z.array(
    z.object({
      reason: z.enum(REPORT_REASONS),
      detail: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminEventDetail = z.infer<typeof AdminEventDetailSchema>;

// --- Admin: new event, imported from a post's text or a poster ----------------

export const EXTRACT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Base64 length of a ~3.7 MB image (the client shrinks posters well below this). */
const EXTRACT_IMAGE_MAX = 5_000_000;

/** POST /api/admin/events/extract: the text of a post and/or an image, at least one. */
export const AdminExtractRequestSchema = z
  .object({
    text: z.string().trim().max(LIMITS.extractTextMax, 'too_long').optional(),
    image: z
      .object({
        mediaType: z.enum(EXTRACT_IMAGE_TYPES, 'invalid_image'),
        data: z
          .string()
          .min(1, 'invalid_image')
          .max(EXTRACT_IMAGE_MAX, 'image_too_large')
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'invalid_image'),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.text) || Boolean(v.image), {
    message: 'required',
    path: ['text'],
  });
export type AdminExtractRequest = z.infer<typeof AdminExtractRequestSchema>;

/** What the import read: a starting point for the form, checked again on publish. */
export const EventDraftSchema = z.object({
  type: z.enum(EVENT_TYPE_KEYS),
  title: z.string(),
  description: z.string().nullable(),
  organizer: z.string().nullable(),
  /** Searchable place text ("Praça do Comércio, Lisboa"), or null. */
  placeQuery: z.string().nullable(),
  occurrences: z.array(
    z.object({
      localDate: LocalDate,
      startTime: LocalTime.nullable(),
      endTime: LocalTime.nullable(),
      note: z.string().nullable(),
    }),
  ),
  /** Doubts for the moderator, in pt-PT ("O ano não está no cartaz: assumi 2026."). */
  warnings: z.array(z.string()),
});
export type EventDraft = z.infer<typeof EventDraftSchema>;

export const AdminExtractResponseSchema = z.object({
  draft: EventDraftSchema,
  /** Place search results for `placeQuery` (best first); empty when none. */
  places: z.array(PlaceResultSchema),
});
export type AdminExtractResponse = z.infer<typeof AdminExtractResponseSchema>;

export const ADMIN_SIGNATURE_FILTERS = [
  'orgs_pending',
  'organizations',
  'individuals',
  'unconfirmed',
] as const;
export type AdminSignatureFilter = (typeof ADMIN_SIGNATURE_FILTERS)[number];

export const AdminSignaturesQuerySchema = z.object({
  filter: z.enum(ADMIN_SIGNATURE_FILTERS).catch('orgs_pending'),
  q: AdminSearch,
});

export const AdminSignatureActionSchema = z.object({
  action: z.enum(['approve', 'reject'], 'required'),
});

export const AdminSignatureSchema = z.object({
  id: z.string(),
  kind: z.enum(['individual', 'organization']),
  status: z.enum(['unconfirmed', 'confirmed', 'approved', 'rejected']),
  /** Person's name or pseudonym, or the organisation's name. */
  name: z.string(),
  orgType: z.enum(ORG_TYPES).nullable(),
  contactName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  municipality: z.string(),
  activity: z.string().nullable(),
  website: z.string().nullable(),
  isPublic: z.boolean(),
  canContact: z.boolean(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type AdminSignature = z.infer<typeof AdminSignatureSchema>;
export const AdminSignatureListSchema = z.object({
  items: z.array(AdminSignatureSchema),
  /** Matching rows (the list shows at most ADMIN.listLimit). */
  total: z.number().int(),
});
export type AdminSignatureList = z.infer<typeof AdminSignatureListSchema>;
