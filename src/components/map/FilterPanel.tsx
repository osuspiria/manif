import { useEffect, useRef } from 'preact/hooks';
import { KEY_DATES } from '../../config/app';
import { EVENT_TYPE_KEYS, type EventType } from '../../config/event-types';
import { pt } from '../../i18n/pt';
import type { WhenFilter } from '../../shared/event-filter';
import { formatCount, formatLongDate, formatShortDayLabel } from '../../shared/event-view';
import { TypeIcon } from './TypeIcon';

type NamedWhen = Exclude<WhenFilter['kind'], 'day'>;
const WHEN_CHIPS: NamedWhen[] = ['upcoming', 'today', 'tomorrow', 'weekend', 'next7', 'past'];

export interface DayCount {
  date: string;
  count: number;
}

interface Props {
  id: string;
  when: WhenFilter;
  types: readonly EventType[];
  typeCounts: Record<EventType, number>;
  dayCounts: DayCount[];
  today: string;
  dayStripOpen: boolean;
  isDefault: boolean;
  resultsLabel: string;
  /** Mobile overlay mode: shows a close button and traps nothing (non-modal). */
  overlay: boolean;
  onWhen: (when: WhenFilter) => void;
  onToggleType: (type: EventType) => void;
  onToggleDayStrip: () => void;
  onClear: () => void;
  onClose: () => void;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

function DayStrip({
  days,
  selected,
  onPick,
}: {
  days: DayCount[];
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selected]);

  return (
    <div class="day-strip" role="group" aria-label={pt.map.dayStripLabel} ref={ref}>
      {days.map(({ date, count }, i) => {
        const [, month, day] = date.split('-');
        const showMonth = i === 0 || day === '01';
        const label = formatShortDayLabel(date).split(',')[0];
        const disabled = count === 0;
        return (
          <button
            key={date}
            type="button"
            class="day"
            aria-pressed={selected === date}
            disabled={disabled}
            aria-label={`${formatLongDate(date)}: ${
              disabled ? pt.map.noEventsThatDay : formatCount(count)
            }`}
            onClick={() => onPick(date)}
          >
            <span class="day-month" aria-hidden="true">
              {showMonth ? pt.monthsShort[Number(month) - 1] : ' '}
            </span>
            <span class="day-weekday" aria-hidden="true">
              {label}
            </span>
            <span class="day-number" aria-hidden="true">
              {Number(day)}
            </span>
            <span class="day-count" aria-hidden="true">
              {disabled ? '·' : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterPanel(p: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (p.overlay) headingRef.current?.focus();
  }, [p.overlay]);

  const keyDates = KEY_DATES.filter((d) => d >= p.today);
  const pickedDay = p.when.kind === 'day' ? p.when.date : null;
  const pickedIsKeyDate = pickedDay !== null && keyDates.includes(pickedDay);

  return (
    <section
      id={p.id}
      class="filter-panel"
      aria-labelledby={`${p.id}-heading`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && p.overlay) p.onClose();
      }}
    >
      <div class="filter-panel-head">
        <h2 id={`${p.id}-heading`} tabIndex={-1} ref={headingRef}>
          {pt.map.filtersHeading}
        </h2>
        {!p.isDefault && (
          <button type="button" class="btn-link" onClick={p.onClear}>
            {pt.when.clear}
          </button>
        )}
      </div>

      <h3 class="group-label" id={`${p.id}-when`}>
        {pt.map.whenGroup}
      </h3>
      <div class="chips chips-scroll" role="group" aria-labelledby={`${p.id}-when`}>
        {keyDates.map((date) => (
          <button
            key={date}
            type="button"
            class="chip chip-key"
            aria-pressed={pickedDay === date}
            aria-label={`${pt.map.keyDate}: ${formatLongDate(date)}`}
            onClick={() => p.onWhen({ kind: 'day', date })}
          >
            <span aria-hidden="true">● </span>
            {formatShortDayLabel(date).split(', ')[1]}
          </button>
        ))}
        {WHEN_CHIPS.map((kind) => (
          <button
            key={kind}
            type="button"
            class="chip"
            aria-pressed={p.when.kind === kind}
            onClick={() => p.onWhen({ kind })}
          >
            <span class="chip-check" aria-hidden="true">
              ✓
            </span>
            {pt.when[kind]}
          </button>
        ))}
        <button
          type="button"
          class="chip"
          aria-pressed={pickedDay !== null && !pickedIsKeyDate}
          aria-expanded={p.dayStripOpen}
          onClick={p.onToggleDayStrip}
        >
          <CalendarIcon />{' '}
          {pickedDay && !pickedIsKeyDate ? formatShortDayLabel(pickedDay) : pt.when.pickDay}
        </button>
      </div>

      {p.dayStripOpen && (
        <DayStrip
          days={p.dayCounts}
          selected={pickedDay}
          onPick={(date) => p.onWhen({ kind: 'day', date })}
        />
      )}

      <h3 class="group-label" id={`${p.id}-type`}>
        {pt.map.typeGroup}
      </h3>
      <div class="chips chips-wrap" role="group" aria-labelledby={`${p.id}-type`}>
        {EVENT_TYPE_KEYS.map((type) => (
          <button
            key={type}
            type="button"
            class="chip chip-type"
            aria-pressed={p.types.includes(type)}
            onClick={() => p.onToggleType(type)}
          >
            <span class="chip-check" aria-hidden="true">
              ✓
            </span>
            <TypeIcon type={type} size={18} />
            <span>{pt.eventTypes[type]}</span>
            <span class="chip-count">{p.typeCounts[type]}</span>
          </button>
        ))}
      </div>

      {p.overlay && (
        <button type="button" class="btn-primary filter-close" onClick={p.onClose}>
          {pt.map.closeFilters} — {p.resultsLabel}
        </button>
      )}
    </section>
  );
}
