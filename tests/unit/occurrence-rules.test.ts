import { describe, expect, it } from 'vitest';
import { addMonths, todayIn } from '../../src/shared/dates';
import { checkOccurrences, weeklyRepeat } from '../../src/shared/occurrence-rules';

// Wednesday 11 Nov 2026, 10:00 Lisbon (= UTC).
const NOW = new Date('2026-11-11T10:00:00Z');
const o = (
  localDate: string,
  startTime: string | null = '18:00',
  endTime: string | null = null,
) => ({
  localDate,
  startTime,
  endTime,
});

describe('date helpers', () => {
  it('todayIn uses the event time zone', () => {
    // 00:30 UTC on 15 Nov: Lisbon is already the 15th, the Azores still the 14th.
    const t = new Date('2026-11-15T00:30:00Z');
    expect(todayIn('Europe/Lisbon', t)).toBe('2026-11-15');
    expect(todayIn('Atlantic/Azores', t)).toBe('2026-11-14');
  });

  it('addMonths clamps to the end of the month', () => {
    expect(addMonths('2026-11-11', 12)).toBe('2027-11-11');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });
});

describe('checkOccurrences', () => {
  it('accepts future occurrences', () => {
    expect(checkOccurrences([o('2026-11-12'), o('2026-11-19')], 'Europe/Lisbon', NOW)).toEqual([]);
  });

  it('accepts an occurrence that already started but has not ended', () => {
    expect(checkOccurrences([o('2026-11-11', '09:00', '12:00')], 'Europe/Lisbon', NOW)).toEqual([]);
  });

  it('rejects an occurrence that has ended', () => {
    expect(checkOccurrences([o('2026-11-12'), o('2026-11-10')], 'Europe/Lisbon', NOW)).toEqual([
      { path: ['occurrences', 1, 'localDate'], code: 'occurrence_past' },
    ]);
  });

  it('rejects an occurrence more than 12 months ahead', () => {
    expect(checkOccurrences([o('2027-11-11')], 'Europe/Lisbon', NOW)).toEqual([]);
    expect(checkOccurrences([o('2027-11-12')], 'Europe/Lisbon', NOW)).toEqual([
      { path: ['occurrences', 0, 'localDate'], code: 'occurrence_too_far' },
    ]);
  });

  it('rejects duplicate date + start time', () => {
    expect(
      checkOccurrences(
        [o('2026-11-12'), o('2026-11-12', '20:00'), o('2026-11-12')],
        'Europe/Lisbon',
        NOW,
      ),
    ).toEqual([{ path: ['occurrences', 2, 'localDate'], code: 'occurrence_duplicate' }]);
  });

  it('can skip occurrences that are kept unchanged (e.g. past ones when editing)', () => {
    expect(
      checkOccurrences([o('2026-11-04'), o('2026-11-12')], 'Europe/Lisbon', NOW, (i) => i === 0),
    ).toEqual([]);
  });

  it('ignores malformed rows (the schema reports them)', () => {
    expect(
      checkOccurrences(
        [o(''), o('2026-11-12', '25:00'), o('2026-11-12', null, '20:00')],
        'Europe/Lisbon',
        NOW,
      ),
    ).toEqual([]);
  });

  it('uses the Azores clock for an Azores event near midnight', () => {
    // 23:30 Azores on the 10th ends at local midnight = 01:00 UTC on the 11th: already over.
    expect(
      checkOccurrences([o('2026-11-10', '23:30')], 'Atlantic/Azores', NOW).map((i) => i.code),
    ).toEqual(['occurrence_past']);
  });
});

describe('weeklyRepeat', () => {
  it('generates the following weekly dates up to and including the end date', () => {
    expect(weeklyRepeat('2026-11-12', '2026-12-03', 30)).toEqual([
      '2026-11-19',
      '2026-11-26',
      '2026-12-03',
    ]);
  });

  it('stops before the end date when the next week would pass it', () => {
    expect(weeklyRepeat('2026-11-12', '2026-11-25', 30)).toEqual(['2026-11-19']);
  });

  it('respects the maximum number of new rows', () => {
    expect(weeklyRepeat('2026-11-12', '2027-06-01', 2)).toEqual(['2026-11-19', '2026-11-26']);
  });

  it('returns nothing for an end date before the first week', () => {
    expect(weeklyRepeat('2026-11-12', '2026-11-12', 30)).toEqual([]);
    expect(weeklyRepeat('2026-11-12', '2026-11-01', 30)).toEqual([]);
  });

  it('crosses the October DST change without drifting', () => {
    expect(weeklyRepeat('2026-10-22', '2026-11-05', 30)).toEqual(['2026-10-29', '2026-11-05']);
  });
});
