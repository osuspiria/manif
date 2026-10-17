/**
 * Support appeal (SPEC §5.3): sign, confirm by email, withdraw, counters and
 * the public list. Knows nothing about Hono or D1.
 */
import { CONSENT_TEXT_VERSION, SIGNATURE_LIMITS, type OrgType } from '../../config/signatures';
import { RETENTION } from '../../config/app';
import { pt } from '../../i18n/pt';
import { addCivilDaysToIso, formatLisbonDateTime, nowIso } from '../../shared/dates';
import { municipalityLabel } from '../../shared/municipalities';
import type { PublicSignatures, SignatureInput, SignatureStats } from '../../shared/schemas';
import type { Mailer } from '../mailer';
import type { SignatureRow, SignaturesRepo } from '../repos/signatures-repo';
import { hashToken, newToken } from '../security/tokens';

export interface SignatureDeps {
  repo: SignaturesRepo;
  mailer: Mailer;
  /** Per-address email throttle: false when this address already got enough emails today. */
  allowEmail: (email: string) => Promise<boolean>;
  newId: () => string;
  now: Date;
}

const VALID_DAYS = RETENTION.unconfirmedSignatureDays;

export function confirmUrl(origin: string, token: string): string {
  return `${origin}/api/signatures/confirm?token=${token}`;
}

export function withdrawUrl(origin: string, token: string): string {
  // Fragment: never sent to the server with the page, never in logs or Referer.
  return `${origin}/apoio/retirar/#t=${token}`;
}

async function send(d: SignatureDeps, to: string, subject: string, text: string): Promise<void> {
  if (!(await d.allowEmail(to))) return;
  try {
    await d.mailer.send({ to, subject, text });
  } catch {
    // Never log the address.
    console.error('signature email failed');
  }
}

function toRow(input: SignatureInput, id: string, tokenHash: string, at: string): SignatureRow {
  const common = {
    id,
    email: input.email,
    municipality: input.municipality,
    phone: input.phone,
    can_contact: input.canContact ? 1 : 0,
    status: 'unconfirmed' as const,
    confirm_token_hash: tokenHash,
    consent_text_version: CONSENT_TEXT_VERSION,
    created_at: at,
    confirmed_at: null,
  };
  if (input.kind === 'individual') {
    return {
      ...common,
      kind: 'individual',
      first_name: input.firstName,
      last_name: input.lastName,
      pseudonym: input.pseudonym,
      activity: input.activity,
      org_name: null,
      org_type: null,
      contact_name: null,
      website: null,
      is_public: input.isPublic ? 1 : 0,
    };
  }
  return {
    ...common,
    kind: 'organization',
    first_name: null,
    last_name: null,
    pseudonym: null,
    activity: null,
    org_name: input.orgName,
    org_type: input.orgType,
    contact_name: input.contactName,
    website: input.site,
    is_public: input.isPublic ? 1 : 0,
  };
}

/**
 * Always answers the same way (SPEC §5.3 step 4): the response never reveals
 * whether the address had already signed.
 * - new address: stored as unconfirmed, confirmation email;
 * - unconfirmed: nothing overwritten, new link (the old one stops working), 7 days restart;
 * - confirmed/approved: nothing changes, email with a new withdraw link;
 * - rejected organisation: nothing happens.
 */
export async function sign(input: SignatureInput, origin: string, d: SignatureDeps): Promise<void> {
  const at = nowIso(d.now);
  const token = newToken();
  const hash = await hashToken(token);
  const organization = input.kind === 'organization' ? input.orgName : null;
  const existing = await d.repo.findByEmail(input.kind, input.email);

  if (!existing || existing.status === 'unconfirmed') {
    if (existing) await d.repo.replaceToken(existing.id, hash, at);
    else await d.repo.insert(toRow(input, d.newId(), hash, at));
    const until = formatLisbonDateTime(addCivilDaysToIso(at, VALID_DAYS));
    await send(
      d,
      input.email,
      pt.email.confirmSubject,
      pt.email.confirmText({
        organization,
        confirmUrl: confirmUrl(origin, token),
        withdrawUrl: withdrawUrl(origin, token),
        until,
      }),
    );
    return;
  }
  if (existing.status === 'rejected') return;

  await d.repo.replaceToken(existing.id, hash, null);
  await send(
    d,
    input.email,
    pt.email.alreadySubject,
    pt.email.alreadyText({ organization, withdrawUrl: withdrawUrl(origin, token) }),
  );
}

export type ConfirmResult =
  { ok: true; kind: SignatureRow['kind'] } | { ok: false; reason: 'invalid' | 'expired' };

/** Idempotent: a link opened twice (or by a mail scanner first) still lands on "thanks". */
export async function confirm(token: string, d: SignatureDeps): Promise<ConfirmResult> {
  const row = await d.repo.findByTokenHash(await hashToken(token));
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.status !== 'unconfirmed') return { ok: true, kind: row.kind };
  const at = nowIso(d.now);
  if (addCivilDaysToIso(row.created_at, VALID_DAYS) <= at) return { ok: false, reason: 'expired' };
  await d.repo.confirm(row.id, at);
  return { ok: true, kind: row.kind };
}

/** SPEC §5.3 step 5: withdrawing deletes the record. */
export async function withdraw(token: string, d: SignatureDeps): Promise<boolean> {
  const row = await d.repo.findByTokenHash(await hashToken(token));
  if (!row) return false;
  await d.repo.delete(row.id);
  return true;
}

export async function stats(d: Pick<SignatureDeps, 'repo'>): Promise<SignatureStats> {
  const c = await d.repo.counts();
  return { supporters: c.individuals, organizations: c.organizations };
}

export async function listPublic(
  q: { page: number; municipality: string | null },
  d: Pick<SignatureDeps, 'repo'>,
): Promise<PublicSignatures> {
  const pageSize = SIGNATURE_LIMITS.pageSize;
  const [{ rows, total }, orgs] = await Promise.all([
    d.repo.listPublicIndividuals(q.municipality, pageSize, (q.page - 1) * pageSize),
    q.page === 1 ? d.repo.listApprovedOrganizations(q.municipality) : Promise.resolve([]),
  ]);
  return {
    organizations: orgs.map((o) => ({
      name: o.org_name ?? '',
      type: (o.org_type ?? 'other') as OrgType,
      municipality: municipalityLabel(o.municipality),
      website: o.website,
    })),
    individuals: rows.map((r) => ({
      name: r.pseudonym ?? [r.first_name, r.last_name].filter(Boolean).join(' '),
      activity: r.activity,
      municipality: municipalityLabel(r.municipality),
    })),
    page: q.page,
    pageSize,
    total,
  };
}
