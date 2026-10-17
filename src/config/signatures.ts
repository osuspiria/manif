/** Support appeal (SPEC §5): organisation types, consent text version, limits. */

/** SPEC §5.2. Labels in pt.support.orgTypes. */
export const ORG_TYPES = [
  'association',
  'union',
  'collective',
  'committee',
  'ngo',
  'other',
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/**
 * Version of the consent texts (pt.support.consent*). Stored with every
 * signature (SPEC §7): bump it whenever those texts change.
 */
export const CONSENT_TEXT_VERSION = '2026-10-17';

export const SIGNATURE_LIMITS = {
  nameMax: 60,
  activityMax: 80,
  orgNameMax: 120,
  websiteMax: 200,
  phoneMax: 20,
  /** Individuals per page in the public list. */
  pageSize: 50,
  /** Confirmation/"already signed" emails per address per day (anti mail-bombing). */
  emailsPerAddressPerDay: 3,
} as const;
