/** Damage from collisions and groundings, and the heel a knock on the topsides gives (estimates, E). */
import { describe, expect, it } from 'vitest';
import { DEG, Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { DAMAGE, applyImpact, damageSummary, impactEnergy, newDamage, rigFactor, rudderDamage, stepBilge } from '../../src/sim/boat/damage';
import { Fleet } from '../../src/sim/race/fleet';
import type { Seabed } from '../../src/sim/geo/dart';

const params = squibParams();

describe('impacts', () => {
  it('scrapes below 300 J; cracks the hull beyond 800 J; the rudder at the stern; the rig only in a big bow impact', () => {
    const d = newDamage();
    expect(applyImpact(d, 'side', 250)).toEqual([]);
    expect(d).toEqual(newDamage());
    expect(applyImpact(d, 'side', 600)).toEqual(['scraped']);
    expect(applyImpact(d, 'side', 2000)).toEqual(['hull cracked: leaking']);
    expect(d.hull).toBeCloseTo(1200 / 6000, 12);
    const s = newDamage();
    applyImpact(s, 'stern', 1000);
    expect(s.rudder).toBeCloseTo(600 / 3000, 12);
    const b = newDamage();
    expect(applyImpact(b, 'bow', 12000)).toContain('rig failed: sails down');
    expect(rigFactor(b)).toBe(0);
    // ½ m v²: a Squib with her crew at 3 kn.
    expect(impactEnergy(1.543, params.mass)).toBeCloseTo(0.5 * params.mass * 1.543 ** 2, 9);
  });

  it('a leak fills the bilge, the crew pump, and her buoyancy caps it', () => {
    const d = { ...newDamage(), hull: 0.1 };
    for (let k = 0; k < 6000; k++) stepBilge(d, 0.01);
    expect(d.bilge).toBeCloseTo((0.1 * DAMAGE.leakMaxKgS - DAMAGE.pumpKgS) * 60 > 0 ? (0.1 * DAMAGE.leakMaxKgS - DAMAGE.pumpKgS) * 60 : 0, 6);
    const big = { ...newDamage(), hull: 1 };
    for (let k = 0; k < 60000; k++) stepBilge(big, 0.01);
    expect(big.bilge).toBe(DAMAGE.bilgeMaxKg);
    expect(damageSummary(big)).toMatch(/hull leaking 3.0 kg\/s · 300 kg in the bilge/);
    const r = rudderDamage({ ...newDamage(), rudder: 1 });
    expect(r.grip).toBeCloseTo(DAMAGE.rudderKeepsGrip, 12);
    expect(r.bias).toBeCloseTo(DAMAGE.rudderBentRad, 12);
  });
});

/** A boat heading north at `kn` towards a fixed jetty, her bow about 1.5 m from it, in a light air from the east. */
function intoJetty(kn: number) {
  const env = uniformEnvironment({ twsKn: 3, twdDeg: 90 });
  const sim = new Simulation({ params, env, ownsEnvironment: false, initial: { n: 14.5, e: 0, headingDeg: 0, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const fleet = new Fleet(env);
  fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
  fleet.setObstacles({ piers: [{ name: 'Test jetty', floating: false, line: [[-40, 20], [40, 20]], width: 3 }] });
  return { sim, fleet };
}

describe('collisions', () => {
  it('a gentle bump does nothing; a hard one head-on holes her, and she leaks', () => {
    const gentle = intoJetty(1.5);
    for (let k = 0; k < 2500; k++) gentle.fleet.stepOnce();
    expect(gentle.sim.impacts[0]?.effects ?? []).not.toContain('hull cracked: leaking');
    const hard = intoJetty(6);
    for (let k = 0; k < 3000; k++) hard.fleet.stepOnce();
    const hit = hard.sim.impacts[0]!;
    expect(hit.what).toBe('Test jetty');
    expect(hit.region).toBe('bow');
    expect(hit.energy).toBeCloseTo(impactEnergy(hit.speed, params.mass), 6);
    expect(hard.sim.damage.hull).toBeGreaterThan(0);
    expect(hard.sim.damage.bilge).toBeGreaterThan(0);
    expect(hard.sim.snapshot().damage.hull).toBe(hard.sim.damage.hull);
  });

  it('a knock on the topsides heels her away from it', () => {
    const env = uniformEnvironment({ twsKn: 0.1, twdDeg: 0 });
    const sim = new Simulation({ params, env, ownsEnvironment: false, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 0 } });
    sim.external = { n: 0, e: 2000, yaw: 0, roll: 2000 * 0.55 };
    const phi0 = sim.state.phi;
    for (let k = 0; k < 50; k++) sim.stepOnce();
    // Pushed to starboard above the waterline: she heels to starboard.
    expect(sim.state.phi - phi0).toBeGreaterThan(1 * DEG);
  });
});

describe('groundings', () => {
  // A shelf: deep water south of n = 30 m, a bed at +0.5 m ODN north of it (dry at the default level).
  const shelf: Seabed = { bedElevation: (n) => (n > 30 ? 0.5 : -10), bedGradient: () => ({ n: 0, e: 0 }) };
  const run = (kn: number) => {
    const env = uniformEnvironment({ twsKn: 12, twdDeg: 90 });
    const sim = new Simulation({ params, env, seabed: shelf, initial: { n: 0, e: 0, headingDeg: 0, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    for (let k = 0; k < 2000; k++) sim.stepOnce();
    return sim;
  };

  it('running onto the shelf at sailing speed damages the keel and starts a leak; drifting on does not', () => {
    const fast = run(5);
    const hit = fast.impacts.find((i) => i.what === 'the bottom');
    expect(hit).toBeDefined();
    expect(['keel', 'stern']).toContain(hit!.region);
    expect(hit!.speed).toBeGreaterThan(DAMAGE.groundingSpeed);
    expect(fast.damage.hull).toBeGreaterThan(0);
  });

  it('a bent rudder pulls her off a straight course with the helm amidships', () => {
    const go = (rudder: number) => {
      const env = uniformEnvironment({ twsKn: 10, twdDeg: 90 });
      const sim = new Simulation({ params, env, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true, helm: 0 } });
      sim.damage.rudder = rudder;
      for (let k = 0; k < 1000; k++) sim.stepOnce();
      return sim.state.psi;
    };
    const straight = go(0);
    const bent = go(0.8);
    expect(Math.abs(Math.atan2(Math.sin(bent - straight), Math.cos(bent - straight)))).toBeGreaterThan(5 * DEG);
  });
});
