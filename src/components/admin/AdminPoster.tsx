/** Admin › event › Cartaz (SPEC §4.7): see it in any state, approve, reject, add, replace, remove. */
import { useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { AdminEventDetail } from '../../shared/schemas';
import { posterFormData, type PosterDraft } from '../forms/poster-api';
import { PosterField } from '../forms/PosterField';
import { adminApi } from './api';

interface Props {
  detail: AdminEventDetail;
  onChanged: (next: AdminEventDetail) => void;
}

export function AdminPoster({ detail: d, onChanged }: Props) {
  const [draft, setDraft] = useState<PosterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  // The server's reason (e.g. exif_not_allowed), next to the button that failed.
  const [error, setError] = useState('');
  // The moderation's route serves the poster in any state; the cookie goes along.
  const src = `/api/admin/events/${d.id}/poster`;

  async function call(init: { method: string; form?: FormData }) {
    setBusy(true);
    setError('');
    try {
      const r = await adminApi<AdminEventDetail & { error?: string }>(
        `/events/${d.id}/poster`,
        init,
      );
      if (!r.ok) {
        const code = r.data.error ?? 'generic';
        return setError(pt.poster.errors[code] ?? pt.poster.errors.generic);
      }
      setDraft(null);
      onChanged(r.data);
    } catch {
      setError(pt.admin.actionError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="admin-poster" aria-labelledby="admin-poster-heading">
      <h3 id="admin-poster-heading">{pt.admin.posterHeading}</h3>
      {d.posterStatus ? (
        <>
          <p>{pt.poster.status[d.posterStatus]}</p>
          <a href={src} target="_blank" rel="noopener">
            {/* Key in the URL: a replaced poster is not taken from the browser cache. */}
            <img
              class="admin-poster-img"
              src={`${src}?v=${encodeURIComponent(d.poster?.url ?? d.posterStatus)}`}
              alt={d.poster?.alt ?? pt.poster.previewAlt}
            />
          </a>
          {d.posterStatus === 'pending' && <p class="hint">{pt.admin.posterCheck}</p>}
        </>
      ) : (
        <p>{pt.poster.status.none}</p>
      )}
      <PosterField
        id="admin-poster"
        label={d.posterStatus ? pt.poster.replace : pt.admin.posterAdd}
        value={draft}
        onChange={(v) => {
          setDraft(v);
          setError('');
        }}
      />
      <div class="admin-actions">
        {draft && (
          <button
            type="button"
            class="btn-primary"
            disabled={busy}
            onClick={() => void call({ method: 'PUT', form: posterFormData(draft) })}
          >
            {busy ? pt.poster.uploading : pt.poster.upload}
          </button>
        )}
        {d.posterStatus && !draft && (
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onClick={() => void call({ method: 'DELETE' })}
          >
            {pt.admin.posterRemove}
          </button>
        )}
      </div>
      <p role="status" class={error ? 'field-error' : 'hint'}>
        {error}
      </p>
    </section>
  );
}
