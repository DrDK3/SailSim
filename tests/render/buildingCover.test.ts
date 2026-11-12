/**
 * Overlapping building outlines (owner, 11 Nov 2026: flickering on BRNC): a building wholly inside a taller one is left
 * out, and so is a wall with a building at least as tall pressed against its outside; each would fight the surface
 * in front of it for the same pixels.
 */
import { describe, expect, it } from 'vitest';
import { buildingCover } from '../../src/render/dart';
import { NEAR_HELM_M, NEAR_M } from '../../src/render/scene';

const box = (e0: number, n0: number, e1: number, n1: number, b: number, t: number) => ({
  r: [[e0, n0], [e1, n0], [e1, n1], [e0, n1]] as [number, number][],
  b,
  t,
});

describe('overlapping building outlines', () => {
  it('a lower building wholly inside a taller one is left out (as the College Chapel inside BRNC)', () => {
    const college = box(0, 0, 100, 40, 55, 73);
    const chapel = box(60, 10, 90, 30, 53.5, 65.6);
    const tower = box(40, 15, 50, 25, 55, 90);
    const c = buildingCover([college, chapel, tower]);
    expect(c.inside(1)).toBe(true);
    // A tower rising above the building it stands in is kept.
    expect(c.inside(2)).toBe(false);
    expect(c.inside(0)).toBe(false);
  });

  it('a wall with an equal or taller building against its outside is hidden; one above a lower neighbour is not', () => {
    const house = box(0, 0, 10, 8, 2, 10);
    const tallNeighbour = box(10, 0, 20, 8, 2, 12);
    const lowNeighbour = box(-6, 0, 0, 8, 2, 5);
    const c = buildingCover([house, tallNeighbour, lowNeighbour]);
    // The house's east wall (counter-clockwise ring: (10,0) → (10,8)) faces the taller neighbour.
    expect(c.wallHidden(0, [10, 0], [10, 8], 10)).toBe(true);
    // Its west wall rises above the lower neighbour: drawn.
    expect(c.wallHidden(0, [0, 8], [0, 0], 10)).toBe(false);
    // Its south wall faces open ground.
    expect(c.wallHidden(0, [0, 0], [10, 0], 10)).toBe(false);
  });

  it('the near plane is out of the way of distant surfaces except in the helm view', () => {
    expect(NEAR_M).toBeGreaterThanOrEqual(0.5);
    expect(NEAR_HELM_M).toBeLessThan(NEAR_M);
    // Depth resolution at 1 km goes as d² / near: five times finer than at 0.1 m.
    expect((1000 ** 2 / 0.1) / (1000 ** 2 / NEAR_M)).toBeCloseTo(5, 6);
  });
});
