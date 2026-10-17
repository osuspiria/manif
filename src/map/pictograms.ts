/**
 * Event-type pictograms as SVG paths in a 24×24 box, drawn white on the square
 * pin. Shared by the map (canvas) and the DOM (SVG). Stroked unless `fill`.
 */
export const PICTOGRAM_NAMES = ['megaphone', 'flame', 'flag', 'people', 'tent', 'dots'] as const;
export type PictogramName = (typeof PICTOGRAM_NAMES)[number];

export interface Pictogram {
  d: string;
  fill?: boolean;
}

const dot = (x: number) => `M${x - 1.5} 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z`;

export const PICTOGRAMS: Record<PictogramName, Pictogram> = {
  megaphone: { d: 'M4 10v4h3l7 4V6L7 10Z M17.5 9.5a3.5 3.5 0 0 1 0 5' },
  flame: {
    d: 'M12 3c.5 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5.5 1.2 1 2 2.2 2 3.5 1.5-2 1.5-4.5 1-8Z',
  },
  flag: { d: 'M6 21V3 M6 4h11l-2.5 4 2.5 4H6' },
  people: {
    d: 'M9 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5Z M15.5 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5Z M3.5 19c0-3 2.4-5.5 5.5-5.5s5.5 2.5 5.5 5.5 M14 13.7c.5-.1 1-.2 1.5-.2 2.8 0 5 2.4 5 5.5',
  },
  tent: { d: 'M2.5 20h19 M12 4L3.5 20 M12 4l8.5 16 M12 11l-3.5 9 M12 11l3.5 9' },
  dots: { d: [6.5, 12, 17.5].map(dot).join(' '), fill: true },
};

export const PICTOGRAM_STROKE = 2.2;
/** Pictogram size as a fraction of the pin's side. */
export const PICTOGRAM_SCALE = 0.62;
