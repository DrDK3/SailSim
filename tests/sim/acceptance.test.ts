/**
 * Phase 1 acceptance criteria (docs/DEVELOPMENT_PLAN.md). These check internal consistency and physical
 * plausibility. They do NOT establish real-world accuracy: there is no Squib performance data to compare
 * against yet. Plausibility bands are estimates and only produce warnings.
 */
import { describe, expect, it } from 'vitest';
import {
  DEG,
  Simulation,
  apparentWind,
  autopilotHelm,
  squibParams,
  trueWindAngle,
  uniformEnvironment,
  windVelocity,
  type BoatSnapshot,
  type Environment,
} from '../../src/sim/index';
import { createRng } from '../../src/sim/math/rng';
import { hullResistance } from '../../src/sim/boat/forces';
import { determinismSim } from '../../src/sim/testing/determinism';
import { KN, sailingSim, toKn } from './helpers';

const LONG = 120_000;

function settle(sim: Simulation, seconds: number): { snap: BoatSnapshot; dStwPerS: number } {
  sim.advance(seconds - 10);
  const before = sim.snapshot().stw;
  sim.advance(10);
  const snap = sim.snapshot();
  return { snap, dStwPerS: toKn(snap.stw - before) / 10 };
}

describe('Criterion 1: a properly trimmed sail drives on feasible points of sail', () => {
  for (const twa of [50, 90, 135]) {
    it(`TWA ${twa}°, TWS 10 kn`, () => {
      const sim = sailingSim({ twaDeg: twa });
      const { snap, dStwPerS } = settle(sim, 180);
      const drive = snap.forces.main.x + snap.forces.jib.x;
      expect(drive).toBeGreaterThan(0);
      expect(Math.abs(dStwPerS)).toBeLessThan(0.01);
      expect(snap.stw).toBeGreaterThan(0);
      const kn = toKn(snap.stw);
      if (kn < 3 || kn > 6) console.warn(`[plausibility] steady STW ${kn.toFixed(2)} kn at TWA ${twa}° is outside 3–6 kn`);
    }, LONG);
  }
});

describe('Criterion 2: luffing reduces drive', () => {
  it('easing both sheets past the luff point at TWA 60° cuts drive and speed', () => {
    let eased = false;
    const sim = sailingSim({ twaDeg: 60 });
    const base = sim.controller!;
    sim.controller = (s) => {
      const c = base(s) ?? {};
      if (eased) return { helm: c.helm, mainSheet: 1, jibSheet: 1 };
      return c;
    };
    const { snap: trimmed } = settle(sim, 150);
    const driveTrimmed = trimmed.forces.main.x + trimmed.forces.jib.x;
    eased = true;
    sim.advance(1);
    const after1s = sim.snapshot();
    const driveEased = after1s.forces.main.x + after1s.forces.jib.x;
    expect(after1s.forces.main.luff).toBeLessThan(0.5);
    expect(driveEased).toBeLessThan(0.5 * driveTrimmed);
    sim.advance(90);
    const steady = sim.snapshot();
    expect(steady.stw).toBeLessThan(0.7 * trimmed.stw);
  }, LONG);
});

describe('Criterion 3: apparent wind is consistent', () => {
  it('matches the analytic vector formula for 10,000 random states', () => {
    const rng = createRng(7);
    let maxErr = 0;
    for (let i = 0; i < 10_000; i++) {
      const tws = rng.next() * 15;
      const twd = rng.next() * 2 * Math.PI;
      const sog = rng.next() * 4;
      const cog = rng.next() * 2 * Math.PI;
      const psi = rng.next() * 2 * Math.PI;
      const aw = apparentWind(windVelocity(tws, twd), { n: sog * Math.cos(cog), e: sog * Math.sin(cog) }, psi);
      // |A|² = TWS² + SOG² + 2·TWS·SOG·cos(TWD − COG); A comes from the bearing of (V_boat − W).
      const aws = Math.sqrt(Math.max(0, tws * tws + sog * sog + 2 * tws * sog * Math.cos(twd - cog)));
      const fromBearing = Math.atan2(sog * Math.sin(cog) + tws * Math.sin(twd), sog * Math.cos(cog) + tws * Math.cos(twd));
      maxErr = Math.max(maxErr, Math.abs(aw.aws - aws));
      if (aws > 1e-6) {
        const dAwa = Math.atan2(Math.sin(aw.awa - (fromBearing - psi)), Math.cos(aw.awa - (fromBearing - psi)));
        maxErr = Math.max(maxErr, Math.abs(dAwa));
      }
    }
    expect(maxErr).toBeLessThan(1e-9);
  });

  it('AWS falls monotonically as the boat bears away at constant speed', () => {
    let last = Infinity;
    for (let twa = 0; twa <= 180; twa += 1) {
      const psi = -twa * DEG; // wind from 000°
      const v = 2.5;
      const aw = apparentWind(windVelocity(5, 0), { n: v * Math.cos(psi), e: v * Math.sin(psi) }, psi);
      expect(aw.aws).toBeLessThanOrEqual(last + 1e-12);
      last = aw.aws;
    }
  });
});

