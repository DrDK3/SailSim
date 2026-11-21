/**
 * Physics-trust checks for the training slice (docs/TRAINING_SLICE_REPORT.md §2). Each establishes NUMERICAL
 * CORRECTNESS or PHYSICAL PLAUSIBILITY (direction and order of size) only; none establishes calibration (the
 * coefficients are estimates, L5; review PH-1).
 *
 *  1. Frame-rate independence: the app's frame loop at 60 fps, 24 fps and irregular frames with long ones, then
 *     topped up to the same step count, gives the same state bit for bit (same engine). [numerical]
 *  2. Reproducibility: the same seed and inputs give the same state hash; a different gust seed does not. [numerical]
 *  3. Reference frames: a boat in a 1 kn current with the true wind W sails, through the water, exactly as a boat in
 *     still water with the wind W − current; heading, course over ground, STW and SOG stay distinct. [numerical]
 *  4. Through a tack: steering authority falls with speed, holding the rudder hard over slows the boat more than
 *     sailing straight, and a tack loses speed. [plausibility: direction and order of size only]
 *  5. AI parity: an AI boat acts only through the controls (its recorded inputs, fed to a plain simulation, give the
 *     same track bit for bit) with the same boat parameters as the player's. [numerical]
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';
import { Simulation, squibParams, uniformEnvironment, type ControlInput } from '../../src/sim/index';
import { buildConditions } from '../../src/sim/env/conditions';
import { createRace } from '../../src/sim/race/setup';
import { practiceCourse } from '../../src/sim/course/practice';
import { DT } from '../../src/sim/simulation';
import { withSpinnaker } from '../../src/sim/boat/spinnaker';

const KN = 1852 / 3600;
const R2D = 180 / Math.PI;
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

/** A free sail in open water with shifty gusts (so the environment's state matters too), no stream. */
const SCN = {
  ...DEFAULT_SCENARIO,
  conditions: { ...DEFAULT_SCENARIO.conditions, gusts: { preset: 'shifty' as const, seed: 7 }, current: { mode: 'none' as const } },
  startLocation: 'start-bay-practice' as const,
  startHeadingDeg: 180,
  startSpeedKn: 3,
};

describe('1. frame-rate independence (the app loop, same engine)', () => {
  it('60 fps, 24 fps and irregular frames with long ones reach the same state at the same step', () => {
    const N = 3000;
    const run = (frames: (i: number) => number) => {
      const c = new SimController();
      expect(c.restart(structuredClone(SCN))).toBe(true);
      const frame = (c as unknown as { frame(now: number): void }).frame.bind(c);
      const priv = c as unknown as { lastFrame: number; paused: boolean };
      priv.paused = false;
      let now = 1000;
      priv.lastFrame = now;
      // The helm held to starboard throughout (an input that changes at a frame boundary would land on a different
      // step at each frame rate, which is a different input, not a different physics).
      c.press('helmRight', true);
      let i = 0;
      // Frames until just short of N steps (a frame advances by at most 12 steps).
      while (c.sim.step < N - 12) {
        now += frames(i++) * 1000;
        frame(now);
      }
      // Top up to exactly N steps with the test hook (held controls still apply).
      c.advance((N - c.sim.step) * DT);
      c.press('helmRight', false);
      expect(c.sim.step).toBe(N);
      return c.sim.stateHash();
    };
    const at60 = run(() => 1 / 60);
    const at24 = run(() => 1 / 24);
    // Irregular, with long frames (0.25 s and 1 s are clamped to 0.1 s by the loop: simulated time is dropped, not the
    // physics changed).
    const irregular = run((i) => [0.016, 0.033, 0.25, 0.007, 1.0, 0.05][i % 6]!);
    expect(at24).toBe(at60);
    expect(irregular).toBe(at60);
  });
});

describe('2. reproducibility (same engine)', () => {
  it('the same seed and inputs give the same hash; another gust seed gives another', () => {
    const go = (seed: number) => {
      const c = new SimController();
      c.restart({ ...structuredClone(SCN), conditions: { ...SCN.conditions, gusts: { preset: 'shifty', seed } } });
      c.press('helmLeft', true);
      c.advance(8);
      c.press('helmLeft', false);
      c.advance(30);
      return c.sim.stateHash();
    };
    expect(go(7)).toBe(go(7));
    expect(go(8)).not.toBe(go(7));
  });
});

