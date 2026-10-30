/**
 * Admin › Eventos, above the queues (docs/decisions.md #82): a warning when the
 * daily job has stopped, and events created / imports with Claude per day.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { formatInstantShort } from '../../shared/dates';
import { formatShortDayLabel } from '../../shared/event-view';
import type { AdminActivity as Activity } from '../../shared/schemas';
import { adminApi } from './api';

export function AdminActivity() {
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    // A convenience: on failure the section is just not shown.
    adminApi<Activity>('/activity')
      .then((r) => r.ok && setActivity(r.data))
      .catch(() => undefined);
  }, []);

  if (!activity) return null;
  return (
    <section class="admin-activity" aria-labelledby="admin-activity-heading">
      {activity.dailyJobStale && (
        <p class="form-error" role="alert">
          {activity.lastDailyJobAt
            ? pt.admin.activity.staleSince(formatInstantShort(activity.lastDailyJobAt))
            : pt.admin.activity.staleNever}
        </p>
      )}
      <details>
        <summary>
          <h2 id="admin-activity-heading">{pt.admin.activity.heading}</h2>
        </summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{pt.admin.activity.day}</th>
              <th scope="col">{pt.admin.activity.events}</th>
              <th scope="col">{pt.admin.activity.extractions}</th>
            </tr>
          </thead>
          <tbody>
            {activity.days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatShortDayLabel(d.date)}</th>
                <td>{d.events}</td>
                <td>{d.extractions}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="hint">
          {activity.lastDailyJobAt
            ? pt.admin.activity.lastJob(formatInstantShort(activity.lastDailyJobAt))
            : pt.admin.activity.staleNever}
        </p>
      </details>
    </section>
  );
}
