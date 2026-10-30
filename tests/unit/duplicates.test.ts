import { describe, expect, it } from 'vitest';
import {
  distanceMeters,
  findPossibleDuplicates,
  type DuplicateSource,
} from '../../src/shared/duplicates';

// Praça da Liberdade, Porto.
const PORTO = { lat: 41.1468, lng: -8.6109 };
// ~110 m north of it (0.001° of latitude).
const NEAR = { lat: 41.1478, lng: -8.6109 };
// ~1.1 km north.
const FAR = { lat: 41.1568, lng: -8.6109 };

function ev(
  id: string,
  at: { lat: number; lng: number },
  dates: string[],
  opts: { cancelled?: string[]; ongoingSince?: string } = {},
): DuplicateSource {
  return {
    id,
    ...at,
    ongoingSince: opts.ongoingSince ?? null,
    occurrences: dates.map((localDate) => ({
      localDate,
      cancelled: opts.cancelled?.includes(localDate) ?? false,
    })),
  };
}

const ids = (r: { event: { id: string } }[]) => r.map((x) => x.event.id);

describe('distanceMeters', () => {
  it('measures 0.001° of latitude as ~111 m', () => {
    expect(distanceMeters(PORTO, NEAR)).toBeGreaterThan(105);
    expect(distanceMeters(PORTO, NEAR)).toBeLessThan(117);
  });
  it('is zero for the same point', () => {
    expect(distanceMeters(PORTO, PORTO)).toBe(0);
  });
});

describe('findPossibleDuplicates', () => {
  const candidate = { ...PORTO, dates: ['2026-11-14', '2026-11-21'] };

  it('finds a nearby event on a shared date, with the shared dates', () => {
    const r = findPossibleDuplicates(candidate, [ev('a', NEAR, ['2026-11-21', '2026-11-28'])]);
    expect(ids(r)).toEqual(['a']);
    expect(r[0]?.dates).toEqual(['2026-11-21']);
  });

  it('ignores events that are far away or on other dates', () => {
    const r = findPossibleDuplicates(candidate, [
      ev('far', FAR, ['2026-11-14']),
      ev('other-day', NEAR, ['2026-11-15']),
    ]);
    expect(r).toEqual([]);
  });

  it('ignores a cancelled occurrence on the shared date', () => {
    const r = findPossibleDuplicates(candidate, [
      ev('a', NEAR, ['2026-11-14'], { cancelled: ['2026-11-14'] }),
    ]);
    expect(r).toEqual([]);
  });

  it('matches an ongoing event on dates from its start', () => {
    const before = findPossibleDuplicates(candidate, [
      ev('camp', NEAR, [], { ongoingSince: '2026-11-22' }),
    ]);
    expect(before).toEqual([]);
    const r = findPossibleDuplicates(candidate, [
      ev('camp', NEAR, [], { ongoingSince: '2026-11-20' }),
    ]);
    expect(r[0]?.dates).toEqual(['2026-11-21']);
  });

  it('leaves out the event itself, sorts by distance and caps the list', () => {
    const events = [
      ev('self', PORTO, ['2026-11-14']),
      ev('n3', { lat: 41.1488, lng: -8.6109 }, ['2026-11-14']),
      ev('n1', { lat: 41.1469, lng: -8.6109 }, ['2026-11-14']),
      ev('n2', NEAR, ['2026-11-14']),
      ev('n4', { lat: 41.1493, lng: -8.6109 }, ['2026-11-14']),
    ];
    expect(ids(findPossibleDuplicates(candidate, events, 'self'))).toEqual(['n1', 'n2', 'n3']);
  });

  it('finds nothing for a candidate without dates', () => {
    expect(
      findPossibleDuplicates({ ...PORTO, dates: [] }, [ev('a', NEAR, ['2026-11-14'])]),
    ).toEqual([]);
  });
});
