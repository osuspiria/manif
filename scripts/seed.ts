/**
 * Seeds the LOCAL D1 with ~50 clearly fictional events (titles start with
 * "[Exemplo]"), relative to today: single and multi-date events, weekly
 * series, all-day and overnight occurrences, cancelled occurrences, a past +
 * future mix, Madeira and the Azores, a cluster in Lisbon, plus one pending
 * and one hidden event (which must not appear on the map).
 *
 * Usage: npm run db:seed   (writes .wrangler/seed.sql, then applies it to the
 * local D1 only; wipes events first)
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { monotonicFactory } from 'ulidx';
import municipalities from '../data/geo/municipalities.geo.json' with { type: 'json' };
import { GEO_SNAP_METERS } from '../src/config/app';
import type { EventType } from '../src/config/event-types';
import { createGeoService, type MunicipalityCollection } from '../src/server/services/geo-service';
import { addDays, dayOfWeek, lisbonToday, toUtcRange } from '../src/shared/dates';

const ROOT = resolve(import.meta.dirname, '..');
const geo = createGeoService(municipalities as MunicipalityCollection, GEO_SNAP_METERS);
const ulid = monotonicFactory();
// eslint-disable-next-line no-restricted-syntax -- seed data is relative to the real today
const now = new Date();
const today = lisbonToday(now);
const nowIsoStr = now.toISOString();

/** Next date (from today, inclusive) with ISO weekday `dow`, plus `weeks` weeks. */
function nextWeekday(dow: number, weeks = 0): string {
  const delta = (dow - dayOfWeek(today) + 7) % 7;
  return addDays(today, delta + weeks * 7);
}

interface Occ {
  date: string;
  start: string | null;
  end?: string | null;
  note?: string;
  cancelled?: boolean;
}

interface Seed {
  type: EventType;
  title: string;
  lat: number;
  lng: number;
  place?: string;
  description?: string;
  organizer?: string;
  verified?: boolean;
  status?: 'published' | 'pending' | 'hidden';
  occ: Occ[];
}

const d = (n: number) => addDays(today, n);
const weekly = (first: string, count: number, start: string, end?: string): Occ[] =>
  Array.from({ length: count }, (_, i) => ({ date: addDays(first, i * 7), start, end }));

const SAT = nextWeekday(6);
const SUN = nextWeekday(7);

