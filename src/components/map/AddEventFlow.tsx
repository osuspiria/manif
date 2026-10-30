/**
 * "Adicionar evento" (SPEC §4.4): short steps in a bottom sheet (mobile) or the
 * side panel (desktop). Loaded lazily, so Zod and the form code never weigh on
 * the first load of /mapa.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FEATURES, LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import { addMonths, lisbonToday, todayIn } from '../../shared/dates';
import { findPossibleDuplicates, type PossibleDuplicate } from '../../shared/duplicates';
import { formatShortDayLabel } from '../../shared/event-view';
import { checkOccurrences } from '../../shared/occurrence-rules';
import {
  EventInputSchema,
  type ApiIssue,
  type CreateEventResponse,
  type PlaceResult,
  type PublicEvent,
  type ReverseResult,
} from '../../shared/schemas';
import { EventDetailsFields } from '../forms/EventDetailsFields';
import { TextField } from '../forms/fields';
import {
  detailsToInput,
  emptyDetails,
  emptyRow,
  focusFirstError,
  issuesToErrors,
  rowToOccurrence,
  type DetailsState,
  type FieldErrors,
  type RowState,
} from '../forms/form-state';
import { OccurrencesEditor } from '../forms/OccurrencesEditor';
import { PlaceSearchBox } from '../forms/PlaceSearchBox';
import { uploadOwnerPoster, type PosterDraft } from '../forms/poster-api';
import { PosterField } from '../forms/PosterField';
import { getTurnstileToken } from '../forms/turnstile';
import '../../styles/forms.css';

const ALL_STEPS = ['where', 'what', 'when', 'contact'] as const;
type Step = (typeof ALL_STEPS)[number];
/** "Contacto" only holds the optional email: no step at all while that is switched off. */
const STEPS: readonly Step[] = FEATURES.eventContactEmail
  ? ALL_STEPS
  : ALL_STEPS.filter((s) => s !== 'contact');
const LAST_STEP: Step = STEPS[STEPS.length - 1] ?? 'when';

/** Which top-level fields each step owns (to route server errors back). */
const STEP_FIELDS: Record<Step, string[]> = {
  where: ['lat', 'lng', 'placeLabel'],
  what: ['type', 'title', 'description', 'organizer'],
  when: ['occurrences'],
  contact: ['contactEmail'],
};

function stepOf(issue: ApiIssue): Step {
  const head = String(issue.path[0] ?? '');
  return STEPS.find((s) => STEP_FIELDS[s].includes(head)) ?? LAST_STEP;
}

export interface AddEventFlowProps {
  center: [number, number] | null;
  /** Map zoom: the point is only taken once zoomed in to street level. */
  zoom: number | null;
  now: Date;
  /** Events already on the map: checked for possible duplicates before sending. */
  events: readonly PublicEvent[];
  onPickingChange: (picking: boolean) => void;
  onFly: (lng: number, lat: number, zoom: number) => void;
  onUseLocation: () => void;
  /** The first detected point is outside Portugal: recentre over land. */
  onStartOutside: () => void;
  onClose: () => void;
  onCreated: (r: CreateEventResponse) => void;
  onView: (id: string) => void;
}

type Place = { state: 'idle' | 'loading' | 'outside' } | { state: 'ok'; place: ReverseResult };
/** Poster upload after the event was created: null = none chosen. */
type PosterUpload = null | { state: 'sending' | 'sent' } | { state: 'failed'; error: string };

/** The edit token from `/editar/#e=<id>&t=<token>`. */
function tokenOf(editUrl: string): string {
  return new URLSearchParams(new URL(editUrl).hash.slice(1)).get('t') ?? '';
}

