/** App-wide configuration. See docs/decisions.md for the reasoning behind each default. */

/** D2 — placeholder until name/domain is decided. */
export const APP_NAME = 'Mobilização';

/** D8 — data controller (GDPR). Must be filled in before launch (phase 7). */
export const DATA_CONTROLLER = {
  name: '[A DEFINIR]',
  contactEmail: '[A DEFINIR]',
} as const;

/** D3 — 'pre': new events wait for approval; 'post': published immediately as "não confirmado". */
export type ModerationMode = 'pre' | 'post';
export const MODERATION_MODE: ModerationMode = 'post';

/** D5 — highlighted campaign dates ('YYYY-MM-DD', Europe/Lisbon). None for now. */
export const KEY_DATES: readonly string[] = [];

export const LIMITS = {
  titleMin: 3,
  titleMax: 90,
  descriptionMax: 600,
  occurrenceNoteMax: 120,
  occurrencesMin: 1,
  occurrencesMax: 30,
  /** How far ahead an occurrence may be scheduled. */
  occurrenceMaxMonthsAhead: 12,
  activityMax: 80,
  reportsToAutoHide: 3,
  /** Days shown in the "Escolher dia" strip. */
  dayStripDays: 60,
} as const;

export const RETENTION = {
  eventDaysAfterLastOccurrence: 30,
  unconfirmedSignatureDays: 7,
  /** Months after campaign end to keep signatures (decided later). */
  signatureMonthsAfterCampaign: 6,
} as const;

/** Per-IP rate limits (per hour). */
export const RATE_LIMITS = {
  createEvent: 5,
  sign: 10,
  report: 10,
} as const;

/** Basemap archive, served by the Worker from R2 (see data/geo/README.md). */
export const MAP_TILES_PATH = '/tiles/pt.pmtiles';

/** Reverse geocoding: max distance (metres) to snap a point to the nearest municipality. */
export const GEO_SNAP_METERS = 1000;
