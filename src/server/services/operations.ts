/**
 * Operations (docs/decisions.md #82): the daily job with an alert when it fails,
 * the morning moderation digest, and the admin activity table.
 * Knows nothing about Hono, D1 or KV.
 */
import { ADMIN, APP_NAME } from '../../config/app';
import { pt } from '../../i18n/pt';
import {
  addCivilDaysIso,
  addDays,
  addDurationIso,
  formatInstantShort,
  lisbonToday,
  nowIso,
} from '../../shared/dates';
import type { AdminActivity, AdminEventCounts } from '../../shared/schemas';
import type { MailMessage, Mailer } from '../mailer';
import type { AdminEventsRepo } from '../repos/admin-repo';
import type { OpsStore } from '../repos/ops-store';

export interface OpsDeps {
  events: AdminEventsRepo;
  ops: OpsStore;
  mailer: Mailer;
  /** ADMIN_EMAILS. */
  admins: readonly string[];
  /** Site origin for links in emails ('https://…'), or null when unknown. */
  origin: string | null;
  now: Date;
}

async function mailAll(d: OpsDeps, message: Omit<MailMessage, 'to'>): Promise<void> {
  for (const to of d.admins) {
    try {
      await d.mailer.send({ ...message, to });
    } catch {
      // Never log the address.
      console.error('ops email failed');
    }
  }
}

const adminUrl = (origin: string | null) => (origin ? `${origin}/admin/` : '/admin/');

// --- daily job ------------------------------------------------------------------------

/**
 * Runs `job`; on success records the time (the admin warns when it gets old),
 * on failure emails the admins. Logs the error name only.
 */
export async function runDailyJob<T>(job: () => Promise<T>, d: OpsDeps): Promise<T | null> {
  try {
    const result = await job();
    await d.ops.setLastRetentionAt(nowIso(d.now));
    return result;
  } catch (e) {
    const code = e instanceof Error ? e.name : 'unknown';
    console.error(`daily job failed: ${code}`);
    await mailAll(d, {
      subject: pt.email.dailyJobFailedSubject(APP_NAME),
      text: pt.email.dailyJobFailedText(code, adminUrl(d.origin)),
    });
    return null;
  }
}

// --- morning digest -------------------------------------------------------------------

export interface DigestSoon {
  title: string;
  startsAt: string;
}

/** The digest, or null when there is nothing to moderate. Pure. */
export function buildDigest(
  counts: AdminEventCounts,
  soon: readonly DigestSoon[],
  origin: string | null,
): Omit<MailMessage, 'to'> | null {
  const queues = (['unverified', 'pending', 'reported', 'posters'] as const).filter(
    (q) => counts[q] > 0,
  );
  if (!queues.length) return null;
  const lines = queues.map((q) => pt.email.digestQueue(q, counts[q]));
  const soonLines = soon.map((e) => `${e.title} (${formatInstantShort(e.startsAt)})`);
  return {
    subject: pt.email.digestSubject(APP_NAME, lines),
    text: pt.email.digestText(lines, soonLines, adminUrl(origin)),
  };
}

export async function sendDigest(d: OpsDeps): Promise<boolean> {
  const at = nowIso(d.now);
  const until = addDurationIso(d.now, { hours: ADMIN.digestSoonHours });
  const [counts, unverified] = await Promise.all([
    d.events.counts(at),
    d.events.list('unverified', null, at, ADMIN.listLimit),
  ]);
  const soon = unverified
    .filter((e) => e.next_starts_at !== null && e.next_starts_at <= until)
    .slice(0, ADMIN.digestSoonMax)
    .map((e) => ({ title: e.title, startsAt: e.next_starts_at ?? '' }));
  const digest = buildDigest(counts, soon, d.origin);
  if (!digest) return false;
  await mailAll(d, digest);
  return true;
}

// --- admin activity -------------------------------------------------------------------

export async function adminActivity(
  d: Pick<OpsDeps, 'events' | 'ops' | 'now'>,
): Promise<AdminActivity> {
  const today = lisbonToday(d.now);
  const dates = Array.from({ length: ADMIN.activityDays }, (_, i) => addDays(today, -i));
  const oldest = dates.at(-1) ?? today;
  // A day before the oldest Lisbon date covers its first hours in UTC.
  const since = addCivilDaysIso(d.now, -ADMIN.activityDays);
  const [created, extractions, last] = await Promise.all([
    d.events.createdSince(since),
    Promise.all(dates.map((date) => d.ops.extractions(date))),
    d.ops.lastRetentionAt(),
  ]);
  const perDay = new Map<string, number>();
  for (const iso of created) {
    const date = lisbonToday(new Date(iso));
    if (date >= oldest) perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }
  const staleBefore = addDurationIso(d.now, { hours: -ADMIN.dailyJobStaleHours });
  return {
    days: dates.map((date, i) => ({
      date,
      events: perDay.get(date) ?? 0,
      extractions: extractions[i] ?? 0,
    })),
    lastDailyJobAt: last,
    dailyJobStale: last === null || last < staleBefore,
  };
}
