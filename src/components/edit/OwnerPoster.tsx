/** "Cartaz" on the edit page (SPEC §4.7): send, replace or remove the poster with the edit link. */
import { useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { EditableEvent } from '../../shared/schemas';
import { removeOwnerPoster, uploadOwnerPoster, type PosterDraft } from '../forms/poster-api';
import { PosterField } from '../forms/PosterField';

interface Props {
  event: EditableEvent;
  token: string;
  /** Reload the event after a change. */
  onChanged: () => void;
}

export function OwnerPoster(p: Props) {
  const t = pt.poster;
  const [draft, setDraft] = useState<PosterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const status = p.event.posterStatus;

  async function send() {
    if (!draft) return;
    setBusy(true);
    const error = await uploadOwnerPoster(p.event.id, p.token, draft);
    setBusy(false);
    if (error) return setMessage({ ok: false, text: t.errors[error] ?? t.errors.generic });
    setDraft(null);
    setMessage({ ok: true, text: t.uploaded });
    p.onChanged();
  }

  async function remove() {
    setBusy(true);
    const ok = await removeOwnerPoster(p.event.id, p.token);
    setBusy(false);
    setMessage(ok ? { ok: true, text: t.removed } : { ok: false, text: t.errors.generic });
    if (ok) p.onChanged();
  }

  return (
    <section class="owner-poster" aria-labelledby="poster-heading">
      <h2 id="poster-heading">{t.heading}</h2>
      <p>{t.status[status ?? 'none']}</p>
      {p.event.poster && (
        <figure class="poster-preview">
          <img src={p.event.poster.thumbUrl} alt={p.event.poster.alt ?? p.event.title} />
        </figure>
      )}
      <PosterField
        id="poster"
        label={status ? t.replace : t.label}
        value={draft}
        onChange={(v) => {
          setDraft(v);
          setMessage(null);
        }}
      />
      <div class="add-actions">
        {draft && (
          <button type="button" class="btn-primary" disabled={busy} onClick={() => void send()}>
            {busy ? t.uploading : t.upload}
          </button>
        )}
        {status && !draft && (
          <button type="button" class="btn" disabled={busy} onClick={() => void remove()}>
            {t.remove}
          </button>
        )}
      </div>
      <p role="status" class={message && !message.ok ? 'field-error' : 'hint'}>
        {message?.text ?? ''}
      </p>
    </section>
  );
}