describe('3. reference frames: wind, current, heading, COG, STW and SOG', () => {
  it('a boat in a 1 kn current sails through the water as a boat in still water with the wind minus the current', () => {
    const tws = 10;
    const twd = 225;
    const cur = { setDeg: 90, rateKn: 1 };
    // Wind relative to the water: W − C (vectors where the air and water go to).
    const w = { n: -tws * Math.cos(twd / R2D), e: -tws * Math.sin(twd / R2D) };
    const c = { n: cur.rateKn * Math.cos(cur.setDeg / R2D), e: cur.rateKn * Math.sin(cur.setDeg / R2D) };
    const rel = { n: w.n - c.n, e: w.e - c.e };
    const relTws = Math.hypot(rel.n, rel.e);
    const relFrom = (Math.atan2(-rel.e, -rel.n) * R2D + 360) % 360;
    const input: Partial<ControlInput> = { helm: 0, autoMain: true, autoJib: true, autoCrew: true };
    const mk = (env: ReturnType<typeof uniformEnvironment>) => new Simulation({ params: squibParams(), env, initial: { headingDeg: 150, speedKn: 4 }, input });
    const inCurrent = mk(uniformEnvironment({ twsKn: tws, twdDeg: twd, currentSetDeg: cur.setDeg, currentRateKn: cur.rateKn }));
    const still = mk(uniformEnvironment({ twsKn: relTws, twdDeg: relFrom }));
    for (let i = 0; i < 6000; i++) {
      inCurrent.stepOnce();
      still.stepOnce();
    }
    const a = inCurrent.snapshot();
    const b = still.snapshot();
    // Through the water: the same boat (to rounding).
    expect(Math.abs(a.stw - b.stw)).toBeLessThan(1e-6);
    expect(Math.abs(a.heading - b.heading)).toBeLessThan(1e-6);
    expect(Math.abs(a.heel - b.heel)).toBeLessThan(1e-6);
    expect(Math.abs(a.awa - b.awa)).toBeLessThan(1e-6);
    // Over the ground: displaced by the current (60 s × 1 kn east).
    expect(a.e - b.e).toBeCloseTo(60 * KN, 3);
    expect(Math.abs(a.n - b.n)).toBeLessThan(1e-3);
    // Heading and COG differ (leeway and the stream); the velocity over the ground is the velocity through the water
    // (body u, v turned by the heading) plus the current, exactly.
    expect(Math.abs(a.cog - a.heading) * R2D).toBeGreaterThan(1);
    const st = inCurrent.state;
    const through = { n: st.u * Math.cos(st.psi) - st.v * Math.sin(st.psi), e: st.u * Math.sin(st.psi) + st.v * Math.cos(st.psi) };
    const ground = { n: a.sog * Math.cos(a.cog), e: a.sog * Math.sin(a.cog) };
    expect(ground.n - through.n).toBeCloseTo(c.n * KN, 9);
    expect(ground.e - through.e).toBeCloseTo(c.e * KN, 9);
  });
});

