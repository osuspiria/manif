import { describe, expect, it } from 'vitest';
import list from '../../data/geo/municipalities.json';
import geo from '../../data/geo/municipalities.geo.json';
import { TIME_ZONES } from '../../src/shared/dates';

describe('generated municipalities data', () => {
  it('has the 308 municipalities (278 mainland + 11 Madeira + 19 Azores)', () => {
    expect(list).toHaveLength(308);
    const byTz = (tz: string) => list.filter((m) => m.tz === tz).length;
    expect(byTz('Europe/Lisbon')).toBe(278);
    expect(byTz('Atlantic/Madeira')).toBe(11);
    expect(byTz('Atlantic/Azores')).toBe(19);
  });

  it('has 18 districts plus the two autonomous regions', () => {
    expect(new Set(list.map((m) => m.district)).size).toBe(20);
  });

  it('uses only known time zones and unique 4-digit codes', () => {
    for (const m of list) {
      expect(TIME_ZONES).toContain(m.tz);
      expect(m.code).toMatch(/^\d{4}$/);
    }
    expect(new Set(list.map((m) => m.code)).size).toBe(308);
  });

  it('the GeoJSON and the list describe the same municipalities', () => {
    const geoCodes = geo.features.map((f) => f.properties.code).sort();
    expect(geoCodes).toEqual(list.map((m) => m.code).sort());
  });
});
