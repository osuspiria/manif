/**
 * Edit an existing event: details and dates, cancel a date or the whole event.
 * Shared by the owner's page (/editar, secret link) and the admin (/admin).
 */
import { useRef, useState } from 'preact/hooks';
import { LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import { currentTime } from '../../map/clock';
import { addMonths, nowIso, todayIn } from '../../shared/dates';
import { checkOccurrences } from '../../shared/occurrence-rules';
import { UpdateEventRequestSchema, type ApiIssue, type EditableEvent } from '../../shared/schemas';
import { EventDetailsFields } from './EventDetailsFields';
import {
  detailsToInput,
  focusFirstError,
  fromEditable,
  issuesToErrors,
  rowToEdit,
  rowToOccurrence,
  type FieldErrors,
} from './form-state';
import { OccurrencesEditor } from './OccurrencesEditor';

export type SaveResult =
  { ok: true; event: EditableEvent } | { ok: false; issues?: ApiIssue[]; network?: boolean };

interface Props {
  event: EditableEvent;
  /** PATCH body: `{…fields, occurrences}` or `{cancelEvent: true}`. */
  onSave: (body: unknown) => Promise<SaveResult>;
  /** Called with the saved event (e.g. to refresh the rest of the page). */
  onSaved?: (event: EditableEvent) => void;
  verifiedNote: string;
  /** Level of the "Informação"/"Datas" headings in the host page. */
  headingLevel?: 2 | 4;
}

export function EventEditForm({ event, onSave, onSaved, verifiedNote, headingLevel = 2 }: Props) {
  const H = headingLevel === 2 ? 'h2' : 'h4';
  const initial = fromEditable(event, nowIso(currentTime()));
  const [details, setDetails] = useState(initial.details);
  const [rows, setRows] = useState(initial.rows);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const now = currentTime();

  function showIssues(issues: ApiIssue[]) {
    setErrors(issuesToErrors(issues));
    setFormError(pt.add.errors.fix);
    requestAnimationFrame(() => focusFirstError(formRef.current));
  }

  async function send(body: unknown): Promise<boolean> {
    setSaving(true);
    setFormError('');
    setMessage('');
    try {
      const result = await onSave(body);
      if (result.ok) {
        const next = fromEditable(result.event, nowIso(currentTime()));
        setDetails(next.details);
        setRows(next.rows);
        setErrors({});
        onSaved?.(result.event);
        return true;
      }
      if (result.issues?.length) showIssues(result.issues);
      else setFormError(result.network ? pt.add.errors.network : pt.add.errors.generic);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save(e: Event) {
    e.preventDefault();
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
      ...checkOccurrences(rows.map(rowToOccurrence), event.tz, currentTime(), (i) =>
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

  const today = todayIn(event.tz, now);
  const hasFuture = rows.some((r) => !r.past && !r.cancelled);

  return (
    <form ref={formRef} class="edit-form" onSubmit={(ev) => void save(ev)} noValidate>
      <p class="hint">{verifiedNote}</p>

      <H>{pt.edit.detailsHeading}</H>
      <EventDetailsFields value={details} onChange={setDetails} errors={errors} withPlaceLabel />

      <H>{pt.edit.datesHeading}</H>
      <OccurrencesEditor
        rows={rows}
        onChange={setRows}
        errors={errors}
        tz={event.tz}
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
        {event.status === 'published' && (
          <a class="btn" href={`/mapa/e/${event.id}`}>
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
