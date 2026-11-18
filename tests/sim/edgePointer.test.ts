/**
 * The arrow at the screen's edge for a mark that is out of view (owner, 18 Nov 2026). Screen geometry: 1280 × 800,
 * clear of a toolbar (top 70 px) and the controls (bottom 110 px).
 */
import { describe, expect, it } from 'vitest';
import { edgePointer, type Box } from '../../src/app/edgePointer';

const view = { w: 1280, h: 800 };
const safe: Box = { l: 0, t: 70, r: 1280, b: 690 };

describe('the arrow to a mark out of view', () => {
  it('a mark in view needs no arrow', () => {
    const p = edgePointer({ x: 0.2, y: 0.1, behind: false }, view, safe);
    expect(p.onScreen).toBe(true);
    expect(p.x).toBeCloseTo(768, 6);
    expect(p.y).toBeCloseTo(360, 6);
  });

  it('off to the right: on the right edge, pointing right; off the top: on the top edge, pointing up', () => {
    const r = edgePointer({ x: 3, y: 0, behind: false }, view, safe);
    expect(r.onScreen).toBe(false);
    expect(r.x).toBeCloseTo(1250, 6);
    expect(r.angleDeg).toBeGreaterThan(80);
    expect(r.angleDeg).toBeLessThan(100);
    const t = edgePointer({ x: 0, y: 4, behind: false }, view, safe);
    expect(t.y).toBeCloseTo(100, 6);
    expect(Math.abs(t.angleDeg)).toBeLessThan(10);
    // Always inside the clear part of the screen.
    for (const ndc of [{ x: -5, y: 2 }, { x: 7, y: -9 }, { x: -1.2, y: -1.3 }, { x: 1.01, y: 0.99 }]) {
      const p = edgePointer({ ...ndc, behind: false }, view, safe);
      expect(p.x).toBeGreaterThanOrEqual(30);
      expect(p.x).toBeLessThanOrEqual(1250);
      expect(p.y).toBeGreaterThanOrEqual(100);
      expect(p.y).toBeLessThanOrEqual(660);
    }
  });

  it('a mark behind the camera is never "in view": its arrow points the mirrored way, down for dead astern', () => {
    // Behind and (as projected) up and to the right: really down and to the left.
    const p = edgePointer({ x: 0.4, y: 0.3, behind: true }, view, safe);
    expect(p.onScreen).toBe(false);
    expect(p.x).toBeLessThan(640);
    expect(p.y).toBeGreaterThan(380);
    const astern = edgePointer({ x: 0, y: 0.05, behind: true }, view, safe);
    expect(astern.onScreen).toBe(false);
    expect(astern.y).toBeCloseTo(660, 6);
    expect(Math.abs(Math.abs(astern.angleDeg) - 180)).toBeLessThan(10);
  });

  it('keeps off the panels: slid along the edge to the nearer clear side', () => {
    const instruments: Box = { l: 12, t: 12, r: 312, b: 520 };
    const minimap: Box = { l: 1080, t: 530, r: 1268, b: 770 };
    // Off to the left at the instruments' height: moved below them.
    const p = edgePointer({ x: -4, y: 0.2, behind: false }, view, safe, [instruments, minimap]);
    expect(p.x).toBeCloseTo(30, 6);
    expect(p.y).toBeGreaterThanOrEqual(520 + 30 - 1e-6);
    // A mark hidden behind the instruments counts as out of view.
    expect(edgePointer({ x: -0.8, y: 0.5, behind: false }, view, safe, [instruments]).onScreen).toBe(false);
    // Off the bottom right, where the minimap is: moved clear of it.
    const q = edgePointer({ x: 1.6, y: -1.4, behind: false }, view, safe, [instruments, minimap]);
    const on = (b: Box) => q.x >= b.l - 10 && q.x <= b.r + 10 && q.y >= b.t - 10 && q.y <= b.b + 10;
    expect(on(minimap)).toBe(false);
  });

  it('with a label of some size, the whole of it stays inside the clear part and off the panels', () => {
    const half = { x: 80, y: 16 };
    const minimap: Box = { l: 1080, t: 530, r: 1268, b: 770 };
    for (const ndc of [{ x: 5, y: 0 }, { x: -5, y: 0.4 }, { x: 0.3, y: 6 }, { x: 0.9, y: -5 }, { x: 2, y: -2 }]) {
      const p = edgePointer({ ...ndc, behind: false }, view, safe, [minimap], 12, half);
      expect(p.x - half.x).toBeGreaterThanOrEqual(safe.l);
      expect(p.x + half.x).toBeLessThanOrEqual(safe.r);
      expect(p.y - half.y).toBeGreaterThanOrEqual(safe.t);
      expect(p.y + half.y).toBeLessThanOrEqual(safe.b);
      const overlaps = p.x + half.x > minimap.l && p.x - half.x < minimap.r && p.y + half.y > minimap.t && p.y - half.y < minimap.b;
      expect(overlaps, JSON.stringify(ndc)).toBe(false);
    }
  });
});
