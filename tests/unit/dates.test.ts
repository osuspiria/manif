import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  formatDayChip,
  lisbonToday,
  occurrenceLocalDates,
  toUtcRange,
  weekendDates,
} from '../../src/shared/dates';

describe('toUtcRange', () => {
  it('converts a simple continental occurrence (winter, UTC+0)', () => {
    expect(
      toUtcRange(
        { localDate: '2026-11-25', startTime: '14:00', endTime: '17:00' },
        'Europe/Lisbon',
      ),
    ).toEqual({ startsAt: '2026-11-25T14:00:00Z', endsAt: '2026-11-25T17:00:00Z' });
  });

  it('converts a continental occurrence in summer (UTC+1)', () => {
    expect(
      toUtcRange(
        { localDate: '2026-07-01', startTime: '10:00', endTime: '12:00' },
        'Europe/Lisbon',
      ),
    ).toEqual({ startsAt: '2026-07-01T09:00:00Z', endsAt: '2026-07-01T11:00:00Z' });
  });

  it('treats Madeira like Lisbon', () => {
    expect(
      toUtcRange({ localDate: '2026-07-01', startTime: '10:00', endTime: null }, 'Atlantic/Madeira')
        .startsAt,
    ).toBe('2026-07-01T09:00:00Z');
  });

  it('ends at the end of the local day when there is no end time', () => {
    expect(
      toUtcRange({ localDate: '2026-11-25', startTime: '14:00', endTime: null }, 'Europe/Lisbon'),
    ).toEqual({ startsAt: '2026-11-25T14:00:00Z', endsAt: '2026-11-26T00:00:00Z' });
  });

  it('handles an all-day occurrence (no start time)', () => {
    expect(
      toUtcRange({ localDate: '2026-07-01', startTime: null, endTime: null }, 'Europe/Lisbon'),
    ).toEqual({ startsAt: '2026-06-30T23:00:00Z', endsAt: '2026-07-01T23:00:00Z' });
  });

  it('rolls the end over to the next day when the end time is before the start time', () => {
    expect(
      toUtcRange(
        { localDate: '2026-11-14', startTime: '22:00', endTime: '02:00' },
        'Europe/Lisbon',
      ),
    ).toEqual({ startsAt: '2026-11-14T22:00:00Z', endsAt: '2026-11-15T02:00:00Z' });
  });

  describe('Azores (UTC−1 in winter)', () => {
    it('puts a 23:30 occurrence on the next UTC day', () => {
      expect(
        toUtcRange(
          { localDate: '2026-11-14', startTime: '23:30', endTime: null },
          'Atlantic/Azores',
        ),
      ).toEqual({ startsAt: '2026-11-15T00:30:00Z', endsAt: '2026-11-15T01:00:00Z' });
    });

    it('starts an all-day occurrence at local midnight', () => {
      expect(
        toUtcRange({ localDate: '2026-11-14', startTime: null, endTime: null }, 'Atlantic/Azores'),
      ).toEqual({ startsAt: '2026-11-14T01:00:00Z', endsAt: '2026-11-15T01:00:00Z' });
    });
  });

  describe('DST spring forward — last Sunday of March (2026-03-29)', () => {
    it('Lisbon: a time before the gap stays in UTC+0', () => {
      expect(
        toUtcRange({ localDate: '2026-03-29', startTime: '00:30', endTime: null }, 'Europe/Lisbon')
          .startsAt,
      ).toBe('2026-03-29T00:30:00Z');
    });

    it('Lisbon: a non-existent time (01:30) is shifted forward', () => {
      expect(
        toUtcRange({ localDate: '2026-03-29', startTime: '01:30', endTime: null }, 'Europe/Lisbon')
          .startsAt,
      ).toBe('2026-03-29T01:30:00Z');
    });

    it('Lisbon: a time after the gap is UTC+1', () => {
      expect(
        toUtcRange({ localDate: '2026-03-29', startTime: '03:00', endTime: null }, 'Europe/Lisbon')
          .startsAt,
      ).toBe('2026-03-29T02:00:00Z');
    });

    it('Lisbon: the all-day range is 23 hours long', () => {
      expect(
        toUtcRange({ localDate: '2026-03-29', startTime: null, endTime: null }, 'Europe/Lisbon'),
      ).toEqual({ startsAt: '2026-03-29T00:00:00Z', endsAt: '2026-03-29T23:00:00Z' });
    });

    it('Azores: midnight does not exist, so the day starts at 01:00 local', () => {
      expect(
        toUtcRange({ localDate: '2026-03-29', startTime: null, endTime: null }, 'Atlantic/Azores'),
      ).toEqual({ startsAt: '2026-03-29T01:00:00Z', endsAt: '2026-03-30T00:00:00Z' });
    });
  });

  describe('DST fall back — last Sunday of October (2026-10-25)', () => {
    it('Lisbon: an ambiguous time (01:30) resolves to the earlier instant', () => {
      expect(
        toUtcRange({ localDate: '2026-10-25', startTime: '01:30', endTime: null }, 'Europe/Lisbon')
          .startsAt,
      ).toBe('2026-10-25T00:30:00Z');
    });

    it('Lisbon: the all-day range is 25 hours long', () => {
      expect(
        toUtcRange({ localDate: '2026-10-25', startTime: null, endTime: null }, 'Europe/Lisbon'),
      ).toEqual({ startsAt: '2026-10-24T23:00:00Z', endsAt: '2026-10-26T00:00:00Z' });
    });

    it('Lisbon: an evening occurrence after the change is UTC+0', () => {
      expect(
        toUtcRange(
          { localDate: '2026-10-25', startTime: '18:00', endTime: '20:00' },
          'Europe/Lisbon',
        ),
      ).toEqual({ startsAt: '2026-10-25T18:00:00Z', endsAt: '2026-10-25T20:00:00Z' });
    });

    it('Azores: the all-day range is 25 hours long', () => {
      expect(
        toUtcRange({ localDate: '2026-10-25', startTime: null, endTime: null }, 'Atlantic/Azores'),
      ).toEqual({ startsAt: '2026-10-25T00:00:00Z', endsAt: '2026-10-26T01:00:00Z' });
    });
  });
});

