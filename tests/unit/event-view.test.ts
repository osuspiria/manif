import { describe, expect, it } from 'vitest';
import type { EventType } from '../../src/config/event-types';
import { toUtcRange, type Tz } from '../../src/shared/dates';
import {
  filterEvents,
  type FilterableEvent,
  type FilterableOccurrence,
} from '../../src/shared/event-filter';
import {
  collapseDailyRuns,
  countByType,
  formatDailyRun,
  formatDayHeading,
  formatLongDate,
  formatOccurrence,
  formatOngoing,
  formatPlace,
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

  it('formatOngoing', () => {
    expect(formatOngoing('2026-10-12')).toBe('Todos os dias desde seg, 12 out');
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
    expect(showsDayLabels({ kind: 'past' })).toBe(true);
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
      camp: 0,
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

  it('newest day first when asked (past events), keeping the order within a day', () => {
    const results = filterEvents(
      [
        ev('a', 'rally', [['2026-11-01', '18:00']]),
        ev('b', 'rally', [['2026-11-03', '10:00']]),
        ev('c', 'rally', [['2026-11-03', '18:00']]),
      ],
      { when: { kind: 'past' }, types: [] },
      NOW,
    );
    expect(
      groupByDay(results, 'desc').map((g) => [g.date, g.items.map((r) => r.event.id)]),
    ).toEqual([
      ['2026-11-03', ['c', 'b']],
      ['2026-11-01', ['a']],
    ]);
  });
});

describe('formatPlace', () => {
  const place = (placeLabel: string | null, municipality: string, district: string) => ({
    placeLabel,
    municipality,
    district,
  });

  it('joins place, municipality and district', () => {
    expect(formatPlace(place('Praça da Sé', 'Guimarães', 'Braga'), { district: true })).toBe(
      'Praça da Sé · Guimarães · Braga',
    );
  });

  it('leaves out the district when it repeats the municipality', () => {
    expect(formatPlace(place('Avenida dos Aliados', 'Porto', 'Porto'), { district: true })).toBe(
      'Avenida dos Aliados · Porto',
    );
  });

  it('drops a trailing municipality already typed in the place name', () => {
    expect(formatPlace(place('Alameda D. Afonso Henriques, Lisboa', 'Lisboa', 'Lisboa'))).toBe(
      'Alameda D. Afonso Henriques · Lisboa',
    );
    expect(formatPlace(place('Rossio,  viseu ', 'Viseu', 'Viseu'))).toBe('Rossio · Viseu');
  });

  it('keeps a place name that only is the municipality, once', () => {
    expect(formatPlace(place('Lisboa', 'Lisboa', 'Lisboa'))).toBe('Lisboa');
    expect(formatPlace(place(null, 'Boticas', 'Vila Real'), { district: true })).toBe(
      'Boticas · Vila Real',
    );
  });

  it('keeps names that only contain the municipality elsewhere', () => {
    expect(formatPlace(place('Largo de Lisboa', 'Lisboa', 'Lisboa'))).toBe(
      'Largo de Lisboa · Lisboa',
    );
  });

  it('takes a custom separator', () => {
    expect(formatPlace(place('Rossio, Lisboa', 'Lisboa', 'Lisboa'), { separator: ', ' })).toBe(
      'Rossio, Lisboa',
    );
  });
});

describe('collapseDailyRuns', () => {
  const occ = (
    localDate: string,
    startTime: string | null = null,
    extra: { cancelled?: boolean; note?: string | null } = {},
  ) => ({ localDate, startTime, endTime: null, cancelled: false, note: null, ...extra });
  const shape = (entries: ReturnType<typeof collapseDailyRuns<ReturnType<typeof occ>>>) =>
    entries.map((e) =>
      e.kind === 'one' ? e.item.localDate : `${e.first.localDate}..${e.last.localDate}`,
    );

  it('folds three or more consecutive days with the same times into one run', () => {
    const items = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((d) => occ(d));
    expect(shape(collapseDailyRuns(items, (x) => x))).toEqual(['2026-10-31..2026-11-03']);
    const [run] = collapseDailyRuns(items, (x) => x);
    expect(run?.kind === 'daily' && run.count).toBe(4);
  });

  it('keeps short runs, gaps and different times as single dates', () => {
    const items = [
      occ('2026-11-01'),
      occ('2026-11-02'),
      occ('2026-11-04', '18:00'),
      occ('2026-11-05', '18:00'),
      occ('2026-11-06', '19:00'),
    ];
    expect(shape(collapseDailyRuns(items, (x) => x))).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
  });

  it('never folds a cancelled date or one with a note', () => {
    const items = [
      occ('2026-11-01'),
      occ('2026-11-02'),
      occ('2026-11-03', null, { cancelled: true }),
      occ('2026-11-04'),
      occ('2026-11-05', null, { note: 'Com concerto' }),
      occ('2026-11-06'),
      occ('2026-11-07'),
      occ('2026-11-08'),
    ];
    expect(shape(collapseDailyRuns(items, (x) => x))).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06..2026-11-08',
    ]);
  });

  it('runs across a month end and the October clock change', () => {
    const items = ['2026-10-24', '2026-10-25', '2026-10-26'].map((d) => occ(d, '19:00'));
    expect(shape(collapseDailyRuns(items, (x) => x))).toEqual(['2026-10-24..2026-10-26']);
  });

  it('only joins items the caller says belong together', () => {
    const items = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => ({
      o: occ(d),
      faded: i >= 2,
    }));
    const entries = collapseDailyRuns(
      items,
      (x) => x.o,
      (a, b) => a.faded === b.faded,
    );
    expect(entries.map((e) => e.kind)).toEqual(['one', 'one', 'one', 'one']);
  });
});

describe('formatDailyRun', () => {
  it('describes a run of all-day dates', () => {
    expect(formatDailyRun(o('2026-10-31', null), o('2026-11-12', null), 'Europe/Lisbon')).toBe(
      'Todos os dias de 31 out a 12 nov · todo o dia',
    );
  });

  it('describes a run with times, with the Azores suffix', () => {
    expect(
      formatDailyRun(o('2026-11-01', '19:00'), o('2026-11-05', '19:00'), 'Atlantic/Azores'),
    ).toBe('Todos os dias de 1 nov a 5 nov · 19:00 (hora dos Açores)');
  });
});
