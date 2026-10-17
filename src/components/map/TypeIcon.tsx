import { EVENT_TYPES, type EventType } from '../../config/event-types';
import { PICTOGRAMS, PICTOGRAM_SCALE, PICTOGRAM_STROKE } from '../../map/pictograms';

const PIN = 40;
const ICON = PIN * PICTOGRAM_SCALE;

/** Type marker as inline SVG: the map pin without its tip (black square, white pictogram). Decorative. */
export function TypeIcon({ type, size = 20 }: { type: EventType; size?: number }) {
  const pic = PICTOGRAMS[EVENT_TYPES[type].icon];
  return (
    <svg
      class="type-icon"
      viewBox={`0 0 ${PIN} ${PIN}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect width={PIN} height={PIN} fill="#000" />
      <rect
        x="2"
        y="2"
        width={PIN - 4}
        height={PIN - 4}
        fill="#000"
        stroke="#fff"
        stroke-width="2"
      />
      <path
        d={pic.d}
        transform={`translate(${(PIN - ICON) / 2} ${(PIN - ICON) / 2}) scale(${ICON / 24})`}
        fill={pic.fill ? '#fff' : 'none'}
        stroke={pic.fill ? 'none' : '#fff'}
        stroke-width={PICTOGRAM_STROKE}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
