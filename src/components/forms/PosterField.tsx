/**
 * Poster picker (SPEC §4.7): the image is resized in the browser (no metadata
 * leaves the device) and only sent after the event is saved.
 */
import { useEffect, useState } from 'preact/hooks';
import { LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import { TextArea } from './fields';
import { preparePoster } from './image';
import type { PosterDraft } from './poster-api';

interface Props {
  id: string;
  value: PosterDraft | null;
  onChange: (v: PosterDraft | null) => void;
  /** Label of the file input (defaults to "Cartaz (opcional)"). */
  label?: string;
  error?: string;
}

export function PosterField(p: Props) {
  const t = pt.poster;
  const [preparing, setPreparing] = useState(false);
  const [readError, setReadError] = useState('');
  const preview = p.value?.prepared.preview;

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setReadError('');
    if (!file.type.startsWith('image/')) {
      setReadError(t.errors.invalid_image);
      return;
    }
    setPreparing(true);
    try {
      p.onChange({ prepared: await preparePoster(file), alt: p.value?.alt ?? '' });
    } catch {
      setReadError(t.errors.read);
    } finally {
      setPreparing(false);
    }
  }

  const error = readError || p.error;
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  return (
    <div class="field poster-field">
      {p.value ? (
        <>
          <p class="poster-field-label">{p.label ?? t.label}</p>
          <figure class="poster-preview">
            <img src={p.value.prepared.preview} alt={t.previewAlt} />
          </figure>
          <p class="hint">{t.pendingNote}</p>
          <button type="button" class="btn" onClick={() => p.onChange(null)}>
            {t.remove}
          </button>
          <TextArea
            id={`${p.id}-alt`}
            label={t.alt}
            hint={t.altHint}
            value={p.value.alt}
            maxLength={LIMITS.posterAltMax}
            onValue={(alt) => p.value && p.onChange({ ...p.value, alt })}
          />
        </>
      ) : (
        <>
          <label for={p.id}>{p.label ?? t.label}</label>
          <input
            id={p.id}
            type="file"
            accept="image/*"
            class="poster-input"
            disabled={preparing}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={[hintId, error && errorId].filter(Boolean).join(' ')}
            onChange={(e) => {
              const input = e.currentTarget;
              void pick(input.files?.[0]).then(() => (input.value = ''));
            }}
          />
          <p class="hint" id={hintId}>
            {t.hint}
          </p>
        </>
      )}
      {preparing && (
        <p class="hint" role="status">
          {t.preparing}
        </p>
      )}
      {error && (
        <p class="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
