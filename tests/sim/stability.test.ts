import { describe, expect, it } from 'vitest';
import { squibParams } from '../../src/sim/boat/squib';
import { rightingArm, rigAboveWater } from '../../src/sim/boat/dynamics';
import { uniformEnvironment } from '../../src/sim/env/environment';
import { Simulation } from '../../src/sim/simulation';

/**
 * Found while re-running the AI trials for review Package 1 (3 Nov 2026): the righting-arm table ends at 120°
 * and was extrapolated linearly, so past it the capsizing arm grew without limit. A boat knocked that far rolled
 * faster and faster until the numbers overflowed, and the next loop over them never ended (a river race hung).
 */
const DEG = Math.PI / 180;
const P = squibParams();

describe('stability at extreme heel', () => {
  it('the righting arm is bounded all the way round, zero upside down, and unchanged within the table', () => {
    const maxGz = Math.max(...P.gz.map(([, v]) => Math.abs(v)));
    for (let a = -20; a <= 20; a += 0.01) expect(Math.abs(rightingArm(P, a))).toBeLessThanOrEqual(maxGz + 1e-12);
    expect(rightingArm(P, Math.PI)).toBeCloseTo(0, 12);
    expect(rightingArm(P, 60 * DEG)).toBeCloseTo(0.46, 6);
    expect(rightingArm(P, -60 * DEG)).toBeCloseTo(-0.46, 6);
    // Taken round the circle: 370° is 10°.
    expect(rightingArm(P, 370 * DEG)).toBeCloseTo(rightingArm(P, 10 * DEG), 12);
  });

  it('the rig drives fully up to 75° of heel and not at all with the mast in the water', () => {
    expect(rigAboveWater(0)).toBe(1);
    expect(rigAboveWater(75 * DEG)).toBeCloseTo(1, 9);
    expect(rigAboveWater(82 * DEG)).toBeGreaterThan(0);
    expect(rigAboveWater(82 * DEG)).toBeLessThan(1);
    expect(rigAboveWater(90 * DEG)).toBe(0);
    expect(rigAboveWater(-120 * DEG)).toBe(0);
  });

  it('a boat rolled past her vanishing angle in a gale stays finite and never spins', () => {
    for (const startDeg of [100, 130, 170]) {
      const sim = new Simulation({ params: P, env: uniformEnvironment({ twsKn: 30, twdDeg: 90 }), initial: { headingDeg: 0, speedKn: 3 }, input: { mainSheet: 0.3, jibSheet: 0.3, autoMain: false, autoJib: false }, logInputs: false });
      sim.state.phi = -startDeg * DEG;
      let maxAbs = 0;
      for (let i = 0; i < 6000; i++) {
        sim.stepOnce();
        const s = sim.state;
        for (const v of [s.n, s.e, s.u, s.v, s.r, s.phi, s.p]) expect(Number.isFinite(v)).toBe(true);
        maxAbs = Math.max(maxAbs, Math.abs(s.phi));
      }
      expect(maxAbs).toBeLessThan(Math.PI + 0.2);
    }
  });
});
