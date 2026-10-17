/**
 * Admin › Assinaturas: organisations to approve, search, deletion on request,
 * CSV export of those who accepted to be contacted (SPEC §6).
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { formatInstantShort } from '../../shared/dates';
import {
  ADMIN_SIGNATURE_FILTERS,
  type AdminSignature,
  type AdminSignatureFilter,
  type AdminSignatureList,
} from '../../shared/schemas';
import { adminApi } from './api';

function SignatureCard(props: {
  s: AdminSignature;
  onChange: (s: AdminSignature) => void;
  onDeleted: (s: AdminSignature) => void;
  onError: () => void;
}) {
  const { s } = props;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch {
      props.onError();
    } finally {
      setBusy(false);
    }
  }

  const moderate = (action: 'approve' | 'reject') =>
    run(async () => {
      const r = await adminApi<AdminSignature>(`/signatures/${s.id}/moderate`, {
        json: { action },
      });
      if (r.ok) props.onChange(r.data);
      else props.onError();
    });

  const remove = () =>
    run(async () => {
      const r = await adminApi(`/signatures/${s.id}`, { method: 'DELETE' });
      if (r.ok) props.onDeleted(s);
      else props.onError();
    });

  const org = s.kind === 'organization';
  return (
    <li class="admin-card" data-signature-id={s.id}>
      <h3>{s.name}</h3>
      <span class="admin-badges">
        <span class={`badge badge-sig-${s.status}`}>{pt.admin.signatureStatus[s.status]}</span>
        {org && s.orgType && <span class="badge">{pt.support.orgTypes[s.orgType]}</span>}
        <span class="badge">{s.isPublic ? pt.admin.isPublic : pt.admin.notPublic}</span>
        {s.canContact && <span class="badge">{pt.admin.canContact}</span>}
      </span>
      <dl class="admin-dl">
        {org && s.contactName && (
          <>
            <dt>{pt.admin.contactPerson}</dt>
            <dd>{s.contactName}</dd>
          </>
        )}
        <dt>{pt.admin.email}</dt>
        <dd>
          <a href={`mailto:${s.email}`}>{s.email}</a>
        </dd>
        {s.phone && (
          <>
            <dt>{pt.admin.phone}</dt>
            <dd>{s.phone}</dd>
          </>
        )}
        <dt>{pt.support.fields.municipality}</dt>
        <dd>{s.municipality}</dd>
        {s.activity && (
          <>
            <dt>{pt.admin.csv.activity}</dt>
            <dd>{s.activity}</dd>
          </>
        )}
        {s.website && (
          <>
            <dt>{pt.admin.csv.website}</dt>
            <dd>
              <a href={s.website} rel="noopener noreferrer nofollow" target="_blank">
                {s.website}
              </a>
            </dd>
          </>
        )}
        <dt>{pt.admin.createdAt}</dt>
        <dd>{formatInstantShort(s.createdAt)}</dd>
      </dl>
      <div class="admin-actions">
        {org && s.status !== 'unconfirmed' && s.status !== 'approved' && (
          <button
            type="button"
            class="btn-primary"
            disabled={busy}
            onClick={() => void moderate('approve')}
          >
            {pt.admin.approve}
          </button>
        )}
        {org && s.status !== 'unconfirmed' && s.status !== 'rejected' && (
          <button type="button" class="btn" disabled={busy} onClick={() => void moderate('reject')}>
            {pt.admin.reject}
          </button>
        )}
        {!confirming ? (
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {pt.admin.delete}
          </button>
        ) : (
          <div role="group" aria-label={pt.admin.deleteConfirm} class="admin-confirm">
            <p>{pt.admin.deleteConfirm}</p>
            <button
              type="button"
              class="btn btn-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {pt.admin.deleteYes}
            </button>
            <button type="button" class="btn" onClick={() => setConfirming(false)}>
              {pt.admin.deleteNo}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function AdminSignatures() {
  const [filter, setFilter] = useState<AdminSignatureFilter>('orgs_pending');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [list, setList] = useState<AdminSignatureList | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setError('');
    try {
      const q = new URLSearchParams({ filter, q: submitted });
      const r = await adminApi<AdminSignatureList>(`/signatures?${q.toString()}`);
      if (r.ok) setList(r.data);
      else if (r.status !== 401) setError(pt.admin.error);
    } catch {
      setError(pt.admin.error);
    }
  }

  useEffect(() => {
    setList(null);
    void load();
  }, [filter, submitted]);

  return (
    <section aria-labelledby="admin-sig-heading">
      <h2 id="admin-sig-heading" class="visually-hidden">
        {pt.admin.tabs.signatures}
      </h2>
      <p>
        <a class="btn" href="/api/admin/signatures/export.csv" download>
          {pt.admin.exportCsv}
        </a>
      </p>
      <div class="chips chips-wrap admin-filters">
        {ADMIN_SIGNATURE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            class="chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {pt.admin.signatureFilters[f]}
          </button>
        ))}
      </div>
      <form
        class="admin-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label for="admin-sig-q" class="visually-hidden">
          {pt.admin.searchSignatures}
        </label>
        <input
          id="admin-sig-q"
          type="search"
          placeholder={pt.admin.searchSignatures}
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
      {!list && !error && <p>{pt.admin.loading}</p>}
      {list?.items.length === 0 && <p>{pt.admin.empty}</p>}
      {list && list.items.length > 0 && (
        <>
          <p class="hint">{pt.admin.showing(list.items.length, list.total)}</p>
          <ul class="admin-list">
            {list.items.map((s) => (
              <SignatureCard
                key={s.id}
                s={s}
                onChange={(next) => {
                  setList(
                    (l) => l && { ...l, items: l.items.map((x) => (x.id === next.id ? next : x)) },
                  );
                  setStatus(`${next.name}: ${pt.admin.signatureStatus[next.status]}`);
                }}
                onDeleted={(gone) => {
                  setList(
                    (l) =>
                      l && { items: l.items.filter((x) => x.id !== gone.id), total: l.total - 1 },
                  );
                  setStatus(pt.admin.deleted);
                }}
                onError={() => setStatus(pt.admin.actionError)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