describe('occurrenceLocalDates', () => {
  it('returns the single local date for a same-day occurrence', () => {
    expect(
      occurrenceLocalDates({ localDate: '2026-11-14', startTime: '10:00', endTime: '12:00' }),
    ).toEqual(['2026-11-14']);
  });

  it('returns the single local date for an all-day occurrence', () => {
    expect(
      occurrenceLocalDates({ localDate: '2026-11-14', startTime: null, endTime: null }),
    ).toEqual(['2026-11-14']);
  });

  it('includes the next day when the occurrence crosses midnight', () => {
    expect(
      occurrenceLocalDates({ localDate: '2026-11-14', startTime: '22:00', endTime: '02:00' }),
    ).toEqual(['2026-11-14', '2026-11-15']);
  });

  it('does not include the next day when it ends exactly at midnight', () => {
    expect(
      occurrenceLocalDates({ localDate: '2026-11-14', startTime: '22:00', endTime: '00:00' }),
    ).toEqual(['2026-11-14']);
  });
});

describe('calendar helpers (Europe/Lisbon)', () => {
  it('lisbonToday uses the Lisbon civil date, not UTC', () => {
    // 23:30 UTC on 30 June is already 1 July in Lisbon (UTC+1).
    expect(lisbonToday(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    // In winter Lisbon = UTC.
    expect(lisbonToday(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });

  it('addDays crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('dayOfWeek is ISO (Mon=1 … Sun=7)', () => {
    expect(dayOfWeek('2026-11-14')).toBe(6);
    expect(dayOfWeek('2026-11-15')).toBe(7);
    expect(dayOfWeek('2026-11-16')).toBe(1);
  });

  it('weekendDates on a weekday returns the next Saturday and Sunday', () => {
    expect(weekendDates(new Date('2026-11-11T10:00:00Z'))).toEqual(['2026-11-14', '2026-11-15']);
  });

  it('weekendDates on a Saturday returns the current weekend', () => {
    expect(weekendDates(new Date('2026-11-14T10:00:00Z'))).toEqual(['2026-11-14', '2026-11-15']);
  });

  it('weekendDates on a Sunday returns only that Sunday', () => {
    expect(weekendDates(new Date('2026-11-15T10:00:00Z'))).toEqual(['2026-11-15']);
  });

  it('weekendDates on a Friday late at night (Lisbon) still points to the next day', () => {
    // 23:30 UTC on Fri 3 July = 00:30 Sat 4 July in Lisbon.
    expect(weekendDates(new Date('2026-07-03T23:30:00Z'))).toEqual(['2026-07-04', '2026-07-05']);
  });

  it('formatDayChip gives a short pt-PT weekday and day number', () => {
    expect(formatDayChip('2026-10-24')).toEqual({ weekday: 'sáb', day: '24' });
    expect(formatDayChip('2026-10-26')).toEqual({ weekday: 'seg', day: '26' });
  });
});