export function AddEventFlow(p: AddEventFlowProps) {
  const [step, setStep] = useState<Step>('where');
  const [details, setDetails] = useState<DetailsState>(emptyDetails);
  const [rows, setRows] = useState<RowState[]>(() => [emptyRow()]);
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [place, setPlace] = useState<Place>({ state: 'idle' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<(CreateEventResponse & { emailed: boolean }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [poster, setPoster] = useState<PosterDraft | null>(null);
  const [posterUpload, setPosterUpload] = useState<PosterUpload>(null);
  /** Shown once before sending; null = not checked yet (or the details changed since). */
  const [duplicates, setDuplicates] = useState<PossibleDuplicate<PublicEvent>[] | null>(null);
  const root = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const duplicatesRef = useRef<HTMLDivElement>(null);
  const firstCheck = useRef(true);

  const stepIndex = STEPS.indexOf(step);
  // At country or region zoom the centre is only a rough guess of the place.
  const zoomedOut = p.zoom !== null && p.zoom < LIMITS.pickMinZoom;
  const tz = place.state === 'ok' ? place.place.tz : null;

  useEffect(() => {
    p.onPickingChange(step === 'where' && !done);
  }, [step, done]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step, done]);

  // Another place or other dates: check for duplicates again before sending.
  useEffect(() => setDuplicates(null), [p.center?.[0], p.center?.[1], rows]);

  useEffect(() => {
    if (duplicates?.length) duplicatesRef.current?.scrollIntoView({ block: 'nearest' });
  }, [duplicates]);

  // Detect the municipality of the map centre (debounced).
  useEffect(() => {
    if (step !== 'where' || !p.center) return;
    const [lng, lat] = p.center;
    setPlace({ state: 'loading' });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/geo/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { signal: ctrl.signal })
        .then(async (r) => {
          const first = firstCheck.current;
          firstCheck.current = false;
          if (r.ok) return setPlace({ state: 'ok', place: (await r.json()) as ReverseResult });
          setPlace({ state: 'outside' });
          if (first) p.onStartOutside();
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [p.center?.[0], p.center?.[1], step]);

  const buildInput = () => ({
    ...detailsToInput(details),
    lat: p.center?.[1] ?? 0,
    lng: p.center?.[0] ?? 0,
    contactEmail: FEATURES.eventContactEmail ? email : null,
    occurrences: rows.map(rowToOccurrence),
  });

  function validate(steps: readonly Step[]): ApiIssue[] {
    const issues: ApiIssue[] = [];
    const parsed = EventInputSchema.safeParse(buildInput());
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({
          path: i.path.filter((x) => typeof x !== 'symbol') as (string | number)[],
          code: i.message,
        });
      }
    }
    if (tz) issues.push(...checkOccurrences(rows.map(rowToOccurrence), tz, p.now));
    if (place.state !== 'ok') issues.push({ path: ['lat'], code: 'outside_portugal' });
    else if (zoomedOut) issues.push({ path: ['lat'], code: 'zoom_in' });
    return issues.filter((i) => steps.includes(stepOf(i)));
  }

  function showErrors(issues: ApiIssue[]) {
    setErrors(issuesToErrors(issues));
    setFormError(issues.length ? pt.add.errors.fix : '');
    requestAnimationFrame(() => focusFirstError(root.current));
  }

  function next() {
    const issues = validate([step]);
    if (issues.length) return showErrors(issues);
    setErrors({});
    setFormError('');
    setStep(STEPS[stepIndex + 1] ?? step);
  }

  function back() {
    setErrors({});
    setFormError('');
    setStep(STEPS[stepIndex - 1] ?? step);
  }

  async function sendPoster(created: CreateEventResponse, draft: PosterDraft) {
    setPosterUpload({ state: 'sending' });
    const error = await uploadOwnerPoster(created.id, tokenOf(created.editUrl), draft);
    setPosterUpload(error ? { state: 'failed', error } : { state: 'sent' });
  }

  async function submit() {
    const issues = validate(STEPS);
    const first = issues[0];
    if (first) {
      setStep(stepOf(first));
      return showErrors(issues);
    }
    if (!duplicates) {
      const found = findPossibleDuplicates(
        {
          lat: p.center?.[1] ?? 0,
          lng: p.center?.[0] ?? 0,
          dates: rows.map((r) => r.localDate).filter(Boolean),
        },
        p.events,
      );
      setDuplicates(found);
      if (found.length) return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const turnstileToken = captchaRef.current ? await getTurnstileToken(captchaRef.current) : '';
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildInput(), turnstileToken, website: honeypot }),
      });
      const body = (await res.json()) as CreateEventResponse & {
        error?: string;
        issues?: ApiIssue[];
      };
      if (res.ok) {
        // The event exists now: the poster follows with its edit token (SPEC §4.7).
        if (poster) await sendPoster(body, poster);
        setDone({ ...body, emailed: FEATURES.eventContactEmail && email.trim() !== '' });
        p.onCreated(body);
      } else if (body.issues?.[0]) {
        setStep(stepOf(body.issues[0]));
        showErrors(body.issues);
      } else {
        const key = (body.error ?? 'generic') as keyof typeof pt.add.errors;
        setFormError(pt.add.errors[key] ?? pt.add.errors.generic);
      }
    } catch (e) {
      setFormError(
        e instanceof Error && e.message.startsWith('turnstile')
          ? pt.add.errors.captcha_failed
          : pt.add.errors.network,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const today = tz ? todayIn(tz, p.now) : lisbonToday(p.now);
  const maxDate = addMonths(today, LIMITS.occurrenceMaxMonthsAhead);

  if (done) {
    const published = done.status === 'published';
    return (
      <section class="add-flow" ref={root} aria-labelledby="add-heading">
        <div class="add-head">
          <h2 id="add-heading" tabIndex={-1} ref={headingRef}>
            {published ? pt.add.done.published : pt.add.done.pending}
          </h2>
          <button type="button" class="btn-icon" aria-label={pt.add.done.close} onClick={p.onClose}>
            ×
          </button>
        </div>
        <p>{published ? pt.add.done.publishedText : pt.add.done.pendingText}</p>
        {posterUpload && (
          <div class="poster-upload-status" role="status">
            {posterUpload.state === 'sending' && <p class="hint">{pt.poster.uploading}</p>}
            {posterUpload.state === 'sent' && <p>{pt.poster.doneNote}</p>}
            {posterUpload.state === 'failed' && (
              <>
                <p class="field-error">
                  {pt.poster.errors[posterUpload.error] ?? pt.poster.errors.generic}
                </p>
                {poster && (
                  <button type="button" class="btn" onClick={() => void sendPoster(done, poster)}>
                    {pt.poster.retry}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <div class="edit-link-box">
          <h3>{pt.add.done.linkHeading}</h3>
          <p>{pt.add.done.linkText}</p>
          <label for="edit-link">{pt.add.done.linkLabel}</label>
          <input
            id="edit-link"
            type="text"
            readOnly
            value={done.editUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            class="btn-primary"
            onClick={() => {
              void navigator.clipboard?.writeText(done.editUrl).then(() => setCopied(true));
            }}
          >
            {pt.add.done.copy}
          </button>
          <p role="status" class="hint">
            {copied ? pt.add.done.copied : ''}
          </p>
          {done.emailed && <p class="hint">{pt.add.done.emailed}</p>}
        </div>
        <div class="add-actions">
          {published && (
            <button type="button" class="btn" onClick={() => p.onView(done.id)}>
              {pt.add.done.view}
            </button>
          )}
          <button type="button" class="btn" onClick={p.onClose}>
            {pt.add.done.close}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class={`add-flow add-step-${step}`} ref={root} aria-labelledby="add-heading">
      <div class="add-head">
        <div>
          <p class="add-progress">
            {pt.add.heading} · {pt.add.stepOf(stepIndex + 1, STEPS.length)}
          </p>
          <h2 id="add-heading" tabIndex={-1} ref={headingRef}>
            {pt.add.steps[step]}
          </h2>
        </div>
        <button type="button" class="btn-icon" aria-label={pt.add.cancel} onClick={p.onClose}>
          ×
        </button>
      </div>

      {step === 'where' && (
        <div class="add-body">
          <p class="hint">{pt.add.where.hint}</p>
          <p
            class="detected"
            role="status"
            aria-invalid={errors.lat ? 'true' : undefined}
            tabIndex={errors.lat ? -1 : undefined}
          >
            {place.state === 'loading' && pt.add.where.detecting}
            {place.state === 'outside' && <span class="field-error">{pt.add.where.outside}</span>}
            {place.state === 'ok' && (
              <strong>
                {place.place.municipality} · {place.place.district}
              </strong>
            )}
            {place.state === 'ok' && zoomedOut && (
              <span class={errors.lat ? 'field-error detected-zoom' : 'hint detected-zoom'}>
                {pt.add.where.zoomIn}
              </span>
            )}
          </p>
          <button type="button" class="btn" onClick={p.onUseLocation}>
            {pt.add.where.useLocation}
          </button>
          <details class="add-search">
            <summary>{pt.search.open}</summary>
            <PlaceSearchBox
              id="add-search"
              onPick={(r: PlaceResult) => p.onFly(r.lng, r.lat, 16)}
            />
          </details>
          <TextField
            id="placeLabel"
            label={pt.add.where.placeLabel}
            hint={pt.add.where.placeLabelHint}
            value={details.placeLabel}
            maxLength={LIMITS.titleMax}
            onValue={(v) => setDetails({ ...details, placeLabel: v })}
            error={errors.placeLabel}
          />
        </div>
      )}

      {step === 'what' && (
        <div class="add-body">
          <EventDetailsFields value={details} onChange={setDetails} errors={errors} />
          <PosterField id="poster" value={poster} onChange={setPoster} />
        </div>
      )}

      {step === 'when' && (
        <div class="add-body">
          <OccurrencesEditor
            rows={rows}
            onChange={setRows}
            errors={errors}
            tz={tz}
            minDate={today}
            maxDate={maxDate}
            mode="create"
          />
        </div>
      )}

      {step === 'contact' && (
        <div class="add-body">
          <TextField
            id="contactEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            label={pt.add.contact.email}
            hint={pt.add.contact.emailHint}
            value={email}
            onValue={setEmail}
            error={errors.contactEmail}
          />
        </div>
      )}

      {step === LAST_STEP && (
        <>
          {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
          <div class="hp" aria-hidden="true">
            <label for="website">{pt.add.contact.honeypot}</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onInput={(e) => setHoneypot(e.currentTarget.value)}
            />
          </div>
          <div ref={captchaRef} class="captcha" />
        </>
      )}

      {step === LAST_STEP && duplicates && duplicates.length > 0 && (
        <div class="duplicates" role="status" ref={duplicatesRef}>
          <p>
            <strong>{pt.add.duplicates.heading}</strong>
          </p>
          <ul>
            {duplicates.map((d) => (
              <li key={d.event.id}>
                <a href={`/mapa/e/${d.event.id}`} target="_blank" rel="noopener">
                  {d.event.title}
                </a>
                <span class="hint">{d.dates.map(formatShortDayLabel).join(', ')}</span>
              </li>
            ))}
          </ul>
          <p class="hint">{pt.add.duplicates.hint}</p>
        </div>
      )}

      <p class="form-error" role="alert">
        {formError}
      </p>

      <div class="add-actions">
        {stepIndex > 0 && (
          <button type="button" class="btn" onClick={back} disabled={submitting}>
            {pt.add.back}
          </button>
        )}
        {step !== LAST_STEP ? (
          <button type="button" class="btn-primary" onClick={next}>
            {pt.add.next}
          </button>
        ) : (
          <button
            type="button"
            class="btn-primary"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting
              ? pt.add.submitting
              : duplicates?.length
                ? pt.add.duplicates.submitAnyway
                : pt.add.submit}
          </button>
        )}
      </div>
    </section>
  );
}
