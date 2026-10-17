/**
 * Admin login by magic link (SPEC §6): addresses in ADMIN_EMAILS get a
 * single-use link valid for a few minutes; opening it creates a session.
 * Tokens and session ids are 32 random bytes; only their hashes are stored.
 */
import { ADMIN } from '../../config/app';
import { pt } from '../../i18n/pt';
import { addDurationIso, nowIso } from '../../shared/dates';
import type { Mailer } from '../mailer';
import type { AdminAuthRepo } from '../repos/admin-repo';
import { hashToken, newToken } from '../security/tokens';

export interface AdminAuthDeps {
  repo: AdminAuthRepo;
  mailer: Mailer;
  /** Addresses allowed in (lowercase). */
  allowed: ReadonlySet<string>;
  /** Per-address email throttle. */
  allowEmail: (email: string) => Promise<boolean>;
  now: Date;
}

export function parseAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function loginUrl(origin: string, token: string): string {
  // Fragment: the page posts it; mail scanners that open links cannot use it up.
  return `${origin}/admin/entrar/#t=${token}`;
}

/** Same outcome whether or not the address is allowed (nothing is revealed). */
export async function requestLogin(email: string, origin: string, d: AdminAuthDeps): Promise<void> {
  if (!d.allowed.has(email) || !(await d.allowEmail(email))) return;
  const token = newToken();
  await d.repo.addLoginToken(
    await hashToken(token),
    email,
    nowIso(d.now),
    addDurationIso(d.now, { minutes: ADMIN.loginLinkMinutes }),
  );
  try {
    await d.mailer.send({
      to: email,
      subject: pt.email.adminLoginSubject,
      text: pt.email.adminLoginText(loginUrl(origin, token), ADMIN.loginLinkMinutes),
    });
  } catch {
    console.error('admin login email failed');
  }
}

export interface NewSession {
  id: string;
  email: string;
  maxAgeSeconds: number;
}

export async function startSession(token: string, d: AdminAuthDeps): Promise<NewSession | null> {
  const row = await d.repo.takeLoginToken(await hashToken(token));
  if (!row || row.expires_at <= nowIso(d.now) || !d.allowed.has(row.email)) return null;
  const id = newToken();
  await d.repo.addSession(
    await hashToken(id),
    row.email,
    nowIso(d.now),
    addDurationIso(d.now, { hours: ADMIN.sessionHours }),
  );
  return { id, email: row.email, maxAgeSeconds: ADMIN.sessionHours * 3600 };
}

/** The signed-in address, or null. Removing an address from ADMIN_EMAILS ends its sessions. */
export async function sessionEmail(id: string, d: AdminAuthDeps): Promise<string | null> {
  if (!id) return null;
  const s = await d.repo.getSession(await hashToken(id), nowIso(d.now));
  return s && d.allowed.has(s.email) ? s.email : null;
}

export async function endSession(id: string, d: AdminAuthDeps): Promise<void> {
  if (id) await d.repo.deleteSession(await hashToken(id));
}
