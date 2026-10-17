import { describe, expect, it } from 'vitest';
import type { EventType } from '../../src/config/event-types';
import { toUtcRange, type Tz } from '../../src/shared/dates';
import {
  countByDay,
  filterEvents,
  type FilterableEvent,
  type FilterableOccurrence,
  type WhenFilter,
} from '../../src/shared/event-filter';

// --- fixtures ---------------------------------------------------------------

let seq = 0;

function occ(
  localDate: string,
  startTime: string | null,
  endTime: string | null = null,
  tz: Tz = 'Europe/Lisbon',
  cancelled = false,
): FilterableOccurrence {
  const { startsAt, endsAt } = toUtcRange({ localDate, startTime, endTime }, tz);
  return { id: `o${++seq}`, localDate, startTime, endTime, startsAt, endsAt, cancelled };
}

function ev(
  id: string,
  occurrences: (tz: Tz) => FilterableOccurrence[],
  opts: { tz?: Tz; type?: EventType } = {},
): FilterableEvent {
  const tz = opts.tz ?? 'Europe/Lisbon';
  return { id, type: opts.type ?? 'demonstration', tz, occurrences: occurrences(tz) };
}

const ids = (r: { event: { id: string } }[]) => r.map((x) => x.event.id);
const run = (events: FilterableEvent[], when: WhenFilter, now: string, types: EventType[] = []) =>
  filterEvents(events, { when, types }, new Date(now));

// Wednesday 11 Nov 2026, 10:00 Lisbon (= UTC in winter).
const WED = '2026-11-11T10:00:00Z';

// --- tests ------------------------------------------------------------------

describe('filterEvents — "Próximos"', () => {
  it('includes anything that has not ended yet', () => {
    const events = [
      ev('past', (tz) => [occ('2026-11-10', '18:00', '20:00', tz)]),
      ev('ongoing', (tz) => [occ('2026-11-11', '09:00', '11:00', tz)]),
      ev('future', (tz) => [occ('2026-12-01', '18:00', null, tz)]),
    ];
    expect(ids(run(events, { kind: 'upcoming' }, WED))).toEqual(['ongoing', 'future']);
  });

  it('excludes an event whose only remaining occurrence is cancelled', () => {
    const events = [
      ev('cancelled', (tz) => [occ('2026-11-20', '18:00', null, tz, true)]),
      ev('ok', (tz) => [occ('2026-11-21', '18:00', null, tz)]),
    ];
    expect(ids(run(events, { kind: 'upcoming' }, WED))).toEqual(['ok']);
  });

  it('never returns cancelled occurrences as highlight or as other dates', () => {
    const events = [
      ev('mixed', (tz) => [
        occ('2026-11-12', '18:00', null, tz, true),
        occ('2026-11-19', '18:00', null, tz),
        occ('2026-11-26', '18:00', null, tz, true),
      ]),
    ];
    const [r] = run(events, { kind: 'upcoming' }, WED);
    expect(r?.highlight.localDate).toBe('2026-11-19');
    expect(r?.inRange.map((o) => o.localDate)).toEqual(['2026-11-19']);
    expect(r?.others).toEqual([]);
  });

  it('with one past and one future occurrence, highlights the future one and drops the past', () => {
    const events = [
      ev('twice', (tz) => [
        occ('2026-11-04', '18:00', null, tz),
        occ('2026-11-18', '18:00', null, tz),
      ]),
    ];
    const [r] = run(events, { kind: 'upcoming' }, WED);
    expect(r?.highlight.localDate).toBe('2026-11-18');
    expect(r?.others).toEqual([]);
  });

  it('sorts results by the highlighted occurrence', () => {
    const events = [
      ev('later', (tz) => [occ('2026-11-30', '10:00', null, tz)]),
      ev('sooner', (tz) => [
        occ('2026-11-12', '10:00', null, tz),
        occ('2026-12-30', '10:00', null, tz),
      ]),
    ];
    expect(ids(run(events, { kind: 'upcoming' }, WED))).toEqual(['sooner', 'later']);
  });
});

describe('filterEvents — "Hoje" / "Amanhã"', () => {
  const events = [
    ev('today-earlier', (tz) => [occ('2026-11-11', '08:00', '09:00', tz)]),
    ev('today-later', (tz) => [occ('2026-11-11', '18:00', null, tz)]),
    ev('today-allday', (tz) => [occ('2026-11-11', null, null, tz)]),
    ev('tomorrow', (tz) => [occ('2026-11-12', '18:00', null, tz)]),
  ];

  it('Hoje only keeps today’s occurrences that have not ended', () => {
    expect(ids(run(events, { kind: 'today' }, WED))).toEqual(['today-allday', 'today-later']);
  });

  it('Amanhã keeps tomorrow only', () => {
    expect(ids(run(events, { kind: 'tomorrow' }, WED))).toEqual(['tomorrow']);
  });

  it('an occurrence crossing midnight shows on both days', () => {
    const night = [ev('night', (tz) => [occ('2026-11-11', '22:00', '02:00', tz)])];
    expect(ids(run(night, { kind: 'today' }, WED))).toEqual(['night']);
    expect(ids(run(night, { kind: 'tomorrow' }, WED))).toEqual(['night']);
  });

  it('uses the Lisbon civil day, not UTC (summer)', () => {
    // 23:30 UTC on 30 June = 00:30 on 1 July in Lisbon.
    const summer = [
      ev('jun30', (tz) => [occ('2026-06-30', null, null, tz)]),
      ev('jul1', (tz) => [occ('2026-07-01', '10:00', null, tz)]),
    ];
    expect(ids(run(summer, { kind: 'today' }, '2026-06-30T23:30:00Z'))).toEqual(['jul1']);
  });
});

