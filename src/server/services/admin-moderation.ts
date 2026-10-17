/**
 * Moderation (SPEC §4.5, §6): event queues and actions, signature queue,
 * deletion on request, CSV export of contactable signatories.
 * Knows nothing about Hono or D1.
 */
import { ADMIN } from '../../config/app';
import { isEventType } from '../../config/event-types';
import { REPORT_REASONS, type ReportReason } from '../../config/reports';
import { ORG_TYPES, type OrgType } from '../../config/signatures';
import { pt } from '../../i18n/pt';
import { nowIso } from '../../shared/dates';
import { municipalityLabel } from '../../shared/municipalities';
import type {
  AdminEventAction,
  AdminEventDetail,
  AdminEventFilter,
  AdminEventListItem,
  AdminSignature,
  AdminSignatureFilter,
  AdminSignatureList,
} from '../../shared/schemas';
import type { AdminEventRow, AdminEventsRepo, AdminSignaturesRepo } from '../repos/admin-repo';
import type { EventsRepo, EventsWriteRepo } from '../repos/events-repo';
import type { SignatureRow } from '../repos/signatures-repo';
import { toEditable } from './event-submission';

export interface ModerationDeps {
  events: AdminEventsRepo;
  read: EventsRepo;
  write: EventsWriteRepo;
  signatures: AdminSignaturesRepo;
  now: Date;
}

// --- events ------------------------------------------------------------------------------

function toListItem(r: AdminEventRow): AdminEventListItem {
  return {
    id: r.id,
    type: isEventType(r.type) ? r.type : 'other',
    title: r.title,
    status: r.status,
    verified: r.verified === 1,
    municipality: r.municipality,
    district: r.district,
    createdAt: r.created_at,
    reports: r.reports,
    nextStartsAt: r.next_starts_at,
  };
}

export async function listEvents(
  q: { filter: AdminEventFilter; q: string | null },
  d: ModerationDeps,
): Promise<AdminEventListItem[]> {
  const rows = await d.events.list(q.filter, q.q, nowIso(d.now), ADMIN.listLimit);
  return rows.map(toListItem);
}

export async function eventDetail(id: string, d: ModerationDeps): Promise<AdminEventDetail | null> {
  const row = await d.write.getOwner(id);
  const extra = await d.events.contact(id);
  if (!row || !extra) return null;
  const [occurrences, reports] = await Promise.all([
    d.read.listOccurrences(id),
    d.events.reports(id),
  ]);
  return {
    ...toEditable(row, occurrences),
    contactEmail: extra.contact_email,
    createdAt: extra.created_at,
    reports: reports.map((r) => ({
      reason: (REPORT_REASONS as readonly string[]).includes(r.reason)
        ? (r.reason as ReportReason)
        : 'other',
      detail: r.detail,
      createdAt: r.created_at,
    })),
  };
}

export async function moderateEvent(
  id: string,
  action: AdminEventAction,
  d: ModerationDeps,
): Promise<AdminEventListItem | null> {
  const at = nowIso(d.now);
  if (!(await d.events.get(id, at))) return null;
  if (action === 'publish') await d.events.publishAndDismissReports(id, at);
  if (action === 'hide') await d.write.setStatus(id, 'hidden', at);
  if (action === 'verify' || action === 'unverify')
    await d.events.setVerified(id, action === 'verify', at);
  const row = await d.events.get(id, at);
  return row ? toListItem(row) : null;
}

// --- signatures -----------------------------------------------------------------------

function displayName(r: SignatureRow): string {
  if (r.kind === 'organization') return r.org_name ?? '';
  return r.pseudonym ?? [r.first_name, r.last_name].filter(Boolean).join(' ');
}

function toAdminSignature(r: SignatureRow): AdminSignature {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    name: displayName(r),
    orgType: (ORG_TYPES as readonly string[]).includes(r.org_type ?? '')
      ? (r.org_type as OrgType)
      : null,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    municipality: municipalityLabel(r.municipality),
    activity: r.activity,
    website: r.website,
    isPublic: r.is_public === 1,
    canContact: r.can_contact === 1,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

export async function listSignatures(
  q: { filter: AdminSignatureFilter; q: string | null },
  d: ModerationDeps,
): Promise<AdminSignatureList> {
  const { rows, total } = await d.signatures.list(q.filter, q.q, ADMIN.listLimit);
  return { items: rows.map(toAdminSignature), total };
}

export type ModerateSignatureResult =
  { ok: true; value: AdminSignature } | { ok: false; status: 404 | 409; error: string };

/** Organisations only, once confirmed by email (SPEC §3.2). */
export async function moderateSignature(
  id: string,
  action: 'approve' | 'reject',
  d: ModerationDeps,
): Promise<ModerateSignatureResult> {
  const row = await d.signatures.get(id);
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (row.kind !== 'organization' || row.status === 'unconfirmed') {
    return { ok: false, status: 409, error: 'not_moderatable' };
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  await d.signatures.setStatus(id, status);
  return { ok: true, value: toAdminSignature({ ...row, status }) };
}

export async function deleteSignature(id: string, d: ModerationDeps): Promise<boolean> {
  if (!(await d.signatures.get(id))) return false;
  await d.signatures.delete(id);
  return true;
}

// --- CSV export (SPEC §6) ---------------------------------------------------------------

/** One CSV cell: quoted when needed; formula-like values are neutralised (CSV injection). */
export function csvCell(value: string | null): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/**
 * Semicolon-separated with a UTF-8 BOM and CRLF, which is what Excel in
 * Portuguese opens correctly (comma is the decimal separator there).
 */
export async function exportContactsCsv(d: ModerationDeps): Promise<string> {
  const rows = await d.signatures.listContactable();
  const h = pt.admin.csv;
  const header = [
    h.kind,
    h.firstName,
    h.lastName,
    h.pseudonym,
    h.organization,
    h.orgType,
    h.contactName,
    h.email,
    h.phone,
    h.municipality,
    h.activity,
    h.website,
    h.status,
    h.createdAt,
    h.confirmedAt,
  ];
  const lines = rows.map((r) =>
    [
      r.kind === 'organization' ? h.kindOrganization : h.kindIndividual,
      r.first_name,
      r.last_name,
      r.pseudonym,
      r.org_name,
      r.org_type && r.org_type in pt.support.orgTypes
        ? pt.support.orgTypes[r.org_type as OrgType]
        : null,
      r.contact_name,
      r.email,
      r.phone,
      municipalityLabel(r.municipality),
      r.activity,
      r.website,
      pt.admin.signatureStatus[r.status],
      r.created_at,
      r.confirmed_at,
    ]
      .map(csvCell)
      .join(';'),
  );
  return `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`;
}
