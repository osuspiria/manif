/** Signatures table (SPEC §3.2). The only place that knows its SQL. */
import type { Db } from './db';

export type SignatureStatus = 'unconfirmed' | 'confirmed' | 'approved' | 'rejected';

export interface SignatureRow {
  id: string;
  kind: 'individual' | 'organization';
  first_name: string | null;
  last_name: string | null;
  pseudonym: string | null;
  activity: string | null;
  org_name: string | null;
  org_type: string | null;
  contact_name: string | null;
  website: string | null;
  email: string;
  municipality: string;
  phone: string | null;
  is_public: number;
  can_contact: number;
  status: SignatureStatus;
  confirm_token_hash: string | null;
  consent_text_version: string;
  created_at: string;
  confirmed_at: string | null;
}

export type PublicIndividualRow = Pick<
  SignatureRow,
  'first_name' | 'last_name' | 'pseudonym' | 'activity' | 'municipality'
>;
export type PublicOrganizationRow = Pick<
  SignatureRow,
  'org_name' | 'org_type' | 'municipality' | 'website'
>;

const COLUMNS = [
  'id',
  'kind',
  'first_name',
  'last_name',
  'pseudonym',
  'activity',
  'org_name',
  'org_type',
  'contact_name',
  'website',
  'email',
  'municipality',
  'phone',
  'is_public',
  'can_contact',
  'status',
  'confirm_token_hash',
  'consent_text_version',
  'created_at',
  'confirmed_at',
] as const satisfies readonly (keyof SignatureRow)[];

/** Statuses that count (SPEC §3.2): confirmed, and organisations approved by moderation. */
const COUNTED = "status IN ('confirmed', 'approved')";

export function signaturesRepo(db: Db) {
  return {
    async findByEmail(kind: SignatureRow['kind'], email: string): Promise<SignatureRow | null> {
      return db.first<SignatureRow>('SELECT * FROM signatures WHERE kind = ? AND email = ?', [
        kind,
        email,
      ]);
    },

    async findByTokenHash(hash: string): Promise<SignatureRow | null> {
      return db.first<SignatureRow>('SELECT * FROM signatures WHERE confirm_token_hash = ?', [
        hash,
      ]);
    },

    async insert(row: SignatureRow): Promise<void> {
      await db.run(
        `INSERT INTO signatures (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
        COLUMNS.map((c) => row[c]),
      );
    },

    /** New link for an existing signature; unconfirmed ones also restart their 7 days. */
    async replaceToken(id: string, hash: string, restartAt: string | null): Promise<void> {
      await db.run(
        restartAt
          ? 'UPDATE signatures SET confirm_token_hash = ?, created_at = ? WHERE id = ?'
          : 'UPDATE signatures SET confirm_token_hash = ? WHERE id = ?',
        restartAt ? [hash, restartAt, id] : [hash, id],
      );
    },

    async confirm(id: string, at: string): Promise<void> {
      await db.run(
        "UPDATE signatures SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'unconfirmed'",
        [at, id],
      );
    },

    async delete(id: string): Promise<void> {
      await db.run('DELETE FROM signatures WHERE id = ?', [id]);
    },

    async counts(): Promise<{ individuals: number; organizations: number }> {
      const rows = await db.all<{ kind: string; n: number }>(
        `SELECT kind, COUNT(*) AS n FROM signatures WHERE ${COUNTED} GROUP BY kind`,
      );
      const n = (kind: string) => rows.find((r) => r.kind === kind)?.n ?? 0;
      return { individuals: n('individual'), organizations: n('organization') };
    },

    /** Public individuals, most recently confirmed first. */
    async listPublicIndividuals(
      municipality: string | null,
      limit: number,
      offset: number,
    ): Promise<{ rows: PublicIndividualRow[]; total: number }> {
      const where = `kind = 'individual' AND is_public = 1 AND ${COUNTED}${municipality ? ' AND municipality = ?' : ''}`;
      const params = municipality ? [municipality] : [];
      const [rows, total] = await Promise.all([
        db.all<PublicIndividualRow>(
          `SELECT first_name, last_name, pseudonym, activity, municipality FROM signatures
           WHERE ${where} ORDER BY confirmed_at DESC, id DESC LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        ),
        db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM signatures WHERE ${where}`, params),
      ]);
      return { rows, total: total?.n ?? 0 };
    },

    /** Organisations approved by moderation (SPEC §3.2), by name. */
    async listApprovedOrganizations(municipality: string | null): Promise<PublicOrganizationRow[]> {
      return db.all<PublicOrganizationRow>(
        `SELECT org_name, org_type, municipality, website FROM signatures
         WHERE kind = 'organization' AND is_public = 1 AND status = 'approved'
         ${municipality ? 'AND municipality = ?' : ''}
         ORDER BY org_name COLLATE NOCASE`,
        municipality ? [municipality] : [],
      );
    },
  };
}

export type SignaturesRepo = ReturnType<typeof signaturesRepo>;
