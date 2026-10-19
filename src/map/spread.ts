/**
 * Moves overlapping pins apart in screen space. Pins closer than `minDist`
 * (directly, through a chain of neighbours, or once spread) form a group, laid out around
 * the group's centroid: a ring for small groups, a sunflower spiral for big
 * ones. Pure, so it can be tested without a map.
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_RING = 6;

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: readonly ScreenPoint[]): ScreenPoint {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function minGap(points: readonly ScreenPoint[]): number {
  let gap = Infinity;
  points.forEach((a, i) => {
    for (const b of points.slice(i + 1)) gap = Math.min(gap, distance(a, b));
  });
  return gap;
}

/** Offsets (relative to the centroid) for `n` pins at least `d` apart. */
function layout(n: number, d: number): ScreenPoint[] {
  if (n <= MAX_RING) {
    const r = d / (2 * Math.sin(Math.PI / n));
    // Start at the top; a pair sits side by side.
    const start = n === 2 ? 0 : -Math.PI / 2;
    return Array.from({ length: n }, (_, k) => {
      const a = start + (2 * Math.PI * k) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  // Vogel spiral on a unit scale, then scaled so the closest pair is `d` apart.
  const unit = Array.from({ length: n }, (_, k) => {
    const r = Math.sqrt(k + 0.5);
    const a = k * GOLDEN_ANGLE;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  const scale = d / minGap(unit);
  const c = centroid(unit);
  return unit.map((p) => ({ x: (p.x - c.x) * scale, y: (p.y - c.y) * scale }));
}

/** Pins laid out exactly `minDist` apart must not count as overlapping through rounding. */
const EPSILON = 1e-6;

/**
 * Groups only ever grow: whenever two pins overlap, their groups merge and the
 * merged group is laid out again around the centroid of its original points.
 * A laid-out group has no overlaps inside it, so this ends after at most one
 * merge per pin.
 */
export function spreadPoints(points: readonly ScreenPoint[], minDist: number): ScreenPoint[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  const groupOf = points.map((_, i) => [i]);
  for (let pass = 0; pass < points.length; pass++) {
    const merged = new Set<number[]>();
    out.forEach((a, i) => {
      out.forEach((b, j) => {
        const gi = groupOf[i];
        const gj = groupOf[j];
        if (j <= i || !gi || !gj || gi === gj || distance(a, b) >= minDist - EPSILON) return;
        const group = gi.concat(gj).sort((x, y) => x - y);
        for (const k of group) groupOf[k] = group;
        merged.delete(gi);
        merged.delete(gj);
        merged.add(group);
      });
    });
    if (merged.size === 0) break;
    for (const members of merged) {
      const c = centroid(members.map((i) => points[i] ?? { x: 0, y: 0 }));
      layout(members.length, minDist).forEach((o, k) => {
        const i = members[k];
        if (i !== undefined) out[i] = { x: c.x + o.x, y: c.y + o.y };
      });
    }
  }
  return out;
}
