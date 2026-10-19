/**
 * All date / time-zone logic. Pure functions: anything that depends on the
 * current time receives `now` as an argument.
 *
 * Conventions
 * - Local dates are 'YYYY-MM-DD', local times 'HH:MM', both in the event's tz.
 * - UTC instants are ISO strings ending in 'Z' (e.g. '2026-11-25T14:00:00Z');
 *   they compare correctly as strings.
 * - Ranges are half-open: [startsAt, endsAt).
 * - Without an end time (or all day), an occurrence stays live until
 *   OPEN_END_TIME on the next local day, so late events don't vanish at midnight.
 * - Calendar filters ("Hoje", "Fim de semana"…) use the Europe/Lisbon calendar.
 */
import { Temporal } from 'temporal-polyfill';
import { pt } from '../i18n/pt';

export const TIME_ZONES = ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'] as const;
export type Tz = (typeof TIME_ZONES)[number];

export const CALENDAR_TZ: Tz = 'Europe/Lisbon';

/** Local time on the next day at which an occurrence without an end time ends. */
export const OPEN_END_TIME = '06:00';

export interface LocalOccurrence {
  localDate: string;
  /** null = all day */
  startTime: string | null;
  /** null = until OPEN_END_TIME on the next day. Earlier than startTime = ends the next day. */
  endTime: string | null;
}

export interface UtcRange {
  startsAt: string;
  endsAt: string;
}

/** Instant formatted as 'YYYY-MM-DDTHH:MM:SSZ'. */
function instantToIso(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: 'second' });
}

function startOfLocalDay(date: Temporal.PlainDate, tz: Tz): Temporal.ZonedDateTime {
  // Handles days whose midnight does not exist (e.g. Azores on the March DST Sunday).
  return date.toZonedDateTime({ timeZone: tz });
}

function atLocalTime(date: Temporal.PlainDate, time: string, tz: Tz): Temporal.ZonedDateTime {
  // 'compatible': a non-existent time moves forward; an ambiguous one takes the earlier instant.
  return date
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(tz, { disambiguation: 'compatible' });
}

/** Whether an occurrence's end time falls on the day after its local date. */
function crossesMidnight(o: LocalOccurrence): boolean {
  return o.startTime !== null && o.endTime !== null && o.endTime <= o.startTime;
}

/** Computes the UTC range of an occurrence given in local time. */
export function toUtcRange(o: LocalOccurrence, tz: Tz): UtcRange {
  const date = Temporal.PlainDate.from(o.localDate);
  const nextDay = date.add({ days: 1 });

  const start =
    o.startTime === null ? startOfLocalDay(date, tz) : atLocalTime(date, o.startTime, tz);

  let end: Temporal.ZonedDateTime;
  if (o.startTime === null || o.endTime === null) {
    end = atLocalTime(nextDay, OPEN_END_TIME, tz);
  } else if (crossesMidnight(o)) {
    end = atLocalTime(nextDay, o.endTime, tz);
  } else {
    end = atLocalTime(date, o.endTime, tz);
  }

  return { startsAt: instantToIso(start.toInstant()), endsAt: instantToIso(end.toInstant()) };
}

/**
 * Local calendar dates an occurrence touches: its own date, plus the next one
 * when it runs past midnight (an end at exactly 00:00 does not count).
 */
export function occurrenceLocalDates(o: LocalOccurrence): string[] {
  if (crossesMidnight(o) && o.endTime !== '00:00') {
    return [o.localDate, addDays(o.localDate, 1)];
  }
  return [o.localDate];
}

export function toInstant(now: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime());
}

export function nowIso(now: Date): string {
  return instantToIso(toInstant(now));
}

/** Civil date in Europe/Lisbon at `now`. */
export function lisbonToday(now: Date): string {
  return toInstant(now).toZonedDateTimeISO(CALENDAR_TZ).toPlainDate().toString();
}

/** Civil date in the given time zone at `now`. */
export function todayIn(tz: Tz, now: Date): string {
  return toInstant(now).toZonedDateTimeISO(tz).toPlainDate().toString();
}

/** Adds calendar months, clamping to the end of the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  return Temporal.PlainDate.from(date).add({ months }, { overflow: 'constrain' }).toString();
}

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

/** 'YYYY-MM-DD' naming a real calendar day (no 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

/** ISO day of week: Monday = 1 … Sunday = 7. */
export function dayOfWeek(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek;
}

/**
 * Dates of the "Fim de semana" filter: the coming Saturday and Sunday; the
 * current weekend on a Saturday; only the current Sunday on a Sunday.
 */
export function weekendDates(now: Date): string[] {
  const today = lisbonToday(now);
  const dow = dayOfWeek(today);
  if (dow === 7) return [today];
  const saturday = addDays(today, 6 - dow);
  return [saturday, addDays(saturday, 1)];
}

/** `now` + N civil days in Europe/Lisbon, as a UTC ISO instant (DST-aware). */
export function addCivilDaysIso(now: Date, days: number): string {
  return instantToIso(toInstant(now).toZonedDateTimeISO(CALENDAR_TZ).add({ days }).toInstant());
}

/** Consecutive Lisbon dates starting today. */
export function nextDates(now: Date, count: number): string[] {
  const today = lisbonToday(now);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

/** Labels for the day strip, e.g. { weekday: 'sáb', day: '24' }. */
export function formatDayChip(date: string): { weekday: string; day: string } {
  const d = Temporal.PlainDate.from(date);
  // ICU's pt-PT "short" weekday is the full name, so the abbreviations live in i18n.
  return { weekday: pt.weekdaysShort[d.dayOfWeek - 1] ?? '', day: String(d.day) };
}

/** An ISO instant + N civil days in Europe/Lisbon (DST-aware), as a UTC ISO instant. */
export function addCivilDaysToIso(iso: string, days: number): string {
  return instantToIso(
    Temporal.Instant.from(iso).toZonedDateTimeISO(CALENDAR_TZ).add({ days }).toInstant(),
  );
}

/** E.g. '24 de outubro de 2026, 18:05' (Lisbon time), for emails. */
export function formatLisbonDateTime(iso: string): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(CALENDAR_TZ);
  const hm = `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
  return `${z.day} de ${pt.monthsLong[z.month - 1] ?? ''} de ${z.year}, ${hm}`;
}

/** `now` + an exact duration (not civil days), as a UTC ISO instant. */
export function addDurationIso(now: Date, d: { minutes?: number; hours?: number }): string {
  return instantToIso(toInstant(now).add({ minutes: d.minutes ?? 0, hours: d.hours ?? 0 }));
}

/** E.g. 'sáb 28 nov, 10:00' (Lisbon time), for compact lists. */
export function formatInstantShort(iso: string): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(CALENDAR_TZ);
  const hm = `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
  return `${pt.weekdaysShort[z.dayOfWeek - 1] ?? ''} ${z.day} ${pt.monthsShort[z.month - 1] ?? ''} ${z.year}, ${hm}`;
}

/** '2026-10-17' → '17 de outubro de 2026'. */
export function formatDateWithYear(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return `${d.day} de ${pt.monthsLong[d.month - 1] ?? ''} de ${d.year}`;
}
