import { describe, expect, it } from 'vitest';
import {
  createGeoService,
  type MunicipalityCollection,
  type MunicipalityFeature,
} from '../../src/server/services/geo-service';

const square = (w: number, s: number, e: number, n: number): [number, number][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

function feature(name: string, geometry: MunicipalityFeature['geometry']): MunicipalityFeature {
  return {
    type: 'Feature',
    properties: { code: name, name, district: 'D', island: null, tz: 'Europe/Lisbon' },
    geometry,
  };
}

// "Donut" has a hole occupied by "Inner"; "Islands" is a MultiPolygon.
const fc: MunicipalityCollection = {
  type: 'FeatureCollection',
  features: [
    feature('Donut', {
      type: 'Polygon',
      coordinates: [square(0, 0, 1, 1), square(0.4, 0.4, 0.6, 0.6)],
    }),
    feature('Inner', { type: 'Polygon', coordinates: [square(0.4, 0.4, 0.6, 0.6)] }),
    feature('Islands', {
      type: 'MultiPolygon',
      coordinates: [[square(2, 0, 2.1, 0.1)], [square(3, 0, 3.1, 0.1)]],
    }),
  ],
};

const geo = createGeoService(fc, 1000);
const name = (lat: number, lng: number) => geo.reverse(lat, lng)?.municipality ?? null;

describe('createGeoService', () => {
  it('finds the polygon containing a point', () => {
    expect(name(0.2, 0.2)).toBe('Donut');
  });

  it('respects holes', () => {
    expect(name(0.5, 0.5)).toBe('Inner');
  });

  it('handles every part of a MultiPolygon', () => {
    expect(name(0.05, 2.05)).toBe('Islands');
    expect(name(0.05, 3.05)).toBe('Islands');
  });

  it('snaps a point just outside to the nearest municipality (within the limit)', () => {
    // ~555 m east of Donut's east edge (0.005° of longitude at the equator).
    expect(name(0.5, 1.005)).toBe('Donut');
  });

  it('returns null beyond the snap distance', () => {
    // ~2.2 km away.
    expect(name(0.5, 1.02)).toBeNull();
  });

  it('picks the closest when two are within range', () => {
    // Between Islands parts, closer to the second one.
    expect(name(0.05, 2.995)).toBe('Islands');
    expect(name(-0.004, 0.5)).toBe('Donut');
  });
});
