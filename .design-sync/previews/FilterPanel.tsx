import { useState } from 'react';
import {
  FilterPanel,
  countByDay,
  countByType,
  filterEvents,
  lisbonToday,
  summaryLabel,
  type EventType,
  type WhenFilter,
} from 'mobilizacao-pt-ui';
import { EVENTS, NOW } from './_fixtures';

function Panel({ initialWhen, stripOpen, overlay }: { initialWhen: WhenFilter; stripOpen: boolean; overlay: boolean }) {
  const [when, setWhen] = useState<WhenFilter>(initialWhen);
  const [types, setTypes] = useState<EventType[]>([]);
  const [open, setOpen] = useState(stripOpen);
  const results = filterEvents(EVENTS, { when, types }, NOW);
  const isDefault = when.kind === 'upcoming' && types.length === 0;
  return (
    <FilterPanel
      id="filters"
      when={when}
      types={types}
      typeCounts={countByType(filterEvents(EVENTS, { when, types: [] }, NOW))}
      dayCounts={countByDay(EVENTS, types, NOW, 14)}
      today={lisbonToday(NOW)}
      dayStripOpen={open}
      isDefault={isDefault}
      resultsLabel={summaryLabel(results.length, when, types)}
      overlay={overlay}
      onWhen={setWhen}
      onToggleType={(t) => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}
      onToggleDayStrip={() => setOpen(!open)}
      onClear={() => {
        setWhen({ kind: 'upcoming' });
        setTypes([]);
      }}
      onClose={() => {}}
    />
  );
}

export function Default() {
  return <Panel initialWhen={{ kind: 'upcoming' }} stripOpen={false} overlay={false} />;
}

export function WeekendSelected() {
  return <Panel initialWhen={{ kind: 'weekend' }} stripOpen={false} overlay={false} />;
}

export function DayStripOpen() {
  return <Panel initialWhen={{ kind: 'day', date: '2026-10-20' }} stripOpen overlay={false} />;
}

export function MobileOverlay() {
  return <Panel initialWhen={{ kind: 'today' }} stripOpen={false} overlay />;
}
