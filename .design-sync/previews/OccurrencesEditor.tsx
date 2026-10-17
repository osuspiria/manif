import { useState } from 'react';
import { OccurrencesEditor, type RowState } from 'mobilizacao-pt-ui';

const timed: RowState = {
  key: 'r1',
  localDate: '2026-10-24',
  allDay: false,
  startTime: '15:00',
  endTime: '18:00',
  note: '',
  cancelled: false,
};

export function SingleDate() {
  const [rows, setRows] = useState<RowState[]>([timed]);
  return (
    <OccurrencesEditor
      rows={rows}
      onChange={setRows}
      errors={{}}
      tz="Europe/Lisbon"
      minDate="2026-10-17"
      maxDate="2027-10-17"
      mode="create"
    />
  );
}

export function SeveralDatesWithError() {
  const [rows, setRows] = useState<RowState[]>([
    { ...timed, key: 'r3', localDate: '', allDay: true, startTime: '', endTime: '' },
    { ...timed, key: 'r2', localDate: '2026-10-31', note: 'Percurso alternativo' },
  ]);
  return (
    <OccurrencesEditor
      rows={rows}
      onChange={setRows}
      errors={{ 'occurrences.0.localDate': 'Escolhe uma data.' }}
      tz="Europe/Lisbon"
      minDate="2026-10-17"
      maxDate="2027-10-17"
      mode="create"
    />
  );
}

export function EditWithPastAndCancelled() {
  const [rows, setRows] = useState<RowState[]>([
    { ...timed, key: 'p1', id: 'o0', localDate: '2026-10-10', past: true },
    { ...timed, key: 'e1', id: 'o1' },
    { ...timed, key: 'e2', id: 'o2', localDate: '2026-10-31', cancelled: true },
  ]);
  return (
    <OccurrencesEditor
      rows={rows}
      onChange={setRows}
      errors={{}}
      tz="Atlantic/Azores"
      minDate="2026-10-17"
      maxDate="2027-10-17"
      mode="edit"
    />
  );
}
