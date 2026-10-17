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
