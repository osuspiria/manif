/**
 * Business rules for event dates (SPEC §3.1), shared by the form and the API:
 * every occurrence must not have ended yet, be at most 12 months ahead, and
 * not repeat the same date + start time.
 */
import { LIMITS } from '../config/app';
import {
  addDays,
  addMonths,
  nowIso,
  todayIn,
  toUtcRange,
  type LocalOccurrence,
  type Tz,
} from './dates';
import type { ApiIssue } from './schemas';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function wellFormed(o: LocalOccurrence): boolean {
  if (!DATE_RE.test(o.localDate)) return false;
  if (o.startTime !== null && !TIME_RE.test(o.startTime)) return false;
  if (o.endTime !== null && (!TIME_RE.test(o.endTime) || o.startTime === null)) return false;
  return true;
}

export function checkOccurrences(
  occurrences: readonly LocalOccurrence[],
  tz: Tz,
  now: Date,
  /** Indexes to skip (e.g. past occurrences kept unchanged when editing). */
  skip: (index: number) => boolean = () => false,
): ApiIssue[] {
  const at = nowIso(now);
  const maxDate = addMonths(todayIn(tz, now), LIMITS.occurrenceMaxMonthsAhead);
  const seen = new Set<string>();
  const issues: ApiIssue[] = [];

  occurrences.forEach((o, i) => {
    const key = `${o.localDate}|${o.startTime ?? ''}`;
    const duplicate = seen.has(key);
    seen.add(key);
    if (skip(i)) return;

    // Malformed rows are reported by the schema; nothing to check here.
    if (!wellFormed(o)) return;
    const path = ['occurrences', i, 'localDate'];
    if (toUtcRange(o, tz).endsAt <= at) issues.push({ path, code: 'occurrence_past' });
    else if (o.localDate > maxDate) issues.push({ path, code: 'occurrence_too_far' });
    else if (duplicate) issues.push({ path, code: 'occurrence_duplicate' });
  });

  return issues;
}

/**
 * "Repetir semanalmente até…": the dates one, two… weeks after `first`, up to
 * and including `until`, at most `max` of them. Local dates, so no DST drift.
 */
export function weeklyRepeat(first: string, until: string, max: number): string[] {
  const dates: string[] = [];
  for (let d = addDays(first, 7); d <= until && dates.length < max; d = addDays(d, 7)) {
    dates.push(d);
  }
  return dates;
}
