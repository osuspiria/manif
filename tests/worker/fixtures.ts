import { env } from 'cloudflare:workers';
import type { EventType } from '../../src/config/event-types';
import { toUtcRange, type Tz } from '../../src/shared/dates';

export interface OccFixture {
  localDate: string;
  startTime: string | null;
  endTime?: string | null;
  cancelled?: boolean;
  note?: string | null;
}

export interface EventFixture {
  id: string;
  type?: EventType;
  title?: string;
  status?: 'pending' | 'published' | 'hidden';
  tz?: Tz;
  contactEmail?: string | null;
  editTokenHash?: string;
  verified?: boolean;
  ongoing?: boolean;
  /** Poster row only; store the files with putPosterFiles. */
  poster?: {
    key: string;
    status: 'pending' | 'approved';
    width?: number;
    height?: number;
    alt?: string | null;
  };
  occurrences: OccFixture[];
}

/** Secrets that must never appear in any public response. */
export const SENTINELS = {
  contactEmail: 'segredo.organizacao@exemplo.pt',
  editTokenHash: 'e'.repeat(64),
  signatureEmail: 'segredo.assinante@exemplo.pt',
  signaturePhone: '939 876 543',
  contactName: 'Responsável Secreto Sentinela',
  confirmTokenHash: 'c'.repeat(64),
  /** Key of a poster awaiting moderation: never in a public response. */
  pendingPosterKey: '01JC0000000000000000000AAA/01JC000000000000000000PEND',
};

let occSeq = 0;

/** Storage persists across tests in a file, so each test starts from empty tables. */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM event_reports'),
    env.DB.prepare('DELETE FROM event_occurrences'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM signatures'),
    env.DB.prepare('DELETE FROM admin_login_tokens'),
    env.DB.prepare('DELETE FROM admin_sessions'),
  ]);
}

export async function insertEvent(f: EventFixture): Promise<void> {
  const tz = f.tz ?? 'Europe/Lisbon';
  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (id, type, title, description, organizer, lat, lng, place_label,
         municipality, district, tz, status, verified, ongoing, contact_email, edit_token_hash,
         poster_key, poster_status, poster_width, poster_height, poster_alt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    ).bind(
      f.id,
      f.type ?? 'rally',
      f.title ?? `Evento ${f.id}`,
      'Descrição de teste.',
      'Coletivo Exemplo',
      41.1496,
      -8.6109,
      'Praça de Teste',
      'Porto',
      'Porto',
      tz,
      f.status ?? 'published',
      f.verified ? 1 : 0,
      f.ongoing ? 1 : 0,
      f.contactEmail ?? SENTINELS.contactEmail,
      f.editTokenHash ?? SENTINELS.editTokenHash,
      f.poster?.key ?? null,
      f.poster?.status ?? null,
      f.poster ? (f.poster.width ?? 800) : null,
      f.poster ? (f.poster.height ?? 1000) : null,
      f.poster?.alt ?? null,
    ),
    ...f.occurrences.map((o) => {
      const endTime = o.endTime ?? null;
      const { startsAt, endsAt } = toUtcRange(
        { localDate: o.localDate, startTime: o.startTime, endTime },
        tz,
      );
      return env.DB.prepare(
        `INSERT INTO event_occurrences (id, event_id, local_date, start_time, end_time,
           starts_at, ends_at, note, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `occ-${++occSeq}`,
        f.id,
        o.localDate,
        o.startTime,
        endTime,
        startsAt,
        endsAt,
        o.note ?? null,
        o.cancelled ? 1 : 0,
      );
    }),
  ];
  await env.DB.batch(stmts);
}

/** Stores both poster files (any bytes) under `key`. */
export async function putPosterFiles(key: string, contentType = 'image/webp'): Promise<void> {
  const httpMetadata = { contentType };
  await env.POSTERS.put(key, new Uint8Array([1, 2, 3]), { httpMetadata });
  await env.POSTERS.put(`${key}/thumb`, new Uint8Array([4, 5]), { httpMetadata });
}

/** R2 also persists across tests: empties the poster bucket. */
export async function clearPosters(): Promise<void> {
  const listed = await env.POSTERS.list();
  if (listed.objects.length) await env.POSTERS.delete(listed.objects.map((o) => o.key));
}

/** Valid ULIDs for fixtures. */
export const IDS = {
  a: '01JC0000000000000000000AAA',
  b: '01JC0000000000000000000BBB',
  c: '01JC0000000000000000000CCC',
  d: '01JC0000000000000000000DDD',
  e: '01JC0000000000000000000EEE',
  f: '01JC0000000000000000000FFF',
  g: '01JC0000000000000000000GGG',
  h: '01JC0000000000000000000HHH',
  j: '01JC0000000000000000000JJJ',
} as const;

export interface SignatureFixture {
  id: string;
  kind?: 'individual' | 'organization';
  status?: 'unconfirmed' | 'confirmed' | 'approved' | 'rejected';
  isPublic?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  pseudonym?: string | null;
  activity?: string | null;
  orgName?: string | null;
  municipality?: string;
  email?: string;
  createdAt?: string;
  confirmedAt?: string | null;
  tokenHash?: string;
  canContact?: boolean;
  contactName?: string;
  phone?: string | null;
}

/** Inserts a signature carrying a sentinel email, phone and contact name (never public). */
export async function insertSignature(f: SignatureFixture): Promise<void> {
  const org = f.kind === 'organization';
  const status = f.status ?? 'confirmed';
  const confirmedAt =
    f.confirmedAt !== undefined
      ? f.confirmedAt
      : status === 'unconfirmed'
        ? null
        : '2026-11-02T00:00:00Z';
  await env.DB.prepare(
    `INSERT INTO signatures (id, kind, first_name, last_name, pseudonym, activity, org_name,
       org_type, contact_name, website, email, municipality, phone, is_public, can_contact,
       status, confirm_token_hash, consent_text_version, created_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)`,
  )
    .bind(
      f.id,
      org ? 'organization' : 'individual',
      org ? null : f.firstName === undefined ? 'Nome' : f.firstName,
      org ? null : f.lastName === undefined ? `Fictício ${f.id.slice(-3)}` : f.lastName,
      org ? null : (f.pseudonym ?? null),
      org ? null : f.activity === undefined ? 'Profissão fictícia' : f.activity,
      org ? (f.orgName ?? `Coletivo Fictício ${f.id.slice(-3)}`) : null,
      org ? 'collective' : null,
      org ? (f.contactName ?? SENTINELS.contactName) : null,
      org ? 'https://exemplo.pt/' : null,
      f.email ?? `${f.id.toLowerCase()}.${SENTINELS.signatureEmail}`,
      f.municipality ?? '1312',
      f.phone === undefined ? SENTINELS.signaturePhone : f.phone,
      f.isPublic === false ? 0 : 1,
      f.canContact === false ? 0 : 1,
      status,
      f.tokenHash ?? `${SENTINELS.confirmTokenHash.slice(0, 54)}${f.id.slice(-10).toLowerCase()}`,
      f.createdAt ?? '2026-11-01T00:00:00Z',
      confirmedAt,
    )
    .run();
}

export async function insertReport(eventId: string, reason = 'fake', at = '2026-11-05T00:00:00Z') {
  await env.DB.prepare(
    'INSERT INTO event_reports (id, event_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(`rep-${++occSeq}`, eventId, reason, 'Detalhe da denúncia', at)
    .run();
}
