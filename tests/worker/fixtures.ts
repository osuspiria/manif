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
};

let occSeq = 0;

/** Storage persists across tests in a file, so each test starts from empty tables. */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM event_reports'),
    env.DB.prepare('DELETE FROM event_occurrences'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM signatures'),
  ]);
}

export async function insertEvent(f: EventFixture): Promise<void> {
  const tz = f.tz ?? 'Europe/Lisbon';
  const stmts = [
    env.DB.prepare(
      `INSERT INTO events (id, type, title, description, organizer, lat, lng, place_label,
         municipality, district, tz, status, verified, contact_email, edit_token_hash,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
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
      f.contactEmail ?? SENTINELS.contactEmail,
      f.editTokenHash ?? SENTINELS.editTokenHash,
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

/** Valid ULIDs for fixtures. */
export const IDS = {
  a: '01JC0000000000000000000AAA',
  b: '01JC0000000000000000000BBB',
  c: '01JC0000000000000000000CCC',
  d: '01JC0000000000000000000DDD',
  e: '01JC0000000000000000000EEE',
  f: '01JC0000000000000000000FFF',
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'test', ?, ?)`,
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
      org ? SENTINELS.contactName : null,
      org ? 'https://exemplo.pt/' : null,
      f.email ?? `${f.id.toLowerCase()}.${SENTINELS.signatureEmail}`,
      f.municipality ?? '1312',
      SENTINELS.signaturePhone,
      f.isPublic === false ? 0 : 1,
      status,
      f.tokenHash ?? `${SENTINELS.confirmTokenHash.slice(0, 54)}${f.id.slice(-10).toLowerCase()}`,
      f.createdAt ?? '2026-11-01T00:00:00Z',
      confirmedAt,
    )
    .run();
}
