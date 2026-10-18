/**
 * Admin side (SPEC §6): login tokens and sessions, moderation queries over
 * events and signatures. Only ever used behind the admin session check.
 */
import type { Db } from './db';
import type { SignatureRow, SignatureStatus } from './signatures-repo';

// --- login and sessions -------------------------------------------------------------

export function adminAuthRepo(db: Db) {
  return {
    async addLoginToken(hash: string, email: string, at: string, expiresAt: string) {
      await db.run(
        'INSERT INTO admin_login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
        [hash, email, at, expiresAt],
      );
    },
    /** Single use: the token is deleted whether or not it is still valid. */
    async takeLoginToken(hash: string): Promise<{ email: string; expires_at: string } | null> {
      const row = await db.first<{ email: string; expires_at: string }>(
        'SELECT email, expires_at FROM admin_login_tokens WHERE token_hash = ?',
        [hash],
      );
      if (row) await db.run('DELETE FROM admin_login_tokens WHERE token_hash = ?', [hash]);
      return row;
    },
    async addSession(idHash: string, email: string, at: string, expiresAt: string) {
      await db.run(
        'INSERT INTO admin_sessions (id_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
        [idHash, email, at, expiresAt],
      );
    },
    async getSession(idHash: string, nowIso: string): Promise<{ email: string } | null> {
      return db.first<{ email: string }>(
        'SELECT email FROM admin_sessions WHERE id_hash = ? AND expires_at > ?',
        [idHash, nowIso],
      );
    },
    async deleteSession(idHash: string) {
      await db.run('DELETE FROM admin_sessions WHERE id_hash = ?', [idHash]);
    },
  };
}
export type AdminAuthRepo = ReturnType<typeof adminAuthRepo>;

// --- events ------------------------------------------------------------------------------

export interface AdminEventRow {
  id: string;
  type: string;
  title: string;
  status: 'pending' | 'published' | 'hidden';
  verified: number;
  ongoing: number;
  municipality: string;
  district: string;
  created_at: string;
  reports: number;
  next_starts_at: string | null;
}

export interface AdminReportRow {
  reason: string;
  detail: string | null;
  created_at: string;
}

export function adminEventsRepo(db: Db) {
  const select = `SELECT e.id, e.type, e.title, e.status, e.verified, e.ongoing, e.municipality,
      e.district,
      e.created_at,
      (SELECT COUNT(*) FROM event_reports r WHERE r.event_id = e.id) AS reports,
      (SELECT MIN(o.starts_at) FROM event_occurrences o
        WHERE o.event_id = e.id AND o.cancelled = 0 AND o.ends_at > ?) AS next_starts_at
    FROM events e`;
  return {
    async list(
      filter: 'pending' | 'reported' | 'hidden' | 'all',
      q: string | null,
      nowIso: string,
      limit: number,
    ): Promise<AdminEventRow[]> {
      const where: string[] = [];
      const params: unknown[] = [nowIso];
      if (filter === 'pending') where.push("e.status = 'pending'");
      if (filter === 'hidden') where.push("e.status = 'hidden'");
      if (filter === 'reported')
        where.push('EXISTS (SELECT 1 FROM event_reports r WHERE r.event_id = e.id)');
      if (q) {
        where.push("(e.title LIKE ? ESCAPE '\\' OR e.municipality LIKE ? ESCAPE '\\')");
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        params.push(like, like);
      }
      const order = filter === 'reported' ? 'reports DESC, e.created_at DESC' : 'e.created_at DESC';
      return db.all<AdminEventRow>(
        `${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`,
        [...params, limit],
      );
    },
    async get(id: string, nowIso: string): Promise<AdminEventRow | null> {
      return db.first<AdminEventRow>(`${select} WHERE e.id = ?`, [nowIso, id]);
    },
    async contact(
      id: string,
    ): Promise<{ contact_email: string | null; created_at: string; ongoing: number } | null> {
      return db.first('SELECT contact_email, created_at, ongoing FROM events WHERE id = ?', [id]);
    },
    async reports(id: string): Promise<AdminReportRow[]> {
      return db.all<AdminReportRow>(
        'SELECT reason, detail, created_at FROM event_reports WHERE event_id = ? ORDER BY created_at DESC',
        [id],
      );
    },
    async setVerified(id: string, verified: boolean, nowIso: string) {
      await db.run('UPDATE events SET verified = ?, updated_at = ? WHERE id = ?', [
        verified ? 1 : 0,
        nowIso,
        id,
      ]);
    },
    async setOngoing(id: string, ongoing: boolean, nowIso: string) {
      await db.run('UPDATE events SET ongoing = ?, updated_at = ? WHERE id = ?', [
        ongoing ? 1 : 0,
        nowIso,
        id,
      ]);
    },
    /** Approving after reports dismisses them (otherwise the next report would hide it again). */
    async publishAndDismissReports(id: string, nowIso: string) {
      await db.batch([
        {
          sql: "UPDATE events SET status = 'published', updated_at = ? WHERE id = ?",
          params: [nowIso, id],
        },
        { sql: 'DELETE FROM event_reports WHERE event_id = ?', params: [id] },
      ]);
    },
  };
}
export type AdminEventsRepo = ReturnType<typeof adminEventsRepo>;

