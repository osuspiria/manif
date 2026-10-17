import { useState } from 'react';
import { TextField } from 'mobilizacao-pt-ui';

export function Default() {
  const [v, setV] = useState('Marcha pelo clima');
  return <TextField id="title" label="Título" value={v} onValue={setV} maxLength={90} required />;
}

export function WithHint() {
  const [v, setV] = useState('');
  return (
    <TextField
      id="organizer"
      label="Organização (opcional)"
      hint="Aparece publicamente no evento."
      value={v}
      onValue={setV}
    />
  );
}

export function WithError() {
  const [v, setV] = useState('');
  return (
    <TextField id="title-err" label="Título" error="Escreve um título." value={v} onValue={setV} required />
  );
}

export function DateAndTime() {
  const [d, setD] = useState('2026-10-24');
  const [t, setT] = useState('15:00');
  return (
    <div>
      <TextField id="date" type="date" label="Data" value={d} onValue={setD} min="2026-10-17" />
      <TextField id="time" type="time" label="Hora de início" value={t} onValue={setT} />
    </div>
  );
}

export function Disabled() {
  return <TextField id="place" label="Local" value="Praça do Comércio" onValue={() => {}} disabled />;
}
