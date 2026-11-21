/**
 * The flattening controls one by one (review #25, package B3): "Flat" stays a macro that sets the kicker, cunningham
 * and outhaul together exactly as before (the same state, bit for bit), and each on its own changes the sail as its
 * estimated share says (E, src/sim/boat/flatten.ts SPLIT). The jib lead aft opens the jib (less power).
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment, type ControlInput } from '../../src/sim/index';
import { autopilotHelm } from '../../src/sim/control/autopilot';
import { DEG } from '../../src/sim/math/angles';
import { FLATTEN, SPLIT, flattenedParams, splitParams } from '../../src/sim/boat/flatten';

function sail(input: Partial<ControlInput>, seconds = 60, twaDeg = 45, tws = 14) {
  const sim = new Simulation({
    params: squibParams(),
    env: uniformEnvironment({ twsKn: tws, twdDeg: 0 }),
    initial: { headingDeg: -twaDeg, speedKn: 4 },
    input: { autoMain: true, autoJib: true, autoCrew: true, ...input },
    controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twaDeg * DEG }) }),
  });
  let heel = 0;
  const n = seconds * 100;
  for (let i = 0; i < n; i++) {
    sim.stepOnce();
    if (i > n / 2) heel += Math.abs(sim.state.phi);
  }
  return { sim, heel: heel / (n / 2) };
}

describe('the sail controls one by one', () => {
  it('the shares add up to Flat exactly', () => {
    const sum = (k: 'clMaxDrop' | 'cd0Drop' | 'ceHeightDrop') => SPLIT.outhaul[k] + SPLIT.cunningham[k] + SPLIT.kicker[k];
    expect(sum('clMaxDrop')).toBeCloseTo(FLATTEN.clMaxDrop, 12);
    expect(sum('cd0Drop')).toBeCloseTo(FLATTEN.cd0Drop, 12);
    expect(sum('ceHeightDrop')).toBeCloseTo(FLATTEN.ceHeightDrop, 12);
  });

  it('all three at the Flat setting are the Flat control itself (the same parameter object)', () => {
    const p = squibParams();
    for (const f of [0, 0.25, 0.5, 1]) expect(splitParams(p, f, f, f, f, 0)).toBe(flattenedParams(p, f));
  });

  it('Flat alone and Flat with each control set to the same value: the same state, bit for bit', () => {
    for (const f of [0, 0.5, 1]) {
      const a = sail({ flatten: f });
      const b = sail({ flatten: f, kicker: f, cunningham: f, outhaul: f, jibLead: 0 });
      expect(b.sim.stateHash(), `flat ${f}`).toBe(a.sim.stateHash());
    }
  });

  it('each on its own depowers (less heel upwind in 14 kn than none), and less than all three together', () => {
    const none = sail({ flatten: 0 }).heel;
    const all = sail({ flatten: 1 }).heel;
    for (const k of ['kicker', 'cunningham', 'outhaul'] as const) {
      const one = sail({ flatten: 0, [k]: 1 }).heel;
      expect(one, k).toBeLessThan(none);
      expect(one, k).toBeGreaterThan(all);
    }
  });

  it('the jib lead aft opens the jib (less heel), forward closes it (more), as estimated', () => {
    const set = sail({}).heel;
    expect(sail({ jibLead: 1 }).heel).toBeLessThan(set);
    expect(sail({ jibLead: -1 }).heel).toBeGreaterThan(set);
  });
});