// --- signatures --------------------------------------------------------------------------

export type AdminSignatureFilterSql =
  'orgs_pending' | 'organizations' | 'individuals' | 'unconfirmed';

const SIGNATURE_FILTERS: Record<AdminSignatureFilterSql, string> = {
  orgs_pending: "kind = 'organization' AND status = 'confirmed'",
  organizations: "kind = 'organization' AND status != 'unconfirmed'",
  individuals: "kind = 'individual' AND status != 'unconfirmed'",
  unconfirmed: "status = 'unconfirmed'",
};

export function adminSignaturesRepo(db: Db) {
  return {
    async list(
      filter: AdminSignatureFilterSql,
      q: string | null,
      limit: number,
    ): Promise<{ rows: SignatureRow[]; total: number }> {
      const where = [SIGNATURE_FILTERS[filter]];
      const params: unknown[] = [];
      if (q) {
        const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(
          `(${['email', 'first_name', 'last_name', 'pseudonym', 'org_name', 'contact_name']
            .map((c) => `LOWER(${c}) LIKE ? ESCAPE '\\'`)
            .join(' OR ')})`,
        );
        params.push(like, like, like, like, like, like);
      }
      const w = where.join(' AND ');
      const [rows, total] = await Promise.all([
        db.all<SignatureRow>(
          `SELECT * FROM signatures WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ?`,
          [...params, limit],
        ),
        db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM signatures WHERE ${w}`, params),
      ]);
      return { rows, total: total?.n ?? 0 };
    },
    async get(id: string): Promise<SignatureRow | null> {
      return db.first<SignatureRow>('SELECT * FROM signatures WHERE id = ?', [id]);
    },
    async setStatus(id: string, status: SignatureStatus) {
      await db.run('UPDATE signatures SET status = ? WHERE id = ?', [status, id]);
    },
    async delete(id: string) {
      await db.run('DELETE FROM signatures WHERE id = ?', [id]);
    },
    /** SPEC §6: only people/organisations that accepted to be contacted, and counted. */
    async listContactable(): Promise<SignatureRow[]> {
      return db.all<SignatureRow>(
        `SELECT * FROM signatures WHERE can_contact = 1 AND status IN ('confirmed', 'approved')
         ORDER BY kind, created_at`,
      );
    },
  };
}
export type AdminSignaturesRepo = ReturnType<typeof adminSignaturesRepo>;

// --- retention (SPEC §7) -----------------------------------------------------------------

export function retentionRepo(db: Db) {
  const count = async (sql: string, params: unknown[]) =>
    (await db.first<{ n: number }>(sql, params))?.n ?? 0;
  return {
    async deleteUnconfirmedSignaturesBefore(iso: string): Promise<number> {
      const where = "status = 'unconfirmed' AND created_at < ?";
      const n = await count(`SELECT COUNT(*) AS n FROM signatures WHERE ${where}`, [iso]);
      if (n) await db.run(`DELETE FROM signatures WHERE ${where}`, [iso]);
      return n;
    },
    async deleteAllSignatures(): Promise<number> {
      const n = await count('SELECT COUNT(*) AS n FROM signatures', []);
      if (n) await db.run('DELETE FROM signatures');
      return n;
    },
    /**
     * Events whose last occurrence ended before `iso` (or that never had one and
     * are older). Ongoing events are kept until a moderator unmarks them.
     */
    async deleteEventsEndedBefore(iso: string): Promise<number> {
      const stale = `SELECT e.id FROM events e WHERE e.created_at < ? AND e.ongoing = 0 AND NOT EXISTS
        (SELECT 1 FROM event_occurrences o WHERE o.event_id = e.id AND o.ends_at >= ?)`;
      const n = await count(`SELECT COUNT(*) AS n FROM (${stale})`, [iso, iso]);
      if (!n) return 0;
      await db.batch([
        { sql: `DELETE FROM event_reports WHERE event_id IN (${stale})`, params: [iso, iso] },
        { sql: `DELETE FROM event_occurrences WHERE event_id IN (${stale})`, params: [iso, iso] },
        { sql: `DELETE FROM events WHERE id IN (${stale})`, params: [iso, iso] },
      ]);
      return n;
    },
    async deleteExpiredAdminAuth(nowIso: string): Promise<void> {
      await db.batch([
        { sql: 'DELETE FROM admin_login_tokens WHERE expires_at <= ?', params: [nowIso] },
        { sql: 'DELETE FROM admin_sessions WHERE expires_at <= ?', params: [nowIso] },
      ]);
    },
  };
}
export type RetentionRepo = ReturnType<typeof retentionRepo>;