describe('4. through a tack (plausibility: direction and order of size)', () => {
  const sailAt = (kn: number, helm: number, seconds: number) => {
    const sim = new Simulation({ params: squibParams(), env: uniformEnvironment({ twsKn: 10, twdDeg: 0 }), initial: { headingDeg: 90, speedKn: kn }, input: { helm, autoMain: true, autoJib: true, autoCrew: true } });
    const h0 = sim.state.psi;
    for (let i = 0; i < seconds / DT; i++) sim.stepOnce();
    return { turned: Math.abs(sim.state.psi - h0) * R2D, stwKn: sim.state.u / KN };
  };

  it('steering authority falls with speed: the same helm turns the boat less in 2 s at 1 kn than at 4 kn', () => {
    const slow = sailAt(1, 0.6, 2).turned;
    const fast = sailAt(4, 0.6, 2).turned;
    expect(fast).toBeGreaterThan(slow * 1.5);
    // Order of size: tens of degrees in 2 s at 4 kn, not hundreds.
    expect(fast).toBeGreaterThan(5);
    expect(fast).toBeLessThan(120);
  });

  it('the rudder held hard over costs speed against the rudder centred (rudder drag and the turn)', () => {
    const straight = sailAt(4, 0, 6).stwKn;
    const hard = sailAt(4, 1, 6).stwKn;
    expect(hard).toBeLessThan(straight - 0.3);
  });

  it('a tack from close-hauled at 10 kn loses speed and recovers it (minimum between 25% and 90% of the speed going in)', () => {
    const sim = new Simulation({ params: squibParams(), env: uniformEnvironment({ twsKn: 10, twdDeg: 0 }), initial: { headingDeg: 45, speedKn: 4.5 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    for (let i = 0; i < 2000; i++) sim.stepOnce();
    const vin = sim.state.u;
    // Hard to port through the wind (from 45° to the close-hauled heading on the other tack, about 315°), then straight.
    sim.setInput({ helm: -1 });
    let min = vin;
    for (let i = 0; i < 1200; i++) {
      sim.stepOnce();
      min = Math.min(min, sim.state.u);
      const h = sim.state.psi * R2D;
      if (h > 300 && h < 320) sim.setInput({ helm: 0 });
    }
    sim.setInput({ helm: 0 });
    for (let i = 0; i < 3000; i++) sim.stepOnce();
    expect(min).toBeLessThan(0.9 * vin);
    expect(min).toBeGreaterThan(0.25 * vin);
    expect(sim.state.u).toBeGreaterThan(0.8 * vin);
  });
});

describe('5. AI parity', () => {
  it('an AI boat acts only through the controls: its own inputs, fed to a plain simulation, give the same track', () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: 0 }, windFromDeg: 225, startLineM: 120 });
    const conditions = { ...DEFAULT_SCENARIO.conditions, gusts: { preset: 'steady' as const, seed: 3 }, current: { mode: 'none' as const } };
    const { session } = createRace({ conditions, course, aiCount: 1, level: 'good', seed: 3, committee: { startAt: 60, sequence: 'one-minute' } });
    const ai = session.fleet.boats[0]!;
    const inputs: ControlInput[] = [];
    const own = ai.sim.controller!;
    ai.sim.controller = (s) => {
      const out = own(s);
      inputs.push({ ...s.input, ...(out ?? {}) });
      return out;
    };
    const init = { n: ai.sim.state.n, e: ai.sim.state.e, headingDeg: ai.sim.state.psi * R2D, speedKn: ai.sim.state.u / KN };
    // The controls as they were at the start (the replay starts there; the AI's input object changes as it sails).
    const startInput = { ...ai.sim.input };
    const { env } = buildConditions(conditions);
    for (let i = 0; i < 4000; i++) session.step();
    let k = 0;
    const plain = new Simulation({ params: squibParams(), env, initial: init, input: startInput, controller: () => inputs[k++] });
    // The plain simulation started from the AI's initial pose: replay the same number of steps.
    for (let i = 0; i < inputs.length; i++) plain.stepOnce();
    expect(Math.abs(plain.state.n - ai.sim.state.n)).toBeLessThan(1e-6);
    expect(Math.abs(plain.state.e - ai.sim.state.e)).toBeLessThan(1e-6);
    expect(ai.sim.params).toEqual(squibParams());
  });

  it('with spinnakers (package B): the AI calls for it through the same input as the player, and its inputs give the same track', () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: 0 }, windFromDeg: 225, startLineM: 120 });
    const conditions = { ...DEFAULT_SCENARIO.conditions, weather: { source: 'manual' as const, twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady' as const, seed: 3 }, current: { mode: 'none' as const } };
    const { session } = createRace({ conditions, course, aiCount: 1, level: 'good', seed: 3, spinnaker: true, committee: { startAt: 60, sequence: 'one-minute' } });
    const ai = session.fleet.boats[0]!;
    const inputs: ControlInput[] = [];
    const phases = new Set<string>();
    const own = ai.sim.controller!;
    ai.sim.controller = (s) => {
      const out = own(s);
      inputs.push({ ...s.input, ...(out ?? {}) });
      phases.add(s.spin.phase);
      return out;
    };
    const init = { n: ai.sim.state.n, e: ai.sim.state.e, headingDeg: ai.sim.state.psi * R2D, speedKn: ai.sim.state.u / KN };
    // The controls as they were at the start (the replay starts there; the AI's input object changes as it sails).
    const startInput = { ...ai.sim.input };
    const { env } = buildConditions(conditions);
    // Through the start, the beat and the run (about 12 minutes).
    for (let i = 0; i < 72_000 && session.judgeOf(ai.id).phase !== 'finished'; i++) session.step();
    // It hoisted on the run and dropped before the leeward mark.
    expect([...phases]).toEqual(expect.arrayContaining(['down', 'hoisting', 'up', 'dropping']));
    let k = 0;
    const plain = new Simulation({ params: withSpinnaker(squibParams()), env, initial: init, input: startInput, controller: () => inputs[k++] });
    for (let i = 0; i < inputs.length; i++) plain.stepOnce();
    expect(Math.abs(plain.state.n - ai.sim.state.n)).toBeLessThan(1e-6);
    expect(Math.abs(plain.state.e - ai.sim.state.e)).toBeLessThan(1e-6);
    // The same boat as the player's with the spinnaker aboard.
    expect(ai.sim.params).toEqual(withSpinnaker(squibParams()));
    // A whole race in the AI's hands (about 2.5 s alone; past the 5 s default under the full suite on a CI runner).
  }, 60_000);
});
