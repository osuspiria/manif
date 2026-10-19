/**
 * Admin › Novo evento (SPEC §6): an empty event form, optionally filled in by
 * importing a post's text or a poster (read by Claude on the server). The
 * moderator reviews everything; publishing makes it published and "Confirmado".
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import { currentTime } from '../../map/clock';
import { addMonths, lisbonToday, todayIn } from '../../shared/dates';
import { checkOccurrences } from '../../shared/occurrence-rules';
import {
  EventInputSchema,
  type AdminEventDetail,
  type AdminExtractRequest,
  type AdminExtractResponse,
  type ApiIssue,
  type EventDraft,
  type PlaceResult,
  type ReverseResult,
} from '../../shared/schemas';
import { EventDetailsFields } from '../forms/EventDetailsFields';
import {
  detailsToInput,
  emptyDetails,
  emptyRow,
  focusFirstError,
  issuesToErrors,
  newRowKey,
  rowToOccurrence,
  type DetailsState,
  type FieldErrors,
  type RowState,
} from '../forms/form-state';
import { OccurrencesEditor } from '../forms/OccurrencesEditor';
import { PlaceSearchBox } from '../forms/PlaceSearchBox';
import { adminApi } from './api';

/** Longest side sent to the API: larger images cost more and read no better. */
const IMAGE_MAX_SIDE = 1568;

type Image = NonNullable<AdminExtractRequest['image']> & { preview: string };
type Place = { result: PlaceResult; reverse: ReverseResult | null; outside: boolean };

/** Shrinks the image in the browser and returns it as base64 JPEG. */
async function loadImage(file: Blob): Promise<Image> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), preview: url };
}

function draftToForm(d: EventDraft): { details: DetailsState; rows: RowState[] } {
  return {
    details: {
      type: d.type,
      title: d.title,
      description: d.description ?? '',
      organizer: d.organizer ?? '',
      placeLabel: d.placeQuery?.split(',')[0]?.trim().slice(0, LIMITS.titleMax) ?? '',
    },
    rows: d.occurrences.length
      ? d.occurrences.map((o) => ({
          key: newRowKey(),
          localDate: o.localDate,
          allDay: o.startTime === null,
          startTime: o.startTime ?? '',
          endTime: o.endTime ?? '',
          note: o.note ?? '',
          cancelled: false,
        }))
      : [emptyRow()],
  };
}

