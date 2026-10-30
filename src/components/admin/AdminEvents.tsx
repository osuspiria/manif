/**
 * Admin › Eventos: queues with their counts (por confirmar, pendentes, reportados,
 * ocultos, cartazes, todos), search, quick actions.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { formatInstantShort } from '../../shared/dates';
import {
  ADMIN_EVENT_FILTERS,
  type AdminEventAction,
  type AdminEventCounts,
  type AdminEventFilter,
  type AdminEventListItem,
} from '../../shared/schemas';
import { adminApi } from './api';

/** Approve / hide / "Confirmado" / "Sem fim" / poster buttons, shared by the list and the detail view. */
export function EventActions(props: {
  event: Pick<
    AdminEventListItem,
    'id' | 'status' | 'verified' | 'ongoing' | 'reports' | 'posterStatus'
  >;
  onDone: (item: AdminEventListItem) => void;
  onError: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const e = props.event;

  async function act(action: AdminEventAction) {
    setBusy(true);
    try {
      const r = await adminApi<AdminEventListItem>(`/events/${e.id}/moderate`, {
        json: { action },
      });
      if (r.ok) props.onDone(r.data);
      else props.onError();
    } catch {
      props.onError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="admin-actions">
      {(e.status !== 'published' || e.reports > 0) && (
        <button
          type="button"
          class="btn-primary"
          disabled={busy}
          onClick={() => void act('publish')}
        >
          {pt.admin.publish}
        </button>
      )}
      {e.status !== 'hidden' && (
        <button
          type="button"
          class="btn btn-danger"
          disabled={busy}
          onClick={() => void act('hide')}
        >
          {pt.admin.hide}
        </button>
      )}
      <button
        type="button"
        class="btn"
        disabled={busy}
        onClick={() => void act(e.verified ? 'unverify' : 'verify')}
      >
        {e.verified ? pt.admin.unverify : pt.admin.verify}
      </button>
      <button
        type="button"
        class="btn"
        disabled={busy}
        aria-pressed={e.ongoing}
        title={pt.admin.ongoingNote}
        onClick={() => void act(e.ongoing ? 'not_ongoing' : 'ongoing')}
      >
        {e.ongoing ? pt.admin.unmarkOngoing : pt.admin.markOngoing}
      </button>
      {e.posterStatus === 'pending' && (
        <>
          <button
            type="button"
            class="btn-primary"
            disabled={busy}
            onClick={() => void act('poster_approve')}
          >
            {pt.admin.posterApprove}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            title={pt.admin.posterRejectNote}
            onClick={() => void act('poster_reject')}
          >
            {pt.admin.posterReject}
          </button>
        </>
      )}
    </div>
  );
}

export function EventBadges({ e }: { e: AdminEventListItem }) {
  return (
    <span class="admin-badges">
      <span class={`badge badge-status-${e.status}`}>{pt.admin.eventStatus[e.status]}</span>
      <span class={e.verified ? 'badge badge-ok' : 'badge'}>
        {e.verified ? pt.event.verified : pt.event.unverified}
      </span>
      {e.ongoing && <span class="badge badge-ok">{pt.admin.ongoing}</span>}
      {e.reports > 0 && <span class="badge badge-warn">{pt.admin.reports(e.reports)}</span>}
      {e.posterStatus === 'pending' && (
        <span class="badge badge-warn">{pt.admin.posterPending}</span>
      )}
    </span>
  );
}

export function AdminEvents() {
  const [filter, setFilter] = useState<AdminEventFilter>('unverified');
  const [counts, setCounts] = useState<AdminEventCounts | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [items, setItems] = useState<AdminEventListItem[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  /** Counts are a convenience: on failure the filters just show none. */
  async function loadCounts() {
    const r = await adminApi<AdminEventCounts>('/events/counts').catch(() => null);
    if (r?.ok) setCounts(r.data);
  }

  async function load() {
    void loadCounts();
    setError('');
    try {
      const q = new URLSearchParams({ filter, q: submitted });
      const r = await adminApi<{ items: AdminEventListItem[] }>(`/events?${q.toString()}`);
      if (r.ok) setItems(r.data.items);
      else if (r.status !== 401) setError(pt.admin.error);
    } catch {
      setError(pt.admin.error);
    }
  }

  useEffect(() => {
    setItems(null);
    void load();
  }, [filter, submitted]);

  const replace = (item: AdminEventListItem) => {
    setItems((list) => list?.map((x) => (x.id === item.id ? item : x)) ?? null);
    void loadCounts();
    setStatus(`${item.title}: ${pt.admin.eventStatus[item.status]}`);
  };

  return (
    <section aria-labelledby="admin-events-heading">
      <h2 id="admin-events-heading" class="visually-hidden">
        {pt.admin.tabs.events}
      </h2>
      <p>
        <a class="btn-primary" href="#eventos/novo">
          {pt.admin.newEvent.open}
        </a>
      </p>
      <div class="chips chips-wrap admin-filters">
        {ADMIN_EVENT_FILTERS.map((f) => {
          const count = f === 'all' ? null : (counts?.[f] ?? null);
          // "Pendentes" only fills up under MODERATION_MODE = pre.
          if (f === 'pending' && count === 0 && filter !== f) return null;
          return (
            <button
              key={f}
              type="button"
              class="chip"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {pt.admin.eventFilters[f]}
              {count !== null && <span class="chip-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <form
        class="admin-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label for="admin-events-q" class="visually-hidden">
          {pt.admin.searchEvents}
        </label>
        <input
          id="admin-events-q"
          type="search"
          placeholder={pt.admin.searchEvents}
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <button type="submit" class="btn">
          {pt.admin.search}
        </button>
      </form>

      <p class="form-ok" role="status">
        {status}
      </p>
      {error && (
        <p class="form-error" role="alert">
          {error}{' '}
          <button type="button" class="btn-link" onClick={() => void load()}>
            {pt.admin.retry}
          </button>
        </p>
      )}
      {!items && !error && <p>{pt.admin.loading}</p>}
      {items?.length === 0 && <p>{pt.admin.empty}</p>}
      {items && items.length > 0 && (
        <ul class="admin-list">
          {items.map((e) => (
            <li key={e.id} class="admin-card" data-event-id={e.id}>
              <h3>
                <a href={`#eventos/${e.id}`}>{e.title}</a>
              </h3>
              <EventBadges e={e} />
              <p class="admin-meta">
                {pt.eventTypes[e.type]} · {e.municipality} ·{' '}
                {e.nextStartsAt
                  ? `${pt.admin.nextDate}: ${formatInstantShort(e.nextStartsAt)}`
                  : e.ongoing
                    ? pt.admin.ongoing
                    : pt.admin.noUpcoming}
              </p>
              <EventActions
                event={e}
                onDone={replace}
                onError={() => setStatus(pt.admin.actionError)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
