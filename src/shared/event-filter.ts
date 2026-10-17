/**
 * Pure client-side event filter (SPEC §4.2): (events, filter, now) -> visible events.
 *
 * Semantics
 * - An occurrence is live if it is not cancelled and endsAt > now.
 * - An event matches if at least one live occurrence falls in the "Quando" range.
 * - Day-based filters (today, tomorrow, weekend, day) compare the occurrence's
 *   own local date(s) with Europe/Lisbon calendar dates — an Azores event at
 *   23:30 on Saturday belongs to Saturday. See docs/decisions.md.
 * - Instant-based filters (upcoming, next7) compare UTC instants.
 */
import type { EventType } from '../config/event-types';
import {
  addCivilDaysIso,
  addDays,
  lisbonToday,
  nextDates,
  nowIso,
  occurrenceLocalDates,
  weekendDates,
  type Tz,
} from './dates';

export interface FilterableOccurrence {
  id: string;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
}

export interface FilterableEvent {
  id: string;
  type: EventType;
  tz: Tz;
  occurrences: FilterableOccurrence[];
}

export type WhenFilter =
  | { kind: 'upcoming' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekend' }
  | { kind: 'next7' }
  | { kind: 'day'; date: string };

export interface EventFilter {
  when: WhenFilter;
  /** Empty = all types. */
  types: readonly EventType[];
}

export interface FilteredEvent<E extends FilterableEvent> {
  event: E;
  /** First live occurrence in range. */
  highlight: E['occurrences'][number];
  /** Live occurrences in range, chronological. */
  inRange: E['occurrences'][number][];
  /** Live occurrences outside the range, chronological ("+ N outras datas"). */
  others: E['occurrences'][number][];
}

type OccurrenceMatcher = (o: FilterableOccurrence) => boolean;

function dateMatcher(dates: readonly string[]): OccurrenceMatcher {
  const set = new Set(dates);
  return (o) => occurrenceLocalDates(o).some((d) => set.has(d));
}

function rangeMatcher(now: Date, when: WhenFilter): OccurrenceMatcher {
  switch (when.kind) {
    case 'upcoming':
      return () => true;
    case 'next7': {
      const end = addCivilDaysIso(now, 7);
      return (o) => o.startsAt < end;
    }
    case 'today':
      return dateMatcher([lisbonToday(now)]);
    case 'tomorrow':
      return dateMatcher([addDays(lisbonToday(now), 1)]);
    case 'weekend':
      return dateMatcher(weekendDates(now));
    case 'day':
      return dateMatcher([when.date]);
  }
}

function byStart(a: FilterableOccurrence, b: FilterableOccurrence): number {
  return a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0;
}

function typeMatcher(types: readonly EventType[]): (e: FilterableEvent) => boolean {
  if (types.length === 0) return () => true;
  const set = new Set(types);
  return (e) => set.has(e.type);
}

export function filterEvents<E extends FilterableEvent>(
  events: readonly E[],
  filter: EventFilter,
  now: Date,
): FilteredEvent<E>[] {
  const nowStr = nowIso(now);
  const inRange = rangeMatcher(now, filter.when);
  const typeOk = typeMatcher(filter.types);
  const results: FilteredEvent<E>[] = [];

  for (const event of events) {
    if (!typeOk(event)) continue;
    const live = event.occurrences.filter((o) => !o.cancelled && o.endsAt > nowStr).sort(byStart);
    const matching = live.filter(inRange);
    const highlight = matching[0];
    if (!highlight) continue;
    results.push({
      event,
      highlight,
      inRange: matching,
      others: live.filter((o) => !matching.includes(o)),
    });
  }

  return results.sort((a, b) => byStart(a.highlight, b.highlight));
}

/** Number of matching events per Lisbon date, for the "Escolher dia" strip. */
export function countByDay(
  events: readonly FilterableEvent[],
  types: readonly EventType[],
  now: Date,
  days: number,
): { date: string; count: number }[] {
  const nowStr = nowIso(now);
  const typeOk = typeMatcher(types);
  const counts = new Map(nextDates(now, days).map((d) => [d, 0]));

  for (const event of events) {
    if (!typeOk(event)) continue;
    const eventDates = new Set<string>();
    for (const o of event.occurrences) {
      if (o.cancelled || o.endsAt <= nowStr) continue;
      for (const d of occurrenceLocalDates(o)) eventDates.add(d);
    }
    for (const d of eventDates) {
      const c = counts.get(d);
      if (c !== undefined) counts.set(d, c + 1);
    }
  }

  return [...counts].map(([date, count]) => ({ date, count }));
}
