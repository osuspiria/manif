/** Admin › one event: contact, reports, moderation actions and editing. */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { formatInstantShort } from '../../shared/dates';
import type {
  AdminEventDetail as Detail,
  AdminEventListItem,
  ApiIssue,
} from '../../shared/schemas';
import { EventEditForm, type SaveResult } from '../forms/EventEditForm';
import { adminApi } from './api';
import { EventActions, EventBadges } from './AdminEvents';

function toListItem(d: Detail): AdminEventListItem {
  return {
    id: d.id,
    type: d.type,
    title: d.title,
    status: d.status,
    verified: d.verified,
    municipality: d.municipality,
    district: d.district,
    createdAt: d.createdAt,
    reports: d.reports.length,
    nextStartsAt: null,
  };
}

export function AdminEventDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  // Remounts the edit form after a moderation action changes the event.
  const [version, setVersion] = useState(0);

  async function load() {
    setError('');
    try {
      const r = await adminApi<Detail>(`/events/${id}`);
      if (r.ok) setDetail(r.data);
      else if (r.status !== 401) setError(pt.admin.error);
    } catch {
      setError(pt.admin.error);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function save(body: unknown): Promise<SaveResult> {
    try {
      const r = await adminApi<Detail & { issues?: ApiIssue[] }>(`/events/${id}`, {
        method: 'PATCH',
        json: body,
      });
      if (!r.ok) return { ok: false, issues: r.data.issues };
      setDetail(r.data);
      return { ok: true, event: r.data };
    } catch {
      return { ok: false, network: true };
    }
  }

  const back = (
    <p>
      <a href="#eventos">← {pt.admin.back}</a>
    </p>
  );
  if (error) {
    return (
      <>
        {back}
        <p role="alert">{error}</p>
      </>
    );
  }
  if (!detail) return <p>{pt.admin.loading}</p>;

  const d = detail;
  return (
    <article class="admin-detail">
      {back}
      <h2>{d.title}</h2>
      <EventBadges e={toListItem(d)} />
      <p class="admin-meta">
        {[d.placeLabel, d.municipality, d.district].filter(Boolean).join(' · ')}
      </p>
      <dl class="admin-dl">
        <dt>{pt.admin.contactEmail}</dt>
        <dd>
          {d.contactEmail ? (
            <a href={`mailto:${d.contactEmail}`}>{d.contactEmail}</a>
          ) : (
            pt.admin.noContact
          )}
        </dd>
        <dt>{pt.admin.createdAt}</dt>
        <dd>{formatInstantShort(d.createdAt)}</dd>
      </dl>

      <EventActions
        event={toListItem(d)}
        onDone={() => {
          setStatus(pt.edit.saved);
          void load().then(() => setVersion((v) => v + 1));
        }}
        onError={() => setStatus(pt.admin.actionError)}
      />
      {d.reports.length > 0 && <p class="hint">{pt.admin.publishDismisses}</p>}
      <p class="form-ok" role="status">
        {status}
      </p>

      <h3>{pt.admin.reportsHeading}</h3>
      {d.reports.length ? (
        <ul class="admin-reports">
          {d.reports.map((r, i) => (
            <li key={i}>
              <strong>{pt.report.reasons[r.reason]}</strong> · {formatInstantShort(r.createdAt)}
              {r.detail && <p>{r.detail}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p>{pt.admin.noReports}</p>
      )}

      <h3>{pt.admin.editHeading}</h3>
      <EventEditForm
        key={version}
        event={d}
        onSave={save}
        verifiedNote={pt.admin.moderatorEditNote}
        headingLevel={4}
      />
    </article>
  );
}
