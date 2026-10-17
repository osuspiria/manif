/**
 * Pure form state for event details and date rows, shared by the "Adicionar"
 * flow and the edit page. Inputs are strings ('' = empty); conversion to the
 * API shape happens here.
 */
import type { EventType } from '../../config/event-types';
import { pt } from '../../i18n/pt';
import type {
  ApiIssue,
  EditableEvent,
  EditOccurrence,
  OccurrenceInput,
} from '../../shared/schemas';

export interface DetailsState {
  type: EventType | '';
  title: string;
  description: string;
  organizer: string;
  placeLabel: string;
}

export interface RowState {
  /** Stable key for rendering. */
  key: string;
  /** Existing occurrence id (edit page). */
  id?: string;
  localDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  note: string;
  cancelled: boolean;
  /** Past occurrence: read-only. */
  past?: boolean;
}

let rowSeq = 0;
export const newRowKey = () => `row-${++rowSeq}`;

export const emptyDetails = (): DetailsState => ({
  type: '',
  title: '',
  description: '',
  organizer: '',
  placeLabel: '',
});

export function emptyRow(copyFrom?: RowState): RowState {
  return {
    key: newRowKey(),
    localDate: '',
    allDay: copyFrom?.allDay ?? false,
    startTime: copyFrom?.startTime ?? '',
    endTime: copyFrom?.endTime ?? '',
    note: '',
    cancelled: false,
  };
}

const nul = (v: string) => (v.trim() === '' ? null : v.trim());

export function rowToOccurrence(r: RowState): OccurrenceInput {
  return {
    localDate: r.localDate,
    startTime: r.allDay ? null : nul(r.startTime),
    endTime: r.allDay ? null : nul(r.endTime),
    note: nul(r.note),
  };
}

export function rowToEdit(r: RowState): EditOccurrence {
  return { ...rowToOccurrence(r), id: r.id, cancelled: r.cancelled };
}

export function detailsToInput(d: DetailsState) {
  return {
    type: d.type,
    title: d.title.trim(),
    description: nul(d.description),
    organizer: nul(d.organizer),
    placeLabel: nul(d.placeLabel),
  };
}

export function fromEditable(
  e: EditableEvent,
  nowIso: string,
): { details: DetailsState; rows: RowState[] } {
  return {
    details: {
      type: e.type,
      title: e.title,
      description: e.description ?? '',
      organizer: e.organizer ?? '',
      placeLabel: e.placeLabel ?? '',
    },
    rows: e.occurrences.map((o) => ({
      key: newRowKey(),
      id: o.id,
      localDate: o.localDate,
      allDay: o.startTime === null,
      startTime: o.startTime ?? '',
      endTime: o.endTime ?? '',
      note: o.note ?? '',
      cancelled: o.cancelled,
      past: o.endsAt <= nowIso,
    })),
  };
}

/** Field error messages keyed by path ('title', 'occurrences.2.localDate'…). */
export type FieldErrors = Record<string, string>;

export function issuesToErrors(issues: readonly ApiIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const i of issues) {
    const key = i.path.join('.');
    errors[key] ??= pt.errors.codes[i.code] ?? pt.add.errors.generic;
  }
  return errors;
}

/** Remaps `occurrences.N…` paths when only some rows were validated. */
export function remapRowIssues(
  issues: readonly ApiIssue[],
  rowIndexes: readonly number[],
): ApiIssue[] {
  return issues.map((i) =>
    i.path[0] === 'occurrences' && typeof i.path[1] === 'number'
      ? { ...i, path: ['occurrences', rowIndexes[i.path[1]] ?? i.path[1], ...i.path.slice(2)] }
      : i,
  );
}

/** Moves focus to the first invalid field inside `root` (forms: focus on first error). */
export function focusFirstError(root: HTMLElement | null): void {
  root
    ?.querySelector<HTMLElement>(
      'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"], [tabindex][aria-invalid="true"]',
    )
    ?.focus();
}
