import type { MarkerShape } from '../config/event-types';

/** Marker shapes as SVG paths in a 24×24 box. Shared by the map (canvas) and the DOM (SVG). */
export const SHAPE_PATHS: Record<MarkerShape, string> = {
  circle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z',
  square: 'M4 4h16v16H4Z',
  triangle: 'M12 2.5L22 20.5H2Z',
  diamond: 'M12 1.5L22.5 12L12 22.5L1.5 12Z',
  hexagon: 'M7 3h10l5 9l-5 9H7l-5-9Z',
};
