/**
 * Reverse geocoding against the simplified CAOP municipalities (local data, no
 * external services). Platform-agnostic: receives the FeatureCollection.
 */
import type { Tz } from '../../shared/dates';
import type { ReverseResult } from '../../shared/schemas';

type Position = [number, number];
type Ring = Position[];
type PolygonCoords = Ring[];

export interface MunicipalityFeature {
  type: 'Feature';
  properties: {
    code: string;
    name: string;
    district: string;
    island: string | null;
    tz: Tz;
  };
  geometry:
    | { type: 'Polygon'; coordinates: PolygonCoords }
    | { type: 'MultiPolygon'; coordinates: PolygonCoords[] };
}

export interface MunicipalityCollection {
  type: 'FeatureCollection';
  features: MunicipalityFeature[];
}

export interface GeoService {
  /** null when the point is neither in Portugal nor within `snapMeters` of it. */
  reverse(lat: number, lng: number): ReverseResult | null;
}

/** [minLng, minLat, maxLng, maxLat] */
type Bbox = [number, number, number, number];

interface Indexed {
  feature: MunicipalityFeature;
  polygons: PolygonCoords[];
  bbox: Bbox;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;

function computeBbox(polygons: PolygonCoords[]): Bbox {
  const b: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygons) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  return b;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, poly: PolygonCoords): boolean {
  const [outer, ...holes] = poly;
  if (!outer || !inRing(x, y, outer)) return false;
  return !holes.some((h) => inRing(x, y, h));
}

/** Squared distance (m²) from a point to a segment, on a local equirectangular plane. */
function segmentDist2(px: number, py: number, a: Position, b: Position, kx: number): number {
  const ax = (a[0] - px) * kx;
  const ay = (a[1] - py) * M_PER_DEG_LAT;
  const dx = (b[0] - px) * kx - ax;
  const dy = (b[1] - py) * M_PER_DEG_LAT - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return cx * cx + cy * cy;
}

function toResult(f: MunicipalityFeature): ReverseResult {
  const p = f.properties;
  return {
    municipality: p.name,
    municipalityCode: p.code,
    district: p.district,
    island: p.island,
    tz: p.tz,
  };
}

export function createGeoService(fc: MunicipalityCollection, snapMeters: number): GeoService {
  const index: Indexed[] = fc.features.map((feature) => {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return { feature, polygons, bbox: computeBbox(polygons) };
  });

  function containing(lat: number, lng: number): Indexed | undefined {
    return index.find(({ bbox: [w, s, e, n], polygons }) => {
      if (lng < w || lng > e || lat < s || lat > n) return false;
      return polygons.some((p) => inPolygon(lng, lat, p));
    });
  }

  /** Coastline / simplification gaps: the nearest municipality within snapMeters. */
  function nearest(lat: number, lng: number): Indexed | undefined {
    const kx = M_PER_DEG_LNG_EQUATOR * Math.cos((lat * Math.PI) / 180);
    const padLat = snapMeters / M_PER_DEG_LAT;
    const padLng = snapMeters / kx;
    let best: Indexed | undefined;
    let bestD2 = snapMeters * snapMeters;
    for (const m of index) {
      const [w, s, e, n] = m.bbox;
      if (lng < w - padLng || lng > e + padLng || lat < s - padLat || lat > n + padLat) continue;
      for (const ring of m.polygons.flat()) {
        for (let i = 1; i < ring.length; i++) {
          const d2 = segmentDist2(lng, lat, ring[i - 1]!, ring[i]!, kx);
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = m;
          }
        }
      }
    }
    return best;
  }

  return {
    reverse(lat, lng) {
      const m = containing(lat, lng) ?? nearest(lat, lng);
      return m ? toResult(m.feature) : null;
    },
  };
}
