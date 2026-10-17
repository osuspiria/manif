/**
 * List of dates (SPEC §4.4 "Quando"): one row per occurrence with native date
 * and time inputs, "+ Adicionar outra data" (copies the previous times) and
 * "Repetir semanalmente até…" (generates editable rows).
 */
import { useState } from 'preact/hooks';
import { LIMITS } from '../../config/app';
import { pt } from '../../i18n/pt';
import type { Tz } from '../../shared/dates';
import { formatOccurrence } from '../../shared/event-view';
import { weeklyRepeat } from '../../shared/occurrence-rules';
import { Checkbox, TextField } from './fields';
import { emptyRow, newRowKey, type FieldErrors, type RowState } from './form-state';

interface Props {
  rows: RowState[];
  onChange: (rows: RowState[]) => void;
  errors: FieldErrors;
  tz: Tz | null;
  /** Earliest selectable date ('YYYY-MM-DD'). */
  minDate: string;
  maxDate: string;
  /** Edit page: existing rows get cancel/restore instead of only remove. */
  mode: 'create' | 'edit';
}

export function OccurrencesEditor({ rows, onChange, errors, tz, minDate, maxDate, mode }: Props) {
  // New events only ask for a start time; the edit page keeps the end time of existing ones.
  const withEnd = mode === 'edit';
  const [repeatUntil, setRepeatUntil] = useState('');
  const [repeatMsg, setRepeatMsg] = useState('');

  const update = (key: string, patch: Partial<RowState>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const editable = rows.filter((r) => !r.past);
  const full = rows.length >= LIMITS.occurrencesMax;

  const addRow = () => onChange([...rows, emptyRow(editable.at(-1))]);

  const repeat = () => {
    const first = editable[0];
    if (!first?.localDate) return setRepeatMsg(pt.add.when.repeatNeedsFirst);
    const existing = new Set(rows.map((r) => r.localDate));
    const dates = weeklyRepeat(
      first.localDate,
      repeatUntil,
      LIMITS.occurrencesMax - rows.length,
    ).filter((d) => !existing.has(d));
    onChange([
      ...rows,
      ...dates.map((localDate) => ({
        ...first,
        key: newRowKey(),
        id: undefined,
        localDate,
        cancelled: false,
      })),
    ]);
    setRepeatMsg(pt.add.when.repeatAdded(dates.length));
  };

  return (
    <div class="occurrences">
      {tz === 'Atlantic/Azores' && <p class="hint">{pt.add.when.azoresNote}</p>}
      {errors.occurrences && <p class="field-error">{errors.occurrences}</p>}
      <ol class="occ-rows">
        {rows.map((r, i) => {
          const e = (f: string) => errors[`occurrences.${i}.${f}`];
          const id = (f: string) => `occ-${r.key}-${f}`;
          if (r.past) {
            return (
              <li key={r.key} class="occ-row occ-row-past">
                <span>
                  {tz
                    ? formatOccurrence(
                        {
                          ...r,
                          startTime: r.allDay ? null : r.startTime,
                          endTime: r.endTime || null,
                        },
                        tz,
                      )
                    : r.localDate}
                </span>
                <span class="badge">{pt.edit.past}</span>
              </li>
            );
          }
          return (
            <li key={r.key} class={r.cancelled ? 'occ-row occ-row-cancelled' : 'occ-row'}>
              <fieldset>
                <legend>
                  {pt.add.when.rowLabel(i + 1)}
                  {r.cancelled && <span class="badge"> {pt.edit.cancelledBadge}</span>}
                </legend>
                <TextField
                  id={id('date')}
                  type="date"
                  label={pt.add.when.date}
                  value={r.localDate}
                  min={minDate}
                  max={maxDate}
                  required
                  onValue={(v) => update(r.key, { localDate: v })}
                  error={e('localDate')}
                />
                <Checkbox
                  id={id('allday')}
                  label={pt.add.when.allDay}
                  checked={r.allDay}
                  onChecked={(v) => update(r.key, { allDay: v })}
                />
                {!r.allDay && !withEnd && (
                  <TextField
                    id={id('start')}
                    type="time"
                    label={pt.add.when.start}
                    value={r.startTime}
                    onValue={(v) => update(r.key, { startTime: v })}
                    error={e('startTime')}
                  />
                )}
                {!r.allDay && withEnd && (
                  <div class="time-pair">
                    <TextField
                      id={id('start')}
                      type="time"
                      label={pt.add.when.start}
                      value={r.startTime}
                      onValue={(v) => update(r.key, { startTime: v })}
                      error={e('startTime')}
                    />
                    <TextField
                      id={id('end')}
                      type="time"
                      label={pt.add.when.end}
                      value={r.endTime}
                      onValue={(v) => update(r.key, { endTime: v })}
                      error={e('endTime')}
                    />
                  </div>
                )}
                {!r.allDay && withEnd && r.endTime && r.startTime && r.endTime < r.startTime && (
                  <p class="hint">{pt.add.when.endHint}</p>
                )}
                <TextField
                  id={id('note')}
                  label={pt.add.when.note}
                  hint={i === 0 ? pt.add.when.noteHint : undefined}
                  value={r.note}
                  maxLength={LIMITS.occurrenceNoteMax}
                  onValue={(v) => update(r.key, { note: v })}
                  error={e('note')}
                />
                <div class="row-actions">
                  {mode === 'edit' && r.id && (
                    <button
                      type="button"
                      class="btn"
                      onClick={() => update(r.key, { cancelled: !r.cancelled })}
                    >
                      {r.cancelled ? pt.edit.restoreDate : pt.edit.cancelDate}
                    </button>
                  )}
                  {editable.length > 1 && (
                    <button type="button" class="btn-link" onClick={() => remove(r.key)}>
                      {pt.add.when.removeRow}
                    </button>
                  )}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <button type="button" class="btn" onClick={addRow} disabled={full}>
        {pt.add.when.addRow}
      </button>

      <div class="repeat">
        <TextField
          id="repeat-until"
          type="date"
          label={pt.add.when.repeatLabel}
          hint={pt.add.when.repeatHint}
          value={repeatUntil}
          min={editable[0]?.localDate || minDate}
          max={maxDate}
          onValue={setRepeatUntil}
        />
        <button type="button" class="btn" onClick={repeat} disabled={!repeatUntil || full}>
          {pt.add.when.repeatButton}
        </button>
        <p class="hint" role="status">
          {repeatMsg}
        </p>
      </div>
    </div>
  );
}
