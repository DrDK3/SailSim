/**
 * Damage from collisions and groundings, water getting in, sinking or floating awash (owner, 6 Nov 2026).
 * Thresholds, sizes and rates are estimates (E); the flotation is the class rules' (C1, C16).
 */
import { describe, expect, it } from 'vitest';
import { DEG, Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { DAMAGE, HULL, applyImpact, checkRigFall, damageSummary, impactEnergy, newDamage, rigFactor, rudderDamage, type Breach } from '../../src/sim/boat/damage';
import { FLOOD, breachFlow, floodHeelMoment, freeboard, leakRate, reserveBuoyancy, startPlugging, stepFlooding, wreckForces, type FloodContext } from '../../src/sim/boat/flooding';
import { Fleet } from '../../src/sim/race/fleet';
import type { Seabed } from '../../src/sim/geo/dart';

const params = squibParams();
const ctx = (o: Partial<FloodContext> = {}): FloodContext => ({ phi: 0, hs: 0, mass: params.mass, cockpitWater: 0, depth: 12, draft: params.draft, bail: true, selfDraining: true, ...o });
const breach = (o: Partial<Breach>): Breach => ({ x: 0, y: 0.8, zTop: -0.25, zBot: -0.35, area: 50e-4, compartment: 'main', kind: 'hole', plugged: 0, ...o });
const sim = (dt: number, seconds: number, d: ReturnType<typeof newDamage>, k: FloodContext) => {
  for (let t = 0; t < seconds; t += dt) stepFlooding(d, k, dt);
};

describe('impacts', () => {
  it('no mark below 120 J; a scuff, a gouge, a crack, then a hole, where it struck', () => {
    const d = newDamage();
    expect(applyImpact(d, 'side', 100, { x: 0, y: 1, z: 0.5 })).toEqual([]);
    expect(applyImpact(d, 'side', 250, { x: 0, y: 1, z: 0.5 })).toEqual(['scuffed (starboard side)']);
    expect(d.scars[0]).toMatchObject({ kind: 'scuff' });
    expect(applyImpact(d, 'side', 600, { x: -1, y: -1, z: 0.4 })).toEqual(['gelcoat gouged (port side)']);
    expect(d.breaches).toEqual([]);
    expect(applyImpact(d, 'side', 2000, { x: -1, y: -1, z: 0.1 })[0]).toMatch(/^cracked (above|below) the waterline \(port side\)$/);
    const crack = d.breaches[0]!;
    expect(crack.kind).toBe('crack');
    expect(crack.area).toBeCloseTo(DAMAGE.crackAreaMin + ((DAMAGE.crackAreaMax - DAMAGE.crackAreaMin) * 1200) / 1700, 12);
    expect(crack.y).toBeLessThan(0);
    const h = newDamage();
    applyImpact(h, 'side', 4000, { x: 0, y: 1, z: 0.3 });
    expect(h.breaches[0]).toMatchObject({ kind: 'hole', compartment: 'main' });
    expect(h.breaches[0]!.area).toBeCloseTo(DAMAGE.holeAreaMin + 1500 * DAMAGE.holeAreaPerJ, 12);
    // ½ m v²: a Squib with her crew at 3 kn.
    expect(impactEnergy(1.543, params.mass)).toBeCloseTo(0.5 * params.mass * 1.543 ** 2, 9);
  });

  it('a fendered pontoon gives; a holed bow floods the forward tank; a second knock nearby enlarges the same hole', () => {
    const soft = newDamage();
    applyImpact(soft, 'side', 1200, { x: 0, y: 1, z: 0.35, hardness: 0.6 });
    expect(soft.breaches).toEqual([]);
    const bow = newDamage();
    expect(applyImpact(bow, 'bow', 5000, { x: 2.6, y: 0.1, z: 0.25 })[0]).toMatch(/holed below the waterline \(starboard bow\) into the forward buoyancy tank/);
    expect(bow.breaches[0]!.compartment).toBe('fore');
    const area = bow.breaches[0]!.area;
    applyImpact(bow, 'bow', 4000, { x: 2.5, y: 0.1, z: 0.25 });
    expect(bow.breaches.length).toBe(1);
    expect(bow.breaches[0]!.area).toBeGreaterThan(area);
  });

  it('the rudder bends then tears off; the forestay parts and the mast falls aft; a broken shroud drops it to leeward once loaded', () => {
    const r = newDamage();
    applyImpact(r, 'stern', 1500, { x: -2.8, y: 0, z: -0.6 });
    expect(r.rudder).toBeCloseTo(1100 / 3000, 12);
    expect(r.breaches).toEqual([]);
    applyImpact(r, 'stern', 4000, { x: -2.8, y: 0, z: -0.6 });
    expect(r.rudder).toBe(1);
    expect(rudderDamage(r)).toEqual({ grip: 0, bias: 0 });
    expect(r.breaches[0]!.kind).toBe('crack');
    const bent = rudderDamage({ ...newDamage(), rudder: 0.5 });
    expect(bent.grip).toBeCloseTo(1 - (1 - DAMAGE.rudderKeepsGrip) * 0.5, 12);

    const f = newDamage();
    expect(applyImpact(f, 'bow', 12000, { x: 2.7, y: 0, z: 0.4 })).toContain('forestay parted: the mast fell aft');
    expect(f.rigParts.down).toBe('aft');
    expect(rigFactor(f)).toBe(0);

    const s = newDamage();
    expect(applyImpact(s, 'side', 9000, { x: HULL.mastX, y: -1, z: 0.5 })).toContain('port shroud broken: the mast will fall if it takes the load');
    // The port shroud broken: it stands while the wind is to starboard (that shroud to leeward), or the sails do
    // not draw; with the wind to port it falls to starboard.
    expect(checkRigFall(s, 1, true)).toBe('');
    expect(checkRigFall(s, -1, false)).toBe('');
    expect(checkRigFall(s, -1, true)).toBe('stbd');
    expect(s.rig).toBe(1);
  });

  it('a hard grounding opens the keel joint at its root', () => {
    const d = newDamage();
    expect(applyImpact(d, 'keel', 1000)).toEqual(['keel struck the bottom']);
    expect(applyImpact(d, 'keel', 4000)[0]).toMatch(/keel joint/);
    expect(d.breaches[0]).toMatchObject({ x: HULL.keelRootX, y: 0, compartment: 'main' });
    expect(d.breaches[0]!.zBot).toBeLessThan(0);
  });
});

describe('water getting in', () => {
  it('a hole lets water in by the orifice law; none above the water, until she heels onto it or the waves reach it', () => {
    const d = newDamage();
    const b = breach({ zTop: -0.25, zBot: -0.35 });
    const q = breachFlow(b, d, 0, 0);
    expect(q).toBeCloseTo(FLOOD.cd * 50e-4 * FLOOD.rho * Math.sqrt(2 * 9.80665 * 0.3), 1);
    const high = breach({ y: 0.85, zTop: 0.25, zBot: 0.15 });
    expect(breachFlow(high, d, 0, 0)).toBe(0);
    expect(breachFlow(high, d, 20 * DEG, 0)).toBeGreaterThan(0);
    expect(breachFlow(high, d, -20 * DEG, 0)).toBe(0);
    expect(breachFlow(breach({ zTop: 0.12, zBot: 0.05 }), d, 0, 0.35)).toBeGreaterThan(0);
  });

  it('it stops when the water inside is as high as the sea outside, and runs out if she rises', () => {
    const d = newDamage();
    const b = breach({});
    const k = FLOOD.compartments.main;
    // Inside level at the sea's: floor −0.35 m, so (0.35 m × area × ρ) of water.
    d.water.main = 0.35 * k.area * FLOOD.rho;
    expect(Math.abs(breachFlow(b, d, 0, 0))).toBeLessThan(1e-9);
    d.water.main *= 1.2;
    expect(breachFlow(b, d, 0, 0)).toBeLessThan(0);
  });

  it('the crew keep up with a crack by bailing, not with a hole; stuffing a sail bag in stops most of it', () => {
    const crack = newDamage();
    crack.breaches.push(breach({ area: 3e-4, kind: 'crack', zTop: -0.15, zBot: -0.25 }));
    sim(0.05, 600, crack, ctx());
    expect(crack.water.main).toBeLessThan(FLOOD.bucketFromKg);
    expect(crack.bailing).toBe(true);
    const hole = newDamage();
    hole.breaches.push(breach({ area: 60e-4 }));
    sim(0.05, 60, hole, ctx());
    expect(hole.water.main).toBeGreaterThan(200);
    const before = leakRate(hole, 0, 0);
    expect(startPlugging(hole)).toBe(true);
    sim(0.05, FLOOD.plugTime + 0.1, hole, ctx());
    expect(hole.breaches[0]!.plugged).toBe(FLOOD.plugShare);
    expect(leakRate(hole, 0, 0)).toBeLessThan(0.35 * before);
  });

  it('water inside sinks and trims her; its free surface makes her tender', () => {
    const d = newDamage();
    d.water.fore = 300;
    d.breaches.push(breach({ x: 2.4, compartment: 'fore', zTop: 0.3, zBot: 0.2 }));
    stepFlooding(d, ctx({ bail: false }), 0.01);
    expect(d.sinkage).toBeCloseTo(300 / (FLOOD.rho * 4.8), 3);
    expect(d.trim).toBeCloseTo((300 * FLOOD.compartments.fore.x) / ((params.mass + 300) * FLOOD.gmL), 3);
    expect(d.state).toBe('low');
    expect(freeboard(d, 0)).toBeLessThan(freeboard(newDamage(), 0));
    // 400 kg in the main hull heeled 15°: it runs to the low side (a heeling moment) more than its low weight stiffens her.
    const m = { ...newDamage(), water: { fore: 0, main: 400, aft: 0 } };
    expect(floodHeelMoment(m, 15 * DEG)).toBeGreaterThan(0);
    expect(floodHeelMoment(m, -15 * DEG)).toBeLessThan(0);
  });

  it('a flooded main hull leaves her awash on her tanks; a flooded forward tank as well and she sinks to the bottom', () => {
    const awash = newDamage();
    awash.breaches.push(breach({ area: 0.03, zTop: -0.1, zBot: -0.3 }));
    sim(0.05, 900, awash, ctx({ bail: false }));
    expect(awash.state).toBe('awash');
    expect(reserveBuoyancy(awash)).toBeGreaterThan(params.mass);
    expect(freeboard(awash, 0)).toBeLessThan(0.05);
    const sinks = newDamage();
    sinks.breaches.push(breach({ area: 0.03, zTop: -0.1, zBot: -0.3 }), breach({ x: 2.4, y: 0.4, compartment: 'fore', area: 0.02, zTop: 0.05, zBot: -0.2 }));
    sim(0.05, 1200, sinks, ctx({ bail: false, depth: 12 }));
    expect(reserveBuoyancy(sinks)).toBeLessThan(params.mass);
    expect(sinks.state).toBe('sunk');
    expect(sinks.sinkage).toBeCloseTo(12 - params.draft, 6);
    expect(sinks.trim).toBeGreaterThan(0.2);
    expect(damageSummary(sinks)).toMatch(/^sunk/);
  });

  it('sailing with the wind to starboard, a broken starboard shroud brings the mast down to port', () => {
    const env = uniformEnvironment({ twsKn: 10, twdDeg: 90 });
    const s = new Simulation({ params, env, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    for (let k = 0; k < 300; k++) s.stepOnce();
    s.impact('test', 'side', 3, 9000, { x: HULL.mastX, y: 1, z: 0.5 });
    expect(s.damage.rigParts.shroudStbd).toBe(1);
    for (let k = 0; k < 100; k++) s.stepOnce();
    expect(s.damage.rigParts.down).toBe('port');
    expect(s.impacts.at(-1)!.effects).toEqual(['the mast fell to port']);
  });

  it('a fallen rig drags in the water, turning her towards it and listing her', () => {
    const d = { ...newDamage(), rigParts: { forestay: 0, shroudPort: 1, shroudStbd: 0, down: 'stbd' as const } };
    const f = wreckForces(d, 2, 0, 0, FLOOD.rho);
    expect(f.x).toBeLessThan(-500);
    expect(f.n).toBeGreaterThan(0);
    expect(f.roll).toBeGreaterThan(0);
  });
});

/** A boat heading north at `kn` towards a fixed jetty, her bow about 1.5 m from it, in a light air from the east. */
function intoJetty(kn: number) {
  const env = uniformEnvironment({ twsKn: 3, twdDeg: 90 });
  const s = new Simulation({ params, env, ownsEnvironment: false, initial: { n: 14.5, e: 0, headingDeg: 0, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const fleet = new Fleet(env);
  fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim: s });
  fleet.setObstacles({ piers: [{ name: 'Test jetty', floating: false, line: [[-40, 20], [40, 20]], width: 3 }] });
  return { sim: s, fleet };
}

describe('collisions', () => {
  it('a gentle bump marks her; a hard one head-on holes her bow below the waterline, and the forward tank floods', () => {
    const gentle = intoJetty(1.5);
    for (let k = 0; k < 2500; k++) gentle.fleet.stepOnce();
    expect(gentle.sim.damage.breaches).toEqual([]);
    const hard = intoJetty(6);
    for (let k = 0; k < 3000; k++) hard.fleet.stepOnce();
    const hit = hard.sim.impacts[0]!;
    expect(hit.what).toBe('Test jetty');
    expect(hit.region).toBe('bow');
    expect(hit.energy).toBeCloseTo(impactEnergy(hit.speed, params.mass), 6);
    expect(hard.sim.damage.breaches[0]!.compartment).toBe('fore');
    expect(hard.sim.damage.breaches[0]!.zBot).toBeLessThan(0);
    expect(hard.sim.damage.water.fore).toBeGreaterThan(0);
    expect(hard.sim.damage.trim).toBeGreaterThan(0);
    expect(hard.sim.snapshot().damage.breaches).toEqual(hard.sim.damage.breaches);
    expect(hard.sim.snapshot().damage.breaches).not.toBe(hard.sim.damage.breaches);
  });

  it('a knock on the topsides heels her away from it', () => {
    const env = uniformEnvironment({ twsKn: 0.1, twdDeg: 0 });
    const s = new Simulation({ params, env, ownsEnvironment: false, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 0 } });
    s.external = { n: 0, e: 2000, yaw: 0, roll: 2000 * 0.55 };
    const phi0 = s.state.phi;
    for (let k = 0; k < 50; k++) s.stepOnce();
    expect(s.state.phi - phi0).toBeGreaterThan(1 * DEG);
  });

  it('holed and flooding, she slows; dismasted, she stops', () => {
    const go = (setup: (s: Simulation) => void) => {
      const env = uniformEnvironment({ twsKn: 10, twdDeg: 90 });
      const s = new Simulation({ params, env, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
      setup(s);
      for (let k = 0; k < 6000; k++) s.stepOnce();
      return s;
    };
    const sound = go(() => {});
    const flooding = go((s) => s.damage.breaches.push(breach({ area: 25e-4, zTop: -0.2, zBot: -0.3 })));
    const down = go((s) => {
      s.damage.rigParts.down = 'aft';
      s.damage.rig = 1;
    });
    expect(flooding.damage.water.main).toBeGreaterThan(50);
    expect(flooding.state.u).toBeLessThan(sound.state.u);
    expect(down.state.u).toBeLessThan(0.3);
  });
});

describe('groundings', () => {
  // A shelf: deep water south of n = 30 m, a bed at +0.5 m ODN north of it (dry at the default level).
  const shelf: Seabed = { bedElevation: (n) => (n > 30 ? 0.5 : -10), bedGradient: () => ({ n: 0, e: 0 }) };
  const run = (kn: number) => {
    const env = uniformEnvironment({ twsKn: 12, twdDeg: 90 });
    const s = new Simulation({ params, env, seabed: shelf, initial: { n: 0, e: 0, headingDeg: 0, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    for (let k = 0; k < 2000; k++) s.stepOnce();
    return s;
  };

  it('running onto the shelf at sailing speed opens the keel joint and she leaks', () => {
    const fast = run(5);
    const hit = fast.impacts.find((i) => i.what === 'the bottom');
    expect(hit).toBeDefined();
    expect(['keel', 'stern']).toContain(hit!.region);
    expect(hit!.speed).toBeGreaterThan(DAMAGE.groundingSpeed);
    expect(fast.damage.breaches.some((b) => b.x === HULL.keelRootX)).toBe(true);
  });

  it('a bent rudder pulls her off a straight course with the helm amidships; a lost one cannot steer', () => {
    const go = (rudder: number, helm = 0) => {
      const env = uniformEnvironment({ twsKn: 10, twdDeg: 90 });
      const s = new Simulation({ params, env, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true, helm } });
      s.damage.rudder = rudder;
      for (let k = 0; k < 1000; k++) s.stepOnce();
      return s.state.psi;
    };
    const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(turn(go(0.8), go(0))).toBeGreaterThan(5 * DEG);
    // Helm hard over: a sound rudder turns her far; with the blade gone she barely answers.
    expect(turn(go(0, 1), go(0, 0))).toBeGreaterThan(5 * turn(go(1, 1), go(1, 0)));
  });
});
