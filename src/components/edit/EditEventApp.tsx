/**
 * /editar/#e=<id>&t=<token> — edit an event with its secret link (SPEC §4.4):
 * change details and dates, cancel a date or the whole event. The token stays
 * in the URL fragment and is sent only in the X-Edit-Token header.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import { addMonths, nowIso, todayIn } from '../../shared/dates';
import { checkOccurrences } from '../../shared/occurrence-rules';
import { UpdateEventRequestSchema, type ApiIssue, type EditableEvent } from '../../shared/schemas';
import { currentTime } from '../../map/clock';
import { EventDetailsFields } from '../forms/EventDetailsFields';
import {
  detailsToInput,
  focusFirstError,
  fromEditable,
  issuesToErrors,
  rowToEdit,
  rowToOccurrence,
  type DetailsState,
  type FieldErrors,
  type RowState,
} from '../forms/form-state';
import { OccurrencesEditor } from '../forms/OccurrencesEditor';

type Load = { state: 'loading' } | { state: 'invalid' } | { state: 'ok'; event: EditableEvent };

function readFragment(): { id: string; token: string } | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const id = params.get('e');
  const token = params.get('t');
  return id && token ? { id, token } : null;
}

export function EditEventApp() {
  const [link] = useState(readFragment);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const now = currentTime();

  function apply(event: EditableEvent) {
    const { details: d, rows: r } = fromEditable(event, nowIso(currentTime()));
    setLoad({ state: 'ok', event });
    setDetails(d);
    setRows(r);
  }

  useEffect(() => {
    if (!link) return setLoad({ state: 'invalid' });
    fetch(`/api/events/${link.id}/edit`, { headers: { 'X-Edit-Token': link.token } })
      .then((r) => (r.ok ? (r.json() as Promise<EditableEvent>) : null))
      .then((e) => (e ? apply(e) : setLoad({ state: 'invalid' })))
      .catch(() => setLoad({ state: 'invalid' }));
  }, []);

  async function send(body: unknown): Promise<boolean> {
    if (!link) return false;
    setSaving(true);
    setFormError('');
    setMessage('');
    try {
      const res = await fetch(`/api/events/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Edit-Token': link.token },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as EditableEvent & { issues?: ApiIssue[] };
      if (res.ok) {
        apply(json);
        setErrors({});
        return true;
      }
      if (json.issues?.length) showIssues(json.issues);
      else setFormError(pt.add.errors.generic);
      return false;
    } catch {
      setFormError(pt.add.errors.network);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function showIssues(issues: ApiIssue[]) {
    setErrors(issuesToErrors(issues));
    setFormError(pt.add.errors.fix);
    requestAnimationFrame(() => focusFirstError(formRef.current));
  }

  async function save(e: Event) {
    e.preventDefault();
    if (load.state !== 'ok' || !details) return;
    const body = { ...detailsToInput(details), occurrences: rows.map(rowToEdit) };
    const issues: ApiIssue[] = [];
    const parsed = UpdateEventRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({
          path: i.path.filter((x) => typeof x !== 'symbol') as (string | number)[],
          code: i.message,
        });
      }
    }
    issues.push(
      ...checkOccurrences(rows.map(rowToOccurrence), load.event.tz, currentTime(), (i) =>
        Boolean(rows[i]?.past),
      ),
    );
    if (issues.length) return showIssues(issues);
    if (await send(body)) setMessage(pt.edit.saved);
  }

  async function cancelEvent() {
    setConfirmCancel(false);
    if (await send({ cancelEvent: true })) setMessage(pt.edit.eventCancelled);
  }

  if (load.state === 'loading') return <p>{pt.edit.loading}</p>;
  if (load.state === 'invalid' || !details) return <p role="alert">{pt.edit.invalidLink}</p>;

  const e = load.event;
  const today = todayIn(e.tz, now);
  const hasFuture = rows.some((r) => !r.past && !r.cancelled);

  return (
    <form ref={formRef} class="edit-form" onSubmit={(ev) => void save(ev)} noValidate>
      <p>
        <strong>{pt.edit.statusLabel}:</strong> {pt.edit.status[e.status]} ·{' '}
        <span class={e.verified ? 'badge badge-ok' : 'badge'}>
          {e.verified ? pt.event.verified : pt.event.unverified}
        </span>
      </p>
      <p>
        <strong>{pt.edit.place}:</strong>{' '}
        {[e.placeLabel, e.municipality, e.district].filter(Boolean).join(' · ')}
      </p>
      <p class="hint">{pt.edit.verifiedNote}</p>

      <h2>{pt.edit.detailsHeading}</h2>
      <EventDetailsFields value={details} onChange={setDetails} errors={errors} withPlaceLabel />

      <h2>{pt.edit.datesHeading}</h2>
      <OccurrencesEditor
        rows={rows}
        onChange={setRows}
        errors={errors}
        tz={e.tz}
        minDate={today}
        maxDate={addMonths(today, LIMITS.occurrenceMaxMonthsAhead)}
        mode="edit"
      />

      <p class="form-error" role="alert">
        {formError}
      </p>
      <p class="form-ok" role="status">
        {message}
      </p>

      <div class="add-actions">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? pt.edit.saving : pt.edit.save}
        </button>
        {e.status === 'published' && (
          <a class="btn" href={`/mapa/e/${e.id}`}>
            {pt.edit.viewOnMap}
          </a>
        )}
      </div>

      {hasFuture && (
        <div class="danger-zone">
          {!confirmCancel ? (
            <button type="button" class="btn btn-danger" onClick={() => setConfirmCancel(true)}>
              {pt.edit.cancelEvent}
            </button>
          ) : (
            <div role="group" aria-labelledby="cancel-confirm">
              <p id="cancel-confirm">{pt.edit.cancelEventConfirm}</p>
              <button type="button" class="btn btn-danger" onClick={() => void cancelEvent()}>
                {pt.edit.cancelEventYes}
              </button>{' '}
              <button type="button" class="btn" onClick={() => setConfirmCancel(false)}>
                {pt.edit.cancelEventNo}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
