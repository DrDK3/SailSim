/** Camera helpers: where the helm view looks, how far it can turn, and the drone's floor over the hills. */
import { describe, expect, it } from 'vitest';
import { HELM_LOOK, cameraFloor, clampHelmLook, helmLookDir } from '../../src/render/frames';

const DEG = Math.PI / 180;

describe('helm view look-around', () => {
  it('looks ahead by default, to starboard for positive yaw, and up for positive pitch', () => {
    const ahead = helmLookDir(0, 0);
    expect(ahead[0]).toBeCloseTo(0, 12);
    expect(ahead[1]).toBeCloseTo(0, 12);
    expect(ahead[2]).toBeCloseTo(-1, 12);
    const stbd = helmLookDir(90 * DEG, 0);
    expect(stbd[0]).toBeCloseTo(1, 12);
    expect(stbd[2]).toBeCloseTo(0, 12);
    const up = helmLookDir(0, 45 * DEG);
    expect(up[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(up[2]).toBeCloseTo(-Math.SQRT1_2, 12);
    // Always a unit vector.
    for (const [y, p] of [[1, 0.3], [-2, -0.6], [2.5, 0.9]] as const) {
      const d = helmLookDir(y, p);
      expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    }
  });

  it('stops at what a seated helm can see: over either shoulder, the cockpit floor to the masthead', () => {
    expect(clampHelmLook(4, 0).yaw).toBe(HELM_LOOK.maxYaw);
    expect(clampHelmLook(-4, 0).yaw).toBe(-HELM_LOOK.maxYaw);
    expect(clampHelmLook(0, 2).pitch).toBe(HELM_LOOK.maxPitch);
    expect(clampHelmLook(0, -2).pitch).toBe(HELM_LOOK.minPitch);
    expect(clampHelmLook(0.4, -0.2)).toEqual({ yaw: 0.4, pitch: -0.2 });
    expect(HELM_LOOK.maxYaw).toBeCloseTo(150 * DEG, 12);
  });
});

describe('drone', () => {
  it('flies at least 6 m above the ground or the water', () => {
    expect(cameraFloor(120)).toBe(126);
    expect(cameraFloor(-8)).toBe(6);
    expect(cameraFloor(-8, 2.1)).toBeCloseTo(8.1, 12);
  });
});
