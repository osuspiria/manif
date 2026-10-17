import { EVENT_TYPES, type EventType } from '../../config/event-types';
import { SHAPE_PATHS } from '../../map/shapes';

/** Type marker as inline SVG: same shape and colour as on the map. Decorative. */
export function TypeIcon({ type, size = 20 }: { type: EventType; size?: number }) {
  const cfg = EVENT_TYPES[type];
  return (
    <svg
      class="type-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={SHAPE_PATHS[cfg.shape]}
        fill={cfg.color}
        stroke="#fff"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}
