import { useState } from 'react';
import { EventList, filterEvents } from 'mobilizacao-pt-ui';
import { EVENTS, NOW } from './_fixtures';

export function Upcoming() {
  const [selected, setSelected] = useState<string | null>(null);
  const results = filterEvents(EVENTS, { when: { kind: 'upcoming' }, types: [] }, NOW);
  return <EventList results={results} selectedId={selected} onSelect={setSelected} />;
}

export function SelectedCard() {
  const [selected, setSelected] = useState<string | null>(EVENTS[1]!.id);
  const results = filterEvents(EVENTS, { when: { kind: 'weekend' }, types: [] }, NOW);
  return <EventList results={results} selectedId={selected} onSelect={setSelected} />;
}

export function Empty() {
  return <EventList results={[]} selectedId={null} onSelect={() => {}} />;
}
