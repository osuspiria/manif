/** Framing shortcuts (SPEC §4.1). Bounds: [[west, south], [east, north]]. */
export type RegionKey = 'mainland' | 'madeira' | 'azores';

export const REGIONS: Record<RegionKey, [[number, number], [number, number]]> = {
  mainland: [
    [-9.6, 36.9],
    [-6.15, 42.2],
  ],
  madeira: [
    [-17.3, 32.6],
    [-16.25, 33.15],
  ],
  azores: [
    [-31.3, 36.9],
    [-24.95, 39.8],
  ],
};

/**
 * Panning limit: mainland, Madeira (incl. Selvagens) and the Azores. The east
 * and north edges match the tiles extract (data/geo/pt-region.geojson), so the
 * edge of the extract is never on screen; west and south are sea, and the
 * style background is sea-coloured.
 */
export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-34, 28],
  [-5, 43.5],
];
