import { useState } from 'react';
import { EventDetailsFields, emptyDetails, type DetailsState } from 'mobilizacao-pt-ui';

export function Empty() {
  const [v, setV] = useState<DetailsState>(emptyDetails());
  return <EventDetailsFields value={v} onChange={setV} errors={{}} />;
}

export function Filled() {
  const [v, setV] = useState<DetailsState>({
    type: 'demonstration',
    title: 'Marcha pelo clima (exemplo)',
    description: 'Concentração na praça e desfile até à Assembleia.',
    organizer: 'Coletivo Exemplo pelo Clima',
    placeLabel: 'Praça do Comércio',
  });
  return <EventDetailsFields value={v} onChange={setV} errors={{}} withPlaceLabel />;
}

export function WithErrors() {
  const [v, setV] = useState<DetailsState>({ ...emptyDetails(), title: 'Ma' });
  return (
    <EventDetailsFields
      value={v}
      onChange={setV}
      errors={{ type: 'Escolhe o tipo de evento.', title: 'O título tem de ter pelo menos 3 caracteres.' }}
    />
  );
}
