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
 * - "Já aconteceram" (past) is the other way round: events with at least one
 *   non-cancelled occurrence that has ended, most recent first. Ongoing events
 *   never count as past.
 * - Ongoing events ("sem fim", set by a moderator) also get an all-day
 *   occurrence on every day from their first date on. See docs/decisions.md #74.
 */
import { LIMITS } from '../config/app';
import type { EventType } from '../config/event-types';
import {
  addCivilDaysIso,
  addDays,
  lisbonToday,
  nextDates,
  nowIso,
  occurrenceLocalDates,
  todayIn,
  toUtcRange,
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
  /** Ongoing ("sem fim"): local date of its first occurrence; null/absent = normal event. */
  ongoingSince?: string | null;
}

export type WhenFilter =
  | { kind: 'upcoming' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekend' }
  | { kind: 'next7' }
  | { kind: 'past' }
  | { kind: 'day'; date: string };

export interface EventFilter {
  when: WhenFilter;
  /** Empty = all types. */
  types: readonly EventType[];
}

export interface FilteredEvent<E extends FilterableEvent> {
  event: E;
  /** First live occurrence in range (past: the most recent ended one). */
  highlight: E['occurrences'][number];
  /** Live occurrences in range, chronological (past: ended ones, newest first). */
  inRange: E['occurrences'][number][];
  /** Live occurrences outside the range, chronological ("+ N outras datas"). */
  others: E['occurrences'][number][];
}

type OccurrenceMatcher = (o: FilterableOccurrence) => boolean;

/** Upcoming-style filters: everything except 'past'. */
type LiveWhen = Exclude<WhenFilter, { kind: 'past' }>;

function dateMatcher(dates: readonly string[]): OccurrenceMatcher {
  const set = new Set(dates);
  return (o) => occurrenceLocalDates(o).some((d) => set.has(d));
}

function rangeMatcher(now: Date, when: LiveWhen): OccurrenceMatcher {
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

/** How many days ahead ongoing events get their daily occurrences (covers the day strip). */
const ONGOING_DAYS_AHEAD = Math.max(LIMITS.dayStripDays, 8);

/**
 * The event's occurrences plus, for an ongoing event, an all-day occurrence for
 * each local date from yesterday (it lasts until 06:00, see #73) up to
 * `daysAhead` days ahead, never before `ongoingSince`. Dates that already have
 * an occurrence keep it (a cancelled date stays cancelled).
 */
export function withOngoingDays<E extends FilterableEvent>(
  event: E,
  now: Date,
  daysAhead: number = ONGOING_DAYS_AHEAD,
): E['occurrences'] {
  const since = event.ongoingSince;
  if (!since) return event.occurrences;
  const today = todayIn(event.tz, now);
  const last = addDays(today, daysAhead);
  const yesterday = addDays(today, -1);
  const taken = new Set(event.occurrences.map((o) => o.localDate));
  const extra: FilterableOccurrence[] = [];
  for (let d = since > yesterday ? since : yesterday; d <= last; d = addDays(d, 1)) {
    if (taken.has(d)) continue;
    const local = { localDate: d, startTime: null, endTime: null };
    extra.push({
      id: `${event.id}:${d}`,
      ...local,
      ...toUtcRange(local, event.tz),
      cancelled: false,
    });
  }
  // Virtual occurrences only carry the filterable fields; callers that need more
  // (note…) read them from real occurrences.
  return [...event.occurrences, ...(extra as E['occurrences'])];
}

export function filterEvents<E extends FilterableEvent>(
  events: readonly E[],
  filter: EventFilter,
  now: Date,
): FilteredEvent<E>[] {
  if (filter.when.kind === 'past') return filterPast(events, filter.types, now);
  const nowStr = nowIso(now);
  const inRange = rangeMatcher(now, filter.when);
  const typeOk = typeMatcher(filter.types);
  const results: FilteredEvent<E>[] = [];

  for (const event of events) {
    if (!typeOk(event)) continue;
    const live = withOngoingDays(event, now)
      .filter((o) => !o.cancelled && o.endsAt > nowStr)
      .sort(byStart);
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

function filterPast<E extends FilterableEvent>(
  events: readonly E[],
  types: readonly EventType[],
  now: Date,
): FilteredEvent<E>[] {
  const nowStr = nowIso(now);
  const typeOk = typeMatcher(types);
  const results: FilteredEvent<E>[] = [];

  for (const event of events) {
    if (event.ongoingSince || !typeOk(event)) continue;
    const kept = event.occurrences.filter((o) => !o.cancelled).sort(byStart);
    const ended = kept.filter((o) => o.endsAt <= nowStr).reverse();
    const highlight = ended[0];
    if (!highlight) continue;
    results.push({
      event,
      highlight,
      inRange: ended,
      others: kept.filter((o) => o.endsAt > nowStr),
    });
  }

  return results.sort((a, b) => byStart(b.highlight, a.highlight));
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
    for (const o of withOngoingDays(event, now, days)) {
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
