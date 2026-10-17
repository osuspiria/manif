import { describe, expect, it } from 'vitest';
import type { EventType } from '../../src/config/event-types';
import { toUtcRange, type Tz } from '../../src/shared/dates';
import {
  filterEvents,
  type FilterableEvent,
  type FilterableOccurrence,
} from '../../src/shared/event-filter';
import {
  countByType,
  formatDayHeading,
  formatLongDate,
  formatOccurrence,
  formatShortDate,
  groupByDay,
  showsDayLabels,
  summaryLabel,
} from '../../src/shared/event-view';

const o = (localDate: string, startTime: string | null, endTime: string | null = null) => ({
  localDate,
  startTime,
  endTime,
});

describe('formatOccurrence', () => {
  it('formats date and time range', () => {
    expect(formatOccurrence(o('2026-11-24', '15:00', '18:00'), 'Europe/Lisbon')).toBe(
      'ter, 24 nov · 15:00–18:00',
    );
  });

  it('formats a start time only', () => {
    expect(formatOccurrence(o('2026-11-24', '15:00'), 'Europe/Lisbon')).toBe('ter, 24 nov · 15:00');
  });

  it('formats an all-day occurrence', () => {
    expect(formatOccurrence(o('2026-11-24', null), 'Europe/Lisbon')).toBe(
      'ter, 24 nov · todo o dia',
    );
  });

  it('adds "(hora dos Açores)" for the Azores only', () => {
    expect(formatOccurrence(o('2026-11-14', '23:30'), 'Atlantic/Azores')).toBe(
      'sáb, 14 nov · 23:30 (hora dos Açores)',
    );
    expect(formatOccurrence(o('2026-11-14', '23:30'), 'Atlantic/Madeira')).toBe(
      'sáb, 14 nov · 23:30',
    );
  });

  it('does not add the Azores suffix to all-day occurrences', () => {
    expect(formatOccurrence(o('2026-11-14', null), 'Atlantic/Azores')).toBe(
      'sáb, 14 nov · todo o dia',
    );
  });
});

describe('date labels', () => {
  it('formatDayHeading', () => {
    expect(formatDayHeading('2026-11-28')).toBe('Sábado, 28 nov');
    expect(formatDayHeading('2026-11-30')).toBe('Segunda-feira, 30 nov');
  });

  it('formatShortDate', () => {
    expect(formatShortDate('2026-11-28')).toBe('28/11');
    expect(formatShortDate('2026-01-05')).toBe('5/1');
  });

  it('formatLongDate', () => {
    expect(formatLongDate('2026-11-28')).toBe('sábado, 28 de novembro');
  });
});

describe('summaryLabel', () => {
  it.each([
    [23, { kind: 'weekend' }, [], '23 eventos · Este fim de semana'],
    [1, { kind: 'today' }, [], '1 evento · Hoje'],
    [0, { kind: 'tomorrow' }, [], '0 eventos · Amanhã'],
    [4, { kind: 'upcoming' }, [], '4 eventos · Próximos'],
    [4, { kind: 'next7' }, ['rally'], '4 eventos · Próximos 7 dias · 1 tipo'],
    [
      5,
      { kind: 'day', date: '2026-11-28' },
      ['rally', 'action'],
      '5 eventos · sáb, 28 nov · 2 tipos',
    ],
    [1234, { kind: 'upcoming' }, [], '1234 eventos · Próximos'],
  ] as const)('%i %o %o → %s', (n, when, types, expected) => {
    // pt-PT groups thousands only from 5 digits; normalise the narrow space.
    expect(summaryLabel(n, when, types).replace(/[\u00a0\u202f]/g, ' ')).toBe(expected);
  });
});

describe('showsDayLabels', () => {
  it('only when the range spans several days', () => {
    expect(showsDayLabels({ kind: 'upcoming' })).toBe(true);
    expect(showsDayLabels({ kind: 'next7' })).toBe(true);
    expect(showsDayLabels({ kind: 'weekend' })).toBe(true);
    expect(showsDayLabels({ kind: 'today' })).toBe(false);
    expect(showsDayLabels({ kind: 'tomorrow' })).toBe(false);
    expect(showsDayLabels({ kind: 'day', date: '2026-11-28' })).toBe(false);
  });
});

// --- results helpers ---------------------------------------------------------

let seq = 0;
function occ(localDate: string, startTime: string | null, tz: Tz): FilterableOccurrence {
  const r = toUtcRange({ localDate, startTime, endTime: null }, tz);
  return { id: `o${++seq}`, localDate, startTime, endTime: null, cancelled: false, ...r };
}
function ev(
  id: string,
  type: EventType,
  dates: [string, string | null][],
  tz: Tz = 'Europe/Lisbon',
): FilterableEvent {
  return { id, type, tz, occurrences: dates.map(([d, t]) => occ(d, t, tz)) };
}
const NOW = new Date('2026-11-11T10:00:00Z');

describe('countByType', () => {
  it('counts every type, including zeros', () => {
    const results = filterEvents(
      [
        ev('a', 'rally', [['2026-11-12', '10:00']]),
        ev('b', 'rally', [['2026-11-13', '10:00']]),
        ev('c', 'assembly', [['2026-11-13', '10:00']]),
      ],
      { when: { kind: 'upcoming' }, types: [] },
      NOW,
    );
    expect(countByType(results)).toEqual({
      demonstration: 0,
      rally: 2,
      action: 0,
      assembly: 1,
      other: 0,
    });
  });
});

describe('groupByDay', () => {
  it('groups by the highlighted local date, in date order', () => {
    const results = filterEvents(
      [
        ev('lx-15', 'rally', [['2026-11-15', '00:10']]),
        ev('az-14', 'rally', [['2026-11-14', '23:30']], 'Atlantic/Azores'), // 00:30 UTC on 15th
        ev('lx-14', 'rally', [['2026-11-14', '18:00']]),
        ev('lx-20', 'rally', [['2026-11-20', '18:00']]),
      ],
      { when: { kind: 'upcoming' }, types: [] },
      NOW,
    );
    expect(groupByDay(results).map((g) => [g.date, g.items.map((r) => r.event.id)])).toEqual([
      ['2026-11-14', ['lx-14', 'az-14']],
      ['2026-11-15', ['lx-15']],
      ['2026-11-20', ['lx-20']],
    ]);
  });
});
