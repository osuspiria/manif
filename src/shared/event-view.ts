/**
 * Pure presentation helpers for events: labels, grouping, counters.
 * Local dates/times are already in the event's tz, so no tz maths is needed
 * here — only labels.
 */
import { Temporal } from 'temporal-polyfill';
import { EVENT_TYPE_KEYS, type EventType } from '../config/event-types';
import { pt } from '../i18n/pt';
import type { LocalOccurrence, Tz } from './dates';
import type { FilterableEvent, FilteredEvent, WhenFilter } from './event-filter';

function parts(date: string) {
  const d = Temporal.PlainDate.from(date);
  return {
    day: d.day,
    month: d.month,
    weekdayShort: pt.weekdaysShort[d.dayOfWeek - 1] ?? '',
    weekdayLong: pt.weekdaysLong[d.dayOfWeek - 1] ?? '',
    monthShort: pt.monthsShort[d.month - 1] ?? '',
    monthLong: pt.monthsLong[d.month - 1] ?? '',
  };
}

/** 'ter, 24 nov' */
export function formatShortDayLabel(date: string): string {
  const p = parts(date);
  return `${p.weekdayShort}, ${p.day} ${p.monthShort}`;
}

/** 'Sábado, 28 nov' — list group headings. */
export function formatDayHeading(date: string): string {
  const p = parts(date);
  return `${p.weekdayLong}, ${p.day} ${p.monthShort}`;
}

/** 'sábado, 28 de novembro' — accessible labels. */
export function formatLongDate(date: string): string {
  const p = parts(date);
  return `${p.weekdayLong.toLowerCase()}, ${p.day} de ${p.monthLong}`;
}

/** '28/11' — marker labels. */
export function formatShortDate(date: string): string {
  const p = parts(date);
  return `${p.day}/${p.month}`;
}

/** '15:00–18:00', 'todo o dia', with '(hora dos Açores)' when relevant. */
function formatTimes(o: LocalOccurrence, tz: Tz): string {
  if (o.startTime === null) return pt.event.allDay;
  const time = o.endTime ? `${o.startTime}–${o.endTime}` : o.startTime;
  const suffix = tz === 'Atlantic/Azores' ? ` ${pt.tz.azoresSuffix}` : '';
  return `${time}${suffix}`;
}

/** 'ter, 24 nov · 15:00–18:00', with '(hora dos Açores)' when relevant. */
export function formatOccurrence(o: LocalOccurrence, tz: Tz): string {
  return `${formatShortDayLabel(o.localDate)} · ${formatTimes(o, tz)}`;
}

/** 'Todos os dias de 31 out a 12 nov · todo o dia' — a run from collapseDailyRuns. */
export function formatDailyRun(first: LocalOccurrence, last: LocalOccurrence, tz: Tz): string {
  const day = (date: string) => {
    const p = parts(date);
    return `${p.day} ${p.monthShort}`;
  };
  return `${pt.event.dailyRun(day(first.localDate), day(last.localDate))} · ${formatTimes(first, tz)}`;
}

export interface RunnableOccurrence extends LocalOccurrence {
  cancelled: boolean;
  note: string | null;
}

export type DateEntry<T> =
  { kind: 'one'; item: T } | { kind: 'daily'; first: T; last: T; count: number };

/** Shortest run of daily dates worth folding into one line. */
const MIN_DAILY_RUN = 3;

/**
 * Folds consecutive days with the same times into one entry, so a daily event
 * reads as one line instead of a column of identical dates. Cancelled dates and
 * dates with a note always stay on their own. `items` must be in date order;
 * `together` can keep apart items the caller shows differently.
 */
export function collapseDailyRuns<T>(
  items: readonly T[],
  occ: (item: T) => RunnableOccurrence,
  together: (a: T, b: T) => boolean = () => true,
): DateEntry<T>[] {
  const plain = (o: RunnableOccurrence) => !o.cancelled && !o.note;
  const follows = (prev: T, next: T) => {
    const a = occ(prev);
    const b = occ(next);
    return (
      plain(a) &&
      plain(b) &&
      a.startTime === b.startTime &&
      a.endTime === b.endTime &&
      together(prev, next) &&
      Temporal.PlainDate.from(a.localDate).add({ days: 1 }).toString() === b.localDate
    );
  };

  const entries: DateEntry<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first !== undefined && last !== undefined && run.length >= MIN_DAILY_RUN) {
      entries.push({ kind: 'daily', first, last, count: run.length });
    } else {
      for (const item of run) entries.push({ kind: 'one', item });
    }
    run = [];
  };
  for (const item of items) {
    const prev = run.at(-1);
    if (prev !== undefined && !follows(prev, item)) flush();
    run.push(item);
  }
  flush();
  return entries;
}

export interface PlaceParts {
  placeLabel: string | null;
  municipality: string;
  district: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/**
 * 'Alameda D. Afonso Henriques · Lisboa': the place name, the municipality and
 * (with `district`) the district, without saying the same name twice — people
 * often type the town in the place name, and some municipalities share the
 * name of their district.
 */
export function formatPlace(
  e: PlaceParts,
  { district = false, separator = ' · ' }: { district?: boolean; separator?: string } = {},
): string {
  const town = fold(e.municipality);
  let label = e.placeLabel?.trim() ?? '';
  const comma = label.lastIndexOf(',');
  if (comma > 0 && fold(label.slice(comma + 1)) === town) label = label.slice(0, comma).trim();
  if (fold(label) === town) label = '';
  const items = [label, e.municipality];
  if (district && fold(e.district) !== town) items.push(e.district);
  return items.filter(Boolean).join(separator);
}

/** 'Todos os dias desde seg, 12 out' — ongoing ("sem fim") events. */
export function formatOngoing(since: string): string {
  return pt.event.ongoing(formatShortDayLabel(since));
}

export function formatCount(n: number): string {
  return n === 1 ? pt.count.one : pt.count.many(n);
}

function whenLabel(when: WhenFilter): string {
  return when.kind === 'day' ? formatShortDayLabel(when.date) : pt.summary[when.kind];
}

/** '23 eventos · Este fim de semana · 2 tipos' */
export function summaryLabel(count: number, when: WhenFilter, types: readonly EventType[]): string {
  const items = [formatCount(count), whenLabel(when)];
  if (types.length > 0) items.push(pt.summary.types(types.length));
  return items.join(' · ');
}

/** Whether the filter range can span several days (→ show day labels on markers). */
export function showsDayLabels(when: WhenFilter): boolean {
  return (
    when.kind === 'upcoming' ||
    when.kind === 'next7' ||
    when.kind === 'weekend' ||
    when.kind === 'past'
  );
}

export function countByType(
  results: readonly FilteredEvent<FilterableEvent>[],
): Record<EventType, number> {
  const counts = Object.fromEntries(EVENT_TYPE_KEYS.map((k) => [k, 0])) as Record<
    EventType,
    number
  >;
  for (const r of results) counts[r.event.type]++;
  return counts;
}

export interface DayGroup<E extends FilterableEvent> {
  date: string;
  items: FilteredEvent<E>[];
}

/**
 * Groups results by the local date of their highlighted occurrence, in date
 * order ('desc': newest first, for past events). Items keep the results' order.
 */
export function groupByDay<E extends FilterableEvent>(
  results: readonly FilteredEvent<E>[],
  order: 'asc' | 'desc' = 'asc',
): DayGroup<E>[] {
  const groups = new Map<string, FilteredEvent<E>[]>();
  for (const r of results) {
    const key = r.highlight.localDate;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0) * (order === 'desc' ? -1 : 1))
    .map(([date, items]) => ({ date, items }));
}
