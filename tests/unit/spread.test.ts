import { describe, expect, it } from 'vitest';
import { spreadPoints, type ScreenPoint } from '../../src/map/spread';

function minGap(points: ScreenPoint[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
    }
  }
  return min;
}

describe('spreadPoints', () => {
  it('leaves points that do not overlap where they are', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(spreadPoints(pts, 40)).toEqual(pts);
  });

  it('spreads points at the same spot so they no longer overlap', () => {
    const pts = Array.from({ length: 2 }, () => ({ x: 50, y: 50 }));
    const out = spreadPoints(pts, 40);
    expect(minGap(out)).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it('keeps a group centred on its centroid', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 15, y: 20 },
    ];
    const out = spreadPoints(pts, 40);
    const cx = out.reduce((s, p) => s + p.x, 0) / out.length;
    const cy = out.reduce((s, p) => s + p.y, 0) / out.length;
    expect(cx).toBeCloseTo(15);
    expect(cy).toBeCloseTo(40 / 3);
    expect(minGap(out)).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it('handles large groups (spiral) without overlaps', () => {
    for (const n of [7, 8, 20, 50]) {
      const pts = Array.from({ length: n }, (_, i) => ({ x: i % 3, y: i % 5 }));
      expect(minGap(spreadPoints(pts, 30))).toBeGreaterThanOrEqual(30 - 1e-9);
    }
  });

  it('groups chains of neighbours and leaves distant points alone', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 500, y: 500 },
    ];
    const out = spreadPoints(pts, 40);
    expect(out[3]).toEqual({ x: 500, y: 500 });
    expect(minGap(out.slice(0, 3))).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it('separates a spread group from a neighbour it lands on', () => {
    // Four pins at one spot spread into a ring that reaches the fifth pin.
    const pts = [...Array.from({ length: 4 }, () => ({ x: 0, y: 0 })), { x: 45, y: 0 }];
    expect(minGap(spreadPoints(pts, 40))).toBeGreaterThanOrEqual(40 - 1e-6);
  });

  it('leaves no overlaps in a dense, uneven area', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({
      x: (i * 37) % 120,
      y: (i * 53) % 90,
    }));
    expect(minGap(spreadPoints(pts, 30))).toBeGreaterThanOrEqual(30 - 1e-6);
  });

  it('is deterministic', () => {
    const pts = Array.from({ length: 5 }, () => ({ x: 1, y: 1 }));
    expect(spreadPoints(pts, 40)).toEqual(spreadPoints(pts, 40));
  });
});
