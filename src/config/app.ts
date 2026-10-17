/** App-wide configuration. See docs/decisions.md for the reasoning behind each default. */

/** D2 — placeholder until name/domain is decided. */
export const APP_NAME = 'Mobilização';

/** D8 — data controller (GDPR). Must be filled in before launch (phase 7). */
export const DATA_CONTROLLER = {
  name: '[A DEFINIR]',
  contactEmail: '[A DEFINIR]',
} as const;

/**
 * Optional features, all on by default. Switching one off unregisters its API
 * routes and hides its links; its pages must also be renamed with a leading
 * "_" (Astro does not build those).
 */
export interface Features {
  signatures: boolean;
  privacyPage: boolean;
  /**
   * Optional contact email in "Adicionar evento". Personal data: switch it on
   * only together with the privacy page (GDPR art. 13). While off, the field is
   * not shown and the API ignores the value (nothing is stored or emailed).
   */
  eventContactEmail: boolean;
}
export const FEATURES: Features = {
  signatures: true,
  privacyPage: true,
  eventContactEmail: true,
};

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
  /** Months after CAMPAIGN_END to keep signatures; then the retention job deletes them all. */
  signatureMonthsAfterCampaign: 6,
} as const;

/**
 * Last day of the campaign ('YYYY-MM-DD', Lisbon), or null while undecided: with
 * null, signatures are kept until withdrawn (SPEC §7). Set it before launch.
 */
export const CAMPAIGN_END: string | null = null;

/** Admin (SPEC §6): magic-link login. Allowed addresses: ADMIN_EMAILS (env). */
export const ADMIN = {
  loginLinkMinutes: 15,
  sessionHours: 24,
  /** Login emails per address per hour. */
  loginEmailsPerHour: 5,
  /** Rows per admin list. */
  listLimit: 100,
} as const;

/** Per-IP rate limits (per hour). */
export const RATE_LIMITS = {
  createEvent: 5,
  sign: 10,
  report: 10,
  adminLogin: 10,
} as const;

/** Basemap archive, served by the Worker from R2 (see data/geo/README.md). */
export const MAP_TILES_PATH = '/tiles/pt.pmtiles';

/** Reverse geocoding: max distance (metres) to snap a point to the nearest municipality. */
export const GEO_SNAP_METERS = 1000;
