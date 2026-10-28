/**
 * The drawn sails fill the way the air pushes them (the owner saw sails bellied into the wind with the wind on
 * the quarter): the old rule flipped a sail whenever the flow met its chord at more than 90°, which is the
 * normal state of an eased sail on a broad reach or run.
 */
import { describe, expect, it } from 'vitest';
import { sailFill } from '../../src/render/squibModel';
import { DEG, Simulation, autopilotHelm, buildConditions, squibParams } from '../../src/sim/index';

describe('sail fill', () => {
  it('bellies to leeward close-hauled and reaching, forward on a run, and the other way when backed', () => {
    expect(sailFill(30 * DEG, 10 * DEG)).toBeGreaterThan(0.9); // starboard tack, sail to port
    expect(sailFill(-30 * DEG, -10 * DEG)).toBeLessThan(-0.9); // port tack
    expect(sailFill(170 * DEG, 80 * DEG)).toBeGreaterThan(0.9); // run, wind on the starboard quarter, main out to port
    expect(sailFill(-170 * DEG, 80 * DEG)).toBeGreaterThan(0.9); // by the lee: still pushed forward and out
    expect(sailFill(-30 * DEG, 10 * DEG)).toBeLessThan(-0.9); // backed: wind on the boom's side
    expect(Math.abs(sailFill(10 * DEG, 10 * DEG))).toBeLessThan(1e-9); // luffing: flat
  });

  it('matches the side the physics pushes each sail to, at every wind angle on both tacks', () => {
    for (let twa = -175; twa <= 175; twa += 10) {
      const env = buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 12, twdDeg: 0 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }).env;
      const sim = new Simulation({
        params: squibParams(), env, initial: { headingDeg: -twa, speedKn: 4 },
        input: { autoMain: true, autoJib: true, autoCrew: true },
        controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twa * DEG }) }),
      });
      sim.advance(30);
      const s = sim.snapshot();
      for (const [f, angle] of [[s.forces.main, s.boomMain], [s.forces.jib, s.boomJib]] as const) {
        // Force normal to the chord, positive to port: the chord runs aft at `angle`, port normal (sin β, −cos β).
        const fn = f.x * Math.sin(angle) - f.yPlane * Math.cos(angle);
        if (Math.abs(fn) < 5 || f.luff < 0.5) continue;
        expect(Math.sign(sailFill(f.awa, angle)), `twa ${twa}`).toBe(Math.sign(fn));
      }
    }
  });
});
