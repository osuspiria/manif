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

/** 'ter, 24 nov · 15:00–18:00', with '(hora dos Açores)' when relevant. */
export function formatOccurrence(o: LocalOccurrence, tz: Tz): string {
  const day = formatShortDayLabel(o.localDate);
  if (o.startTime === null) return `${day} · ${pt.event.allDay}`;
  const time = o.endTime ? `${o.startTime}–${o.endTime}` : o.startTime;
  const suffix = tz === 'Atlantic/Azores' ? ` ${pt.tz.azoresSuffix}` : '';
  return `${day} · ${time}${suffix}`;
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
  return when.kind === 'upcoming' || when.kind === 'next7' || when.kind === 'weekend';
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

/** Groups results by the local date of their highlighted occurrence, in date order. */
export function groupByDay<E extends FilterableEvent>(
  results: readonly FilteredEvent<E>[],
): DayGroup<E>[] {
  const groups = new Map<string, FilteredEvent<E>[]>();
  for (const r of results) {
    const key = r.highlight.localDate;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, items]) => ({ date, items }));
}