describe('Criterion 4 (basic): a tack slows the boat and turns it over time', () => {
  for (const tws of [6, 10, 15]) {
    it(`tack from close-hauled starboard, TWS ${tws} kn`, () => {
      let phase: 'settle' | 'turn' | 'after' = 'settle';
      const sim = new Simulation({
        params: squibParams(),
        env: uniformEnvironment({ twsKn: tws, twdDeg: 0 }),
        initial: { headingDeg: 40, speedKn: 4 },
        input: { autoMain: true, autoJib: true },
        controller: (s) => {
          if (phase === 'settle') return { helm: autopilotHelm(s, { mode: 'twa', target: 40 * DEG }) };
          if (phase === 'turn') {
            if (trueWindAngle(s) < -35 * DEG) phase = 'after';
            return { helm: 0.7 };
          }
          return { helm: autopilotHelm(s, { mode: 'twa', target: -40 * DEG }) };
        },
      });
      sim.advance(60);
      const entry = sim.snapshot();
      expect(entry.mainSide).toBe(1);
      phase = 'turn';
      const t0 = sim.time;
      let minStw = entry.stw;
      let maxR = 0;
      let tHeadToWind = -1;
      let t90 = -1;
      while (sim.time - t0 < 60) {
        sim.stepOnce();
        const s = sim.snapshot();
        minStw = Math.min(minStw, s.stw);
        maxR = Math.max(maxR, Math.abs(s.r));
        if (tHeadToWind < 0 && s.twa < 0) tHeadToWind = s.t - t0;
        if (tHeadToWind > 0 && t90 < 0 && s.stw >= 0.9 * entry.stw) t90 = s.t - t0;
      }
      const fin = sim.snapshot();
      const turned = Math.atan2(Math.sin(fin.heading - entry.heading), Math.cos(fin.heading - entry.heading)) / DEG;
      console.log(`[model output] tack at ${tws} kn: entry ${toKn(entry.stw).toFixed(2)} kn, minimum ${((100 * minStw) / entry.stw).toFixed(0)}% of entry, head to wind after ${tHeadToWind.toFixed(1)} s, 90% speed after ${t90.toFixed(1)} s, turned ${turned.toFixed(0)}°`);
      expect(turned).toBeGreaterThan(70);
      expect(turned).toBeLessThan(110);
      expect(minStw).toBeLessThanOrEqual(0.85 * entry.stw);
      expect(tHeadToWind).toBeGreaterThanOrEqual(1.5);
      expect(maxR / DEG).toBeLessThanOrEqual(45);
      expect(t90).toBeGreaterThan(0);
      expect(t90).toBeLessThanOrEqual(30);
      // The sails crossed because the apparent wind changed side, not because of a command.
      expect(fin.mainSide).toBe(-1);
      expect(fin.jibSide).toBe(-1);
      expect(fin.boomMain).toBeLessThan(0);
    }, LONG);
  }
});

describe('Criterion 6: rudder force and turning response are consistent', () => {
  function steadyYawRate(speedKn: number, rudderDeg: number): number {
    const p = squibParams();
    const thrust = hullResistance(p, speedKn * KN, 0, 1025).total;
    const sim = new Simulation({
      params: p,
      env: uniformEnvironment({ twsKn: 0, twdDeg: 0 }),
      initial: { headingDeg: 0, speedKn },
      testThrust: thrust,
      controller: () => ({ helm: rudderDeg / (p.rudder.maxAngle / DEG) }),
    });
    sim.advance(25);
    return sim.state.r;
  }

  it('sign, monotonicity up to stall, speed dependence and symmetry', () => {
    const angles = [2, 5, 10, 15, 18];
    const rates = angles.map((a) => steadyYawRate(4, a));
    rates.forEach((r) => expect(r).toBeGreaterThan(0)); // +helm turns to starboard
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
    // Port/starboard symmetry within 0.1% (the luffing sails sit on one side, a tiny real asymmetry).
    const r10 = steadyYawRate(4, 10);
    expect(Math.abs(steadyYawRate(4, -10) + r10)).toBeLessThan(1e-3 * Math.abs(r10));
    expect(Math.abs(steadyYawRate(4, 0))).toBeLessThan(1e-6);
    const at2 = steadyYawRate(2, 10);
    const at6 = steadyYawRate(6, 10);
    expect(at6).toBeGreaterThan(steadyYawRate(4, 10));
    expect(steadyYawRate(4, 10)).toBeGreaterThan(at2);
  }, LONG);
});