describe('filterEvents — Azores near midnight', () => {
  // Sat 14 Nov 2026, 22:00 UTC = 22:00 Lisbon = 21:00 Azores.
  const NOW = '2026-11-14T22:00:00Z';
  const azores = [
    ev('acores-2330', (tz) => [occ('2026-11-14', '23:30', null, tz)], { tz: 'Atlantic/Azores' }),
  ];

  it('an Azores event at 23:30 local (00:30 UTC next day) counts as "today" by its local date', () => {
    expect(azores[0]?.occurrences[0]?.startsAt).toBe('2026-11-15T00:30:00Z');
    expect(ids(run(azores, { kind: 'today' }, NOW))).toEqual(['acores-2330']);
  });

  it('…and not as "tomorrow", even though in Lisbon time it is already Sunday', () => {
    expect(ids(run(azores, { kind: 'tomorrow' }, NOW))).toEqual([]);
  });

  it('…and is listed for the picked day 14, not 15', () => {
    expect(ids(run(azores, { kind: 'day', date: '2026-11-14' }, NOW))).toEqual(['acores-2330']);
    expect(ids(run(azores, { kind: 'day', date: '2026-11-15' }, NOW))).toEqual([]);
  });

  it('once Lisbon has moved on to the 15th, it is no longer "today" but is still upcoming', () => {
    const later = '2026-11-15T00:10:00Z'; // Lisbon 00:10 on 15th, Azores 23:10 on 14th
    expect(ids(run(azores, { kind: 'today' }, later))).toEqual([]);
    expect(ids(run(azores, { kind: 'upcoming' }, later))).toEqual(['acores-2330']);
  });

  it('is dropped once it has ended, in UTC terms', () => {
    // ends at local midnight = 01:00 UTC on the 15th
    expect(ids(run(azores, { kind: 'upcoming' }, '2026-11-15T01:00:00Z'))).toEqual([]);
  });
});

describe('filterEvents — "Fim de semana"', () => {
  const events = [
    ev('fri', (tz) => [occ('2026-11-13', '18:00', null, tz)]),
    ev('sat', (tz) => [occ('2026-11-14', '15:00', null, tz)]),
    ev('sun', (tz) => [occ('2026-11-15', '11:00', '13:00', tz)]),
    ev('mon', (tz) => [occ('2026-11-16', '18:00', null, tz)]),
    ev('next-sat', (tz) => [occ('2026-11-21', '15:00', null, tz)]),
  ];

  it('on a Wednesday, picks the coming Saturday and Sunday', () => {
    expect(ids(run(events, { kind: 'weekend' }, WED))).toEqual(['sat', 'sun']);
  });

  it('on a Saturday, picks the current weekend', () => {
    expect(ids(run(events, { kind: 'weekend' }, '2026-11-14T09:00:00Z'))).toEqual(['sat', 'sun']);
  });

  it('on a Sunday, picks only what is left of that Sunday', () => {
    expect(ids(run(events, { kind: 'weekend' }, '2026-11-15T09:00:00Z'))).toEqual(['sun']);
  });

  it('on a Sunday evening, after everything ended, is empty (does not jump to next weekend)', () => {
    expect(ids(run(events, { kind: 'weekend' }, '2026-11-15T20:00:00Z'))).toEqual([]);
  });
});

describe('filterEvents — "7 dias"', () => {
  it('includes now → now + 7 days', () => {
    const events = [
      ev('in6', (tz) => [occ('2026-11-17', '10:00', null, tz)]),
      ev('in7-before', (tz) => [occ('2026-11-18', '09:59', null, tz)]),
      ev('in7-after', (tz) => [occ('2026-11-18', '10:01', null, tz)]),
    ];
    expect(ids(run(events, { kind: 'next7' }, WED))).toEqual(['in6', 'in7-before']);
  });

  it('counts 7 civil days across the October DST change', () => {
    // Thu 22 Oct 2026 12:00 Lisbon (UTC+1) → Thu 29 Oct 12:00 Lisbon (UTC+0).
    const now = '2026-10-22T11:00:00Z';
    const events = [
      ev('thu-1130', (tz) => [occ('2026-10-29', '11:30', '11:45', tz)]),
      ev('thu-1230', (tz) => [occ('2026-10-29', '12:30', null, tz)]),
    ];
    // A naive now + 168h would end at 11:00 UTC and drop the 11:30 event.
    expect(ids(run(events, { kind: 'next7' }, now))).toEqual(['thu-1130']);
  });
});

