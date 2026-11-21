import { describe, expect, it } from 'vitest';
import { boxesOverlap, chaseFraming, chaseScreenY, lookUpBlend } from '../../src/render/frames';

/**
 * Review #1–#3 (20 Nov 2026): the chase camera keeps the masthead (the wind indicator) clear of the toolbar on a laptop
 * and of the instruments on a phone, and the hull above the console. Geometry only.
 */
const MAST = 9.3;
const FOV = 55;

describe('chase framing keeps the masthead clear', () => {
  it('leaves the natural framing alone when the masthead is already clear', () => {
    const f = chaseFraming({ dist: 15, lookH: 2.5, mastH: MAST, fovDeg: FOV, viewH: 800, topPx: 20, bottomPx: 790 });
    expect(f.lookH).toBeCloseTo(2.5, 6);
    expect(f.dist).toBe(15);
    expect(f.fits).toBe(true);
  });

  it('at 1280×800 under a 58 px toolbar it tilts up just enough: the masthead 86 px down, the hull still above the console', () => {
    const natural = chaseScreenY(MAST, 15, 2.5, FOV, 800);
    expect(natural).toBeLessThan(86);
    const f = chaseFraming({ dist: 15, lookH: 2.5, mastH: MAST, fovDeg: FOV, viewH: 800, topPx: 86, bottomPx: 700 });
    expect(f.fits).toBe(true);
    expect(f.dist).toBe(15);
    expect(chaseScreenY(MAST, f.dist, f.lookH, FOV, 800)).toBeCloseTo(86, 0);
    expect(chaseScreenY(0.3, f.dist - 3, f.lookH, FOV, 800)).toBeLessThanOrEqual(700 + 1e-6);
  });

  it('on a phone held upright (844 px, instruments to 120 px, console from 600 px) it draws back until both fit', () => {
    const f = chaseFraming({ dist: 15, lookH: 2.5, mastH: MAST, fovDeg: FOV, viewH: 844, topPx: 150, bottomPx: 600 });
    expect(f.fits).toBe(true);
    expect(f.dist).toBeGreaterThan(15);
    expect(chaseScreenY(MAST, f.dist, f.lookH, FOV, 844)).toBeGreaterThanOrEqual(150 - 1e-6);
    expect(chaseScreenY(0.3, f.dist - 3, f.lookH, FOV, 844)).toBeLessThanOrEqual(600 + 1e-6);
  });

  it('never draws back more than three times the distance, and says when it could not fit', () => {
    const f = chaseFraming({ dist: 15, lookH: 2.5, mastH: MAST, fovDeg: FOV, viewH: 400, topPx: 190, bottomPx: 210 });
    expect(f.dist).toBeLessThanOrEqual(45 + 1e-6);
    expect(f.fits).toBe(false);
  });
});

describe('look up at the masthead', () => {
  it('eases in and out over about a third of a second, and cuts with reduced motion', () => {
    let u = 0;
    for (let i = 0; i < 21; i++) u = lookUpBlend(u, true, 1 / 60, false);
    expect(u).toBeGreaterThan(0.9);
    expect(u).toBeLessThan(1);
    for (let i = 0; i < 21; i++) u = lookUpBlend(u, false, 1 / 60, false);
    expect(u).toBeLessThan(0.1);
    expect(lookUpBlend(0, true, 1 / 60, true)).toBe(1);
    expect(lookUpBlend(1, false, 1 / 60, true)).toBe(0);
  });

  it('screen boxes overlap with padding', () => {
    const a = { l: 0, t: 0, r: 10, b: 10 };
    expect(boxesOverlap(a, { l: 12, t: 0, r: 20, b: 10 })).toBe(false);
    expect(boxesOverlap(a, { l: 12, t: 0, r: 20, b: 10 }, 3)).toBe(true);
  });
});