describe('Criterion 7: current changes ground motion only', () => {
  /** Wind defined over the water: wind over ground = wind over water + current. */
  function envWithCurrent(rateKn: number, setDeg: number): Environment {
    const c = { n: rateKn * KN * Math.cos(setDeg * DEG), e: rateKn * KN * Math.sin(setDeg * DEG) };
    const w = windVelocity(10 * KN, 0);
    return { label: 'test', wind: () => ({ n: w.n + c.n, e: w.e + c.e }), current: () => c };
  }

  it('STW identical, SOG = |V_water + C|, track offset = C·t', () => {
    const run = (env: Environment) => {
      const sim = sailingSim({ twaDeg: 60, env, optimise: false, input: { autoMain: true, autoJib: true } });
      const samples: BoatSnapshot[] = [];
      for (let i = 0; i < 300; i++) {
        sim.advance(1);
        samples.push(sim.snapshot());
      }
      return samples;
    };
    const still = run(envWithCurrent(0, 0));
    for (const set of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const moving = run(envWithCurrent(1.5, set));
      let maxStw = 0;
      for (let i = 0; i < still.length; i++) maxStw = Math.max(maxStw, Math.abs(toKn(moving[i]!.stw - still[i]!.stw)));
      expect(maxStw).toBeLessThan(1e-6);
      const last = moving[moving.length - 1]!;
      const c = last.current;
      const vw = { n: last.u * Math.cos(last.heading) - last.v * Math.sin(last.heading), e: last.u * Math.sin(last.heading) + last.v * Math.cos(last.heading) };
      expect(Math.abs(last.sog - Math.hypot(vw.n + c.n, vw.e + c.e))).toBeLessThan(1e-9);
      const ref = still[still.length - 1]!;
      expect(Math.abs(last.n - ref.n - c.n * 300)).toBeLessThan(0.01);
      expect(Math.abs(last.e - ref.e - c.e * 300)).toBeLessThan(0.01);
    }
  }, LONG);
});

describe('Criterion 8: the boat cannot sail into the wind', () => {
  // Captive test rig: heading locked (yaw frozen), surge and sway free, sheets at max drive.
  for (const tws of [6, 10, 15, 20]) {
    it(`TWS ${tws} kn: no forward progress within 15° of the wind`, () => {
      for (const start of [0, 5]) {
        for (const twa of [0, 5, 10, 15]) {
          const sim = sailingSim({ twsKn: tws, twaDeg: twa, startKn: start, hold: false, lockHeading: true });
          sim.advance(180);
          expect(toKn(sim.state.u)).toBeLessThan(0.3);
        }
      }
    }, LONG);
  }

  it('reports the minimum TWA with positive steady speed (model output, not validated)', () => {
    const minTwa = (startKn: number): number => {
      for (let twa = 10; twa <= 60; twa += 1) {
        const sim = sailingSim({ twsKn: 10, twaDeg: twa, startKn, hold: false, lockHeading: true });
        sim.advance(150);
        if (toKn(sim.state.u) > 0.3) return twa;
      }
      return NaN;
    };
    const fromRest = minTwa(0);
    const withWay = minTwa(5);
    console.info(`[model output] minimum heading TWA with steady forward speed at 10 kn: from rest ${fromRest}°, with way on ${withWay}°`);
    expect(fromRest).toBeGreaterThan(15);
    expect(withWay).toBeGreaterThan(15);
  }, LONG);
});

describe('Criterion 11: same inputs give the same result', () => {
  const scripted = determinismSim;

  it('600 s scripted run with tacks, gybe, current and sheet changes is bit-identical', () => {
    const a = scripted();
    a.advance(600);
    const b = scripted();
    b.advance(600);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.inputLog.length).toBeGreaterThan(10);
    expect(a.inputLog).toEqual(b.inputLog);
    // Sanity: the run actually went somewhere and tacked/gybed.
    expect(Math.hypot(a.state.n, a.state.e)).toBeGreaterThan(300);
  }, LONG);
});