describe('filterEvents — "Escolher dia" and DST days', () => {
  it('matches a picked day', () => {
    const events = [
      ev('a', (tz) => [occ('2026-11-20', '10:00', null, tz)]),
      ev('b', (tz) => [occ('2026-11-21', '10:00', null, tz)]),
    ];
    expect(ids(run(events, { kind: 'day', date: '2026-11-21' }, WED))).toEqual(['b']);
  });

  it('matches all-day occurrences on the March DST Sunday', () => {
    const events = [ev('dst', (tz) => [occ('2026-03-29', null, null, tz)])];
    expect(ids(run(events, { kind: 'day', date: '2026-03-29' }, '2026-03-20T10:00:00Z'))).toEqual([
      'dst',
    ]);
    expect(ids(run(events, { kind: 'day', date: '2026-03-30' }, '2026-03-20T10:00:00Z'))).toEqual(
      [],
    );
  });

  it('matches a late event on the October DST Sunday only on that day', () => {
    const events = [ev('dst', (tz) => [occ('2026-10-25', '23:30', null, tz)])];
    const now = '2026-10-20T10:00:00Z';
    expect(ids(run(events, { kind: 'day', date: '2026-10-25' }, now))).toEqual(['dst']);
    expect(ids(run(events, { kind: 'day', date: '2026-10-26' }, now))).toEqual([]);
  });

  it('a picked day in the past returns nothing', () => {
    const events = [ev('a', (tz) => [occ('2026-11-10', '10:00', null, tz)])];
    expect(ids(run(events, { kind: 'day', date: '2026-11-10' }, WED))).toEqual([]);
  });
});

describe('filterEvents — multiple dates: highlight and others', () => {
  it('highlights the next occurrence in range and lists the out-of-range future ones', () => {
    const events = [
      ev('weekly', (tz) => [
        occ('2026-11-04', '18:00', null, tz), // past
        occ('2026-11-11', '18:00', null, tz), // today
        occ('2026-11-14', '18:00', null, tz), // weekend
        occ('2026-11-15', '18:00', null, tz), // weekend
        occ('2026-11-25', '18:00', null, tz),
      ]),
    ];
    const [r] = run(events, { kind: 'weekend' }, WED);
    expect(r?.highlight.localDate).toBe('2026-11-14');
    expect(r?.inRange.map((o) => o.localDate)).toEqual(['2026-11-14', '2026-11-15']);
    expect(r?.others.map((o) => o.localDate)).toEqual(['2026-11-11', '2026-11-25']);
  });
});

describe('filterEvents — type filter', () => {
  const events = [
    ev('demo', (tz) => [occ('2026-11-20', '10:00', null, tz)], { type: 'demonstration' }),
    ev('rally', (tz) => [occ('2026-11-20', '11:00', null, tz)], { type: 'rally' }),
    ev('assembly', (tz) => [occ('2026-11-20', '12:00', null, tz)], { type: 'assembly' }),
  ];

  it('empty type list means all types', () => {
    expect(ids(run(events, { kind: 'upcoming' }, WED))).toEqual(['demo', 'rally', 'assembly']);
  });

  it('keeps only selected types (multi-select)', () => {
    expect(ids(run(events, { kind: 'upcoming' }, WED, ['rally', 'assembly']))).toEqual([
      'rally',
      'assembly',
    ]);
  });
});

describe('countByDay', () => {
  it('counts distinct events per Lisbon-calendar day, skipping cancelled and ended ones', () => {
    const events = [
      ev('a', (tz) => [
        occ('2026-11-11', '08:00', '09:00', tz),
        occ('2026-11-14', '10:00', null, tz),
      ]),
      ev('b', (tz) => [occ('2026-11-14', '11:00', null, tz), occ('2026-11-14', '18:00', null, tz)]),
      ev('c', (tz) => [occ('2026-11-12', '18:00', null, tz, true)]),
      ev('d', (tz) => [occ('2026-11-14', '23:30', null, tz)], { tz: 'Atlantic/Azores' }),
      ev('night', (tz) => [occ('2026-11-12', '22:00', '02:00', tz)]),
    ];
    const days = countByDay(events, [], new Date(WED), 5);
    expect(days).toEqual([
      { date: '2026-11-11', count: 0 },
      { date: '2026-11-12', count: 1 },
      { date: '2026-11-13', count: 1 },
      { date: '2026-11-14', count: 3 },
      { date: '2026-11-15', count: 0 },
    ]);
  });

  it('respects the type filter', () => {
    const events = [
      ev('a', (tz) => [occ('2026-11-12', '10:00', null, tz)], { type: 'rally' }),
      ev('b', (tz) => [occ('2026-11-12', '10:00', null, tz)], { type: 'other' }),
    ];
    expect(countByDay(events, ['rally'], new Date(WED), 2)).toEqual([
      { date: '2026-11-11', count: 0 },
      { date: '2026-11-12', count: 1 },
    ]);
  });
});