const SEEDS: Seed[] = [
  // --- Lisbon cluster ---------------------------------------------------------
  {
    type: 'demonstration',
    title: 'Desfile pela habitação digna',
    lat: 38.7139,
    lng: -9.1394,
    place: 'Praça do Rossio',
    organizer: 'Coletivo Exemplo de Inquilinos',
    verified: true,
    description: 'Desfile do Rossio até à Assembleia da República. Traz cartazes e água.',
    occ: [
      { date: SAT, start: '15:00', end: '18:00', note: 'Concentração às 14h30, desfile às 15h' },
    ],
  },
  {
    type: 'rally',
    title: 'Vigília pelos serviços públicos',
    lat: 38.7105,
    lng: -9.1366,
    place: 'Praça do Comércio',
    occ: [
      { date: d(1), start: '21:00', end: '23:30' },
      { date: d(8), start: '21:00', end: '23:30' },
    ],
  },
  {
    type: 'assembly',
    title: 'Assembleia aberta semanal do bairro',
    lat: 38.7165,
    lng: -9.1335,
    place: 'Largo do Intendente',
    organizer: 'Associação Fictícia de Moradores',
    occ: weekly(nextWeekday(3), 6, '19:00', '21:00'),
  },
  {
    type: 'action',
    title: 'Ação junto ao centro de saúde',
    lat: 38.7369,
    lng: -9.1427,
    place: 'Avenida de Roma',
    occ: [{ date: d(3), start: '09:00', end: '11:00' }],
  },
  {
    type: 'rally',
    title: 'Concentração em frente à câmara',
    lat: 38.7078,
    lng: -9.1393,
    place: 'Praça do Município',
    verified: true,
    occ: [{ date: today, start: '18:00', end: '20:00' }],
  },
  {
    type: 'other',
    title: 'Feira de troca solidária',
    lat: 38.7223,
    lng: -9.1393,
    place: 'Jardim do Campo Grande',
    occ: [{ date: SUN, start: null }],
  },
  {
    type: 'demonstration',
    title: 'Marcha noturna',
    lat: 38.7253,
    lng: -9.15,
    place: 'Marquês de Pombal',
    occ: [{ date: d(5), start: '22:00', end: '02:00', note: 'Vigília pela noite fora' }],
  },
  {
    type: 'assembly',
    title: 'Reunião de preparação do dia D',
    lat: 38.748,
    lng: -9.153,
    place: 'Biblioteca de exemplo',
    occ: [
      { date: d(-3), start: '18:30' },
      { date: d(4), start: '18:30' },
      { date: d(11), start: '18:30' },
    ],
  },
  // --- Greater Lisbon ----------------------------------------------------------
  {
    type: 'rally',
    title: 'Concentração na estação',
    lat: 38.679,
    lng: -9.1569,
    place: 'Cacilhas',
    occ: [{ date: d(2), start: '07:30', end: '09:00' }],
  },
  {
    type: 'action',
    title: 'Ação na rotunda',
    lat: 38.7575,
    lng: -9.2245,
    place: 'Rotunda de exemplo',
    occ: [
      { date: SAT, start: '10:00', end: '13:00' },
      { date: SUN, start: '10:00', end: '13:00' },
    ],
  },
  {
    type: 'demonstration',
    title: 'Desfile pelo transporte público',
    lat: 38.6629,
    lng: -9.0779,
    place: 'Barreiro',
    occ: [{ date: d(9), start: '16:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia de trabalhadores',
    lat: 38.5244,
    lng: -8.8882,
    place: 'Setúbal',
    occ: [{ date: d(6), start: '20:00' }],
  },
  // --- North -------------------------------------------------------------------
  {
    type: 'demonstration',
    title: 'Desfile na Avenida dos Aliados',
    lat: 41.1496,
    lng: -8.6109,
    place: 'Avenida dos Aliados',
    verified: true,
    occ: [
      { date: SAT, start: '15:00', end: '18:00' },
      { date: addDays(SAT, 14), start: '15:00', end: '18:00' },
    ],
  },
  {
    type: 'rally',
    title: 'Concentração na Praça da Batalha',
    lat: 41.1456,
    lng: -8.606,
    place: 'Praça da Batalha',
    occ: [
      { date: d(1), start: '18:00' },
      { date: d(2), start: '18:00', cancelled: true },
      { date: d(3), start: '18:00' },
    ],
  },
  {
    type: 'assembly',
    title: 'Assembleia aberta na Foz',
    lat: 41.153,
    lng: -8.675,
    occ: weekly(nextWeekday(2), 4, '19:30'),
  },
  {
    type: 'action',
    title: 'Ação no porto de Leixões',
    lat: 41.183,
    lng: -8.7,
    place: 'Matosinhos',
    occ: [{ date: d(7), start: '06:00', end: '10:00' }],
  },
  {
    type: 'rally',
    title: 'Vigília em Gaia',
    lat: 41.1239,
    lng: -8.6118,
    occ: [{ date: d(4), start: '21:00' }],
  },
  {
    type: 'demonstration',
    title: 'Desfile em Braga',
    lat: 41.5503,
    lng: -8.42,
    place: 'Avenida Central',
    occ: [{ date: SUN, start: '11:00', end: '13:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia em Guimarães',
    lat: 41.4425,
    lng: -8.2918,
    occ: [{ date: d(10), start: '20:00' }],
  },
  {
    type: 'rally',
    title: 'Concentração em Viana',
    lat: 41.6932,
    lng: -8.8329,
    occ: [{ date: d(12), start: '17:00' }],
  },
  {
    type: 'action',
    title: 'Ação em Vila Real',
    lat: 41.3006,
    lng: -7.7441,
    occ: [{ date: d(15), start: null }],
  },
  {
    type: 'rally',
    title: 'Concentração em Bragança',
    lat: 41.8061,
    lng: -6.7567,
    place: 'Praça da Sé',
    occ: [{ date: SAT, start: '11:00' }],
  },
  {
    type: 'assembly',
    title: 'Reunião aberta em Chaves',
    lat: 41.74,
    lng: -7.47,
    occ: [{ date: d(20), start: '18:00' }],
  },
  {
    type: 'other',
    title: 'Sessão de esclarecimento em Mirandela',
    lat: 41.485,
    lng: -7.182,
    occ: [{ date: d(25), start: '21:00' }],
  },
  // --- Centre ------------------------------------------------------------------
  {
    type: 'demonstration',
    title: 'Desfile em Coimbra',
    lat: 40.2033,
    lng: -8.4103,
    place: 'Praça 8 de Maio',
    occ: [{ date: SAT, start: '16:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia estudantil',
    lat: 40.2077,
    lng: -8.4265,
    place: 'Universidade (exemplo)',
    occ: weekly(nextWeekday(4), 5, '18:00', '20:00'),
  },
  {
    type: 'rally',
    title: 'Concentração em Aveiro',
    lat: 40.6405,
    lng: -8.6538,
    occ: [{ date: d(2), start: '18:30' }],
  },
  {
    type: 'action',
    title: 'Ação em Leiria',
    lat: 39.7436,
    lng: -8.8071,
    occ: [{ date: d(6), start: '10:00', end: '12:00' }],
  },
  {
    type: 'rally',
    title: 'Vigília em Viseu',
    lat: 40.6566,
    lng: -7.9125,
    occ: [{ date: d(9), start: '21:00' }],
  },
  {
    type: 'demonstration',
    title: 'Desfile na Guarda',
    lat: 40.5373,
    lng: -7.2676,
    occ: [{ date: d(13), start: '15:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia em Castelo Branco',
    lat: 39.8222,
    lng: -7.4909,
    occ: [{ date: d(16), start: '20:30' }],
  },
  {
    type: 'action',
    title: 'Ação na Covilhã',
    lat: 40.28,
    lng: -7.504,
    occ: [{ date: d(18), start: '09:00' }],
  },
  {
    type: 'rally',
    title: 'Concentração em Santarém',
    lat: 39.2362,
    lng: -8.685,
    occ: [{ date: d(5), start: '18:00' }],
  },
  {
    type: 'other',
    title: 'Concerto solidário em Tomar',
    lat: 39.6036,
    lng: -8.4091,
    occ: [{ date: d(22), start: '21:30', end: '00:30' }],
  },
  // --- South -------------------------------------------------------------------
  {
    type: 'demonstration',
    title: 'Desfile em Évora',
    lat: 38.5714,
    lng: -7.9135,
    place: 'Praça do Giraldo',
    occ: [{ date: SAT, start: '17:00' }],
  },
  {
    type: 'rally',
    title: 'Concentração em Beja',
    lat: 38.0151,
    lng: -7.8632,
    occ: [{ date: d(8), start: '18:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia em Portalegre',
    lat: 39.2967,
    lng: -7.4285,
    occ: [{ date: d(14), start: '21:00' }],
  },
  {
    type: 'action',
    title: 'Ação no porto de Sines',
    lat: 37.956,
    lng: -8.869,
    occ: [{ date: d(3), start: '06:30', end: '09:30' }],
  },
  {
    type: 'demonstration',
    title: 'Desfile em Faro',
    lat: 37.0194,
    lng: -7.9304,
    place: 'Jardim Manuel Bivar',
    occ: [
      { date: SUN, start: '10:30' },
      { date: addDays(SUN, 7), start: '10:30' },
    ],
  },
  {
    type: 'rally',
    title: 'Concentração em Portimão',
    lat: 37.1366,
    lng: -8.5377,
    occ: [{ date: d(11), start: '18:00' }],
  },
  {
    type: 'other',
    title: 'Piquenique reivindicativo em Lagos',
    lat: 37.1028,
    lng: -8.673,
    occ: [{ date: d(30), start: null }],
  },
  // --- Madeira -----------------------------------------------------------------
  {
    type: 'demonstration',
    title: 'Desfile no Funchal',
    lat: 32.6497,
    lng: -16.9086,
    place: 'Avenida Arriaga',
    occ: [{ date: SAT, start: '16:00' }],
  },
  {
    type: 'assembly',
    title: 'Assembleia em Machico',
    lat: 32.718,
    lng: -16.766,
    occ: [{ date: d(6), start: '19:00' }],
  },
  {
    type: 'rally',
    title: 'Concentração no Porto Santo',
    lat: 33.0611,
    lng: -16.3369,
    occ: [{ date: d(12), start: '18:00' }],
  },
  // --- Azores ------------------------------------------------------------------
  {
    type: 'rally',
    title: 'Vigília noturna em Ponta Delgada',
    lat: 37.7412,
    lng: -25.6756,
    place: 'Portas da Cidade',
    occ: [{ date: SAT, start: '23:30', note: 'Perto da meia-noite, hora local' }],
  },
  {
    type: 'demonstration',
    title: 'Desfile em Angra do Heroísmo',
    lat: 38.655,
    lng: -27.22,
    occ: [
      { date: d(2), start: '17:00' },
      { date: d(9), start: '17:00' },
    ],
  },
  {
    type: 'assembly',
    title: 'Assembleia na Horta',
    lat: 38.535,
    lng: -28.629,
    occ: [{ date: d(7), start: '20:00' }],
  },
  {
    type: 'action',
    title: 'Ação nas Flores',
    lat: 39.455,
    lng: -31.13,
    occ: [{ date: d(17), start: '10:00' }],
  },
  // --- Not visible ---------------------------------------------------------------
  {
    type: 'rally',
    title: 'Evento pendente (não deve aparecer)',
    lat: 38.72,
    lng: -9.14,
    status: 'pending',
    occ: [{ date: d(2), start: '10:00' }],
  },
  {
    type: 'rally',
    title: 'Evento oculto (não deve aparecer)',
    lat: 41.15,
    lng: -8.61,
    status: 'hidden',
    occ: [{ date: d(2), start: '10:00' }],
  },
  {
    type: 'rally',
    title: 'Evento já terminado',
    lat: 40.21,
    lng: -8.42,
    occ: [{ date: d(-5), start: '10:00' }],
  },
  {
    type: 'action',
    title: 'Evento com todas as datas canceladas',
    lat: 37.02,
    lng: -7.93,
    occ: [{ date: d(4), start: '10:00', cancelled: true }],
  },
];

const q = (v: string | number | null | undefined): string =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${v.replaceAll("'", "''")}'`;

const sql: string[] = [
  'DELETE FROM event_reports;',
  'DELETE FROM event_occurrences;',
  'DELETE FROM events;',
];

for (const s of SEEDS) {
  const place = geo.reverse(s.lat, s.lng);
  if (!place) throw new Error(`Seed point outside Portugal: ${s.title}`);
  const id = ulid();
  const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
  sql.push(
    `INSERT INTO events (id, type, title, description, organizer, lat, lng, place_label, municipality, district, tz, status, verified, contact_email, edit_token_hash, created_at, updated_at) VALUES (${[
      id,
      s.type,
      `[Exemplo] ${s.title}`,
      s.description ?? 'Evento fictício, criado para testar o mapa.',
      s.organizer ?? null,
      s.lat,
      s.lng,
      s.place ?? null,
      place.municipality,
      place.district,
      place.tz,
      s.status ?? 'published',
      s.verified ? 1 : 0,
      null,
      tokenHash,
      nowIsoStr,
      nowIsoStr,
    ]
      .map(q)
      .join(', ')});`,
  );
  for (const o of s.occ) {
    const { startsAt, endsAt } = toUtcRange(
      { localDate: o.date, startTime: o.start, endTime: o.end ?? null },
      place.tz,
    );
    sql.push(
      `INSERT INTO event_occurrences (id, event_id, local_date, start_time, end_time, starts_at, ends_at, note, cancelled) VALUES (${[
        ulid(),
        id,
        o.date,
        o.start,
        o.end ?? null,
        startsAt,
        endsAt,
        o.note ?? null,
        o.cancelled ? 1 : 0,
      ]
        .map(q)
        .join(', ')});`,
    );
  }
}

const dir = join(ROOT, '.wrangler');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'seed.sql');
writeFileSync(file, sql.join('\n') + '\n');

console.log(`Wrote ${SEEDS.length} events to ${file} (today = ${today}).`);
