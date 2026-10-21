/**
 * Retention job (SPEC §7), run daily by the Cron Trigger:
 * - unconfirmed signatures after 7 days;
 * - 30 days after an event's last occurrence: unpublished events are deleted;
 *   published ones stay ("Já aconteceram") without contact email, edit link
 *   or reports;
 * - all signatures N months after CAMPAIGN_END (when it is set);
 * - expired admin login links and sessions.
 */
import { CAMPAIGN_END, RETENTION } from '../../config/app';
import { addCivilDaysIso, addMonths, lisbonToday, nowIso } from '../../shared/dates';
import type { RetentionRepo } from '../repos/admin-repo';

export interface RetentionResult {
  unconfirmedSignatures: number;
  events: number;
  anonymizedEvents: number;
  campaignSignatures: number;
}

export async function runRetention(
  repo: RetentionRepo,
  now: Date,
  campaignEnd: string | null = CAMPAIGN_END,
): Promise<RetentionResult> {
  const unconfirmedSignatures = await repo.deleteUnconfirmedSignaturesBefore(
    addCivilDaysIso(now, -RETENTION.unconfirmedSignatureDays),
  );
  const eventDeadline = addCivilDaysIso(now, -RETENTION.eventDaysAfterLastOccurrence);
  const events = await repo.deleteEventsEndedBefore(eventDeadline);
  const anonymizedEvents = await repo.anonymizeEventsEndedBefore(eventDeadline);
  let campaignSignatures = 0;
  if (
    campaignEnd &&
    lisbonToday(now) > addMonths(campaignEnd, RETENTION.signatureMonthsAfterCampaign)
  ) {
    campaignSignatures = await repo.deleteAllSignatures();
  }
  await repo.deleteExpiredAdminAuth(nowIso(now));
  return { unconfirmedSignatures, events, anonymizedEvents, campaignSignatures };
}