export function AdminNewEvent() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<Image | null>(null);
  const [reading, setReading] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<PlaceResult[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [details, setDetails] = useState<DetailsState>(emptyDetails);
  const [rows, setRows] = useState<RowState[]>(() => [emptyRow()]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const now = currentTime();
  const tz = place?.reverse?.tz ?? null;
  const today = tz ? todayIn(tz, now) : lisbonToday(now);
  const maxDate = addMonths(today, LIMITS.occurrenceMaxMonthsAhead);
  const t = pt.admin.newEvent;

  // Municipality, district and tz of the chosen place.
  useEffect(() => {
    if (!place || place.reverse || place.outside) return;
    const { lat, lng } = place.result;
    const ctrl = new AbortController();
    fetch(`/api/geo/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const reverse = r.ok ? ((await r.json()) as ReverseResult) : null;
        setPlace((p) => (p?.result === place.result ? { ...p, reverse, outside: !r.ok } : p));
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [place?.result]);

  function pick(result: PlaceResult) {
    setPlace({ result, reverse: null, outside: false });
    setErrors((errs) => {
      const rest = { ...errs };
      delete rest.lat;
      return rest;
    });
  }

  async function addImage(file: Blob | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      setImage(await loadImage(file));
      setImportMsg(null);
    } catch {
      setImportMsg({ ok: false, text: t.errors.image ?? '' });
    }
  }

  function onPaste(e: ClipboardEvent) {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    void addImage(file);
  }

  async function read(e: Event) {
    e.preventDefault();
    if (!text.trim() && !image) {
      setImportMsg({ ok: false, text: t.errors.required ?? '' });
      return;
    }
    setReading(true);
    setImportMsg(null);
    try {
      const body: AdminExtractRequest = {
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(image ? { image: { mediaType: image.mediaType, data: image.data } } : {}),
      };
      const r = await adminApi<AdminExtractResponse & { error?: string }>('/events/extract', {
        json: body,
      });
      if (!r.ok) {
        const msg = t.errors[r.data.error ?? ''] ?? t.errors.extract_failed ?? '';
        setImportMsg({ ok: false, text: msg });
        return;
      }
      const form = draftToForm(r.data.draft);
      setDetails(form.details);
      setRows(form.rows);
      setWarnings(r.data.draft.warnings);
      setCandidates(r.data.places);
      setPlace(
        r.data.places[0] ? { result: r.data.places[0], reverse: null, outside: false } : null,
      );
      setErrors({});
      setFormError('');
      setImportMsg({ ok: true, text: t.readDone });
    } catch {
      setImportMsg({ ok: false, text: pt.support.errors.network });
    } finally {
      setReading(false);
    }
  }

  function input() {
    return {
      ...detailsToInput(details),
      lat: place?.result.lat ?? 0,
      lng: place?.result.lng ?? 0,
      contactEmail: null,
      occurrences: rows.map(rowToOccurrence),
    };
  }

  function showIssues(issues: ApiIssue[]) {
    setErrors(issuesToErrors(issues));
    setFormError(pt.add.errors.fix);
    requestAnimationFrame(() => focusFirstError(formRef.current));
  }

  async function publish(e: Event) {
    e.preventDefault();
    const issues: ApiIssue[] = [];
    const parsed = EventInputSchema.safeParse(input());
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({
          path: i.path.filter((x) => typeof x !== 'symbol') as (string | number)[],
          code: i.message,
        });
      }
    }
    if (!place?.reverse) issues.push({ path: ['lat'], code: 'outside_portugal' });
    if (tz) issues.push(...checkOccurrences(rows.map(rowToOccurrence), tz, now));
    if (issues.length || !parsed.success) return showIssues(issues);

    setSaving(true);
    setFormError('');
    try {
      const r = await adminApi<AdminEventDetail & { issues?: ApiIssue[] }>('/events', {
        json: parsed.data,
      });
      if (r.ok) {
        window.location.hash = `#eventos/${r.data.id}`;
      } else if (r.data.issues?.length) {
        showIssues(r.data.issues);
      } else {
        setFormError(t.errors.publish ?? '');
      }
    } catch {
      setFormError(pt.support.errors.network);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article class="admin-detail admin-new">
      <p>
        <a href="#eventos">{pt.admin.back}</a>
      </p>
      <h2>{t.heading}</h2>

      <form class="admin-import" onSubmit={(e) => void read(e)}>
        <h3>{t.importHeading}</h3>
        <p class="hint">{t.importHint}</p>
        <div class="field">
          <label for="import-text">{t.text}</label>
          <textarea
            id="import-text"
            rows={6}
            maxLength={LIMITS.extractTextMax}
            value={text}
            aria-describedby="import-text-hint"
            onInput={(e) => setText(e.currentTarget.value)}
            onPaste={onPaste}
          />
          <p class="hint" id="import-text-hint">
            {t.textHint}
          </p>
        </div>
        <div class="field">
          <label for="import-image">{t.image}</label>
          <input
            id="import-image"
            type="file"
            accept="image/*"
            onChange={(e) => {
              void addImage(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {image && (
          <div class="admin-import-image">
            <img src={image.preview} alt={t.imageAlt} />
            <button type="button" class="btn" onClick={() => setImage(null)}>
              {t.removeImage}
            </button>
          </div>
        )}
        <p class="hint">{t.privacyNote}</p>
        <button type="submit" class="btn-primary" disabled={reading}>
          {reading ? t.reading : t.read}
        </button>
        <p class={importMsg?.ok ? 'form-ok' : 'form-error'} role="status">
          {importMsg?.text ?? ''}
        </p>
      </form>

      {warnings.length > 0 && (
        <section class="admin-warnings" aria-labelledby="import-warnings">
          <h3 id="import-warnings">{t.warningsHeading}</h3>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <form ref={formRef} class="admin-new-form" onSubmit={(e) => void publish(e)} noValidate>
        <h3>{t.placeHeading}</h3>
        <p
          class="detected"
          role="status"
          aria-invalid={errors.lat ? 'true' : undefined}
          tabIndex={errors.lat ? -1 : undefined}
        >
          {place?.outside ? (
            <span class="field-error">{pt.add.where.outside}</span>
          ) : place ? (
            <>
              {t.placeChosen}: <strong>{place.result.label}</strong>
              {place.reverse && ` · ${place.reverse.municipality} · ${place.reverse.district}`}
            </>
          ) : (
            <span class={errors.lat ? 'field-error' : undefined}>{t.placeNone}</span>
          )}
        </p>
        {candidates.length > 1 && (
          <fieldset class="admin-places">
            <legend>{t.placeResults}</legend>
            {candidates.map((c, i) => (
              <label key={`${c.lat},${c.lng},${i}`} class="choice">
                <input
                  type="radio"
                  name="import-place"
                  checked={place?.result === c}
                  onChange={() => pick(c)}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
        )}
        <details class="add-search">
          <summary>{pt.search.open}</summary>
          <PlaceSearchBox id="new-search" onPick={pick} />
        </details>

        <h3>{t.detailsHeading}</h3>
        <EventDetailsFields value={details} onChange={setDetails} errors={errors} withPlaceLabel />

        <h3>{t.datesHeading}</h3>
        <OccurrencesEditor
          rows={rows}
          onChange={setRows}
          errors={errors}
          tz={tz}
          minDate={today}
          maxDate={maxDate}
          mode="create"
        />

        <p class="hint">{t.publishNote}</p>
        <p class="form-error" role="alert">
          {formError}
        </p>
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? t.publishing : t.publish}
        </button>
      </form>
    </article>
  );
}
