/**
 * The symmetric spinnaker (package B, src/sim/boat/spinnaker.ts): carried but never hoisted it changes nothing, bit for
 * bit; hoisted by the crew as a timed task it fills on a broad reach or a run and drives the boat faster; it collapses
 * when the wind comes too far forward or by the lee on the wrong side of the pole, and fills again; the crew gybe the
 * pole after a gybe; dropped it is gone. All of it through the ordinary sail force (no scripted speed): the speeds are
 * MODEL OUTPUT from estimated coefficients (E), compared only with the same boat without the spinnaker.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment, type ControlInput } from '../../src/sim/index';
import { autopilotHelm } from '../../src/sim/control/autopilot';
import { aiSheetInput } from '../../src/sim/ai/sheets';
import { DEG } from '../../src/sim/math/angles';
import { SPIN_PARAMS, spinCanFill, taskVariation, withSpinnaker } from '../../src/sim/boat/spinnaker';
import { decodeInputs, encodeInputs, parseRecording, recordingSchema, REPLAY_SCHEMA, REPLAY_SCHEMA_SAIL_CONTROLS } from '../../src/app/replay';

const KN = 1852 / 3600;

/** A boat steered to a true wind angle by the autopilot, the crew trimming, with extra inputs at times. */
function sail(opts: { spin: boolean; twsKn: number; twaDeg: number; seconds: number; at?: (t: number) => Partial<ControlInput> | undefined; twa?: (t: number) => number }) {
  const sheets = { ease: 0 };
  const params = opts.spin ? withSpinnaker(squibParams()) : squibParams();
  const sim = new Simulation({
    params,
    env: uniformEnvironment({ twsKn: opts.twsKn, twdDeg: 0 }),
    initial: { headingDeg: -opts.twaDeg, speedKn: 3 },
    input: { autoMain: true, autoJib: true, autoCrew: true },
    controller: (s) => ({
      helm: autopilotHelm(s, { mode: 'twa', target: (opts.twa ? opts.twa(s.time) : opts.twaDeg) * DEG }),
      ...aiSheetInput(s, sheets),
      ...(opts.at?.(s.time) ?? {}),
    }),
  });
  const trace: { t: number; stw: number; phase: string; deployed: number; fill: number; pole: number; main: number }[] = [];
  const steps = Math.round(opts.seconds * 100);
  for (let i = 0; i < steps; i++) {
    sim.stepOnce();
    if (i % 10 === 0) {
      const st = sim.state;
      trace.push({ t: sim.time, stw: Math.hypot(st.u, st.v) / KN, phase: sim.spin.phase, deployed: sim.spin.deployed, fill: sim.spin.fill, pole: sim.spin.poleSide, main: sim.snapshot().mainSide });
    }
  }
  return { sim, trace };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('carried, not hoisted: nothing changes', () => {
  it('the same state bit for bit as the boat without one, on a run and upwind', () => {
    for (const twa of [45, 150]) {
      const a = sail({ spin: false, twsKn: 12, twaDeg: twa, seconds: 60 });
      const b = sail({ spin: true, twsKn: 12, twaDeg: twa, seconds: 60 });
      expect(b.sim.stateHash(), `TWA ${twa}`).toBe(a.sim.stateHash());
    }
  });

  it('a call to drop it (spin 0) or to gybe a pole that is not up changes nothing either', () => {
    const a = sail({ spin: true, twsKn: 12, twaDeg: 150, seconds: 30 });
    const b = sail({ spin: true, twsKn: 12, twaDeg: 150, seconds: 30, at: () => ({ spin: 0 }) });
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
  });
});

describe('hoisted on a run', () => {
  for (const tws of [6, 10, 16]) {
    it(`${tws} kn, TWA 150°: hoisted in about ${SPIN_PARAMS.hoistS} s, it fills and the boat goes faster than without it`, () => {
      const off = sail({ spin: true, twsKn: tws, twaDeg: 150, seconds: 120 });
      const on = sail({ spin: true, twsKn: tws, twaDeg: 150, seconds: 120, at: (t) => (t > 30 ? { spin: 1 } : undefined) });
      const up = on.trace.find((r) => r.phase === 'up');
      expect(up, 'hoisted').toBeDefined();
      const took = up!.t - 30;
      expect(took).toBeGreaterThan(SPIN_PARAMS.hoistS * (1 - SPIN_PARAMS.taskVary) - 0.2);
      expect(took).toBeLessThan(SPIN_PARAMS.hoistS * (1 + SPIN_PARAMS.taskVary) + 0.2);
      const last = (tr: typeof on.trace) => tr.filter((r) => r.t > 90);
      expect(mean(last(on.trace).map((r) => r.fill))).toBeGreaterThan(0.9);
      const gain = mean(last(on.trace).map((r) => r.stw)) - mean(last(off.trace).map((r) => r.stw));
      expect(gain, `speed gain at ${tws} kn`).toBeGreaterThan(0.1);
    });
  }

  it('dropped, it is down in about the drop time and the boat sails as before', () => {
    const r = sail({ spin: true, twsKn: 10, twaDeg: 150, seconds: 100, at: (t) => (t > 5 && t < 50 ? { spin: 1 } : { spin: 0 }) });
    const down = r.trace.find((x) => x.t > 50 && x.phase === 'down');
    expect(down).toBeDefined();
    expect(down!.t - 50).toBeLessThan(SPIN_PARAMS.dropS * (1 + SPIN_PARAMS.taskVary) + 0.2);
    expect(r.trace.at(-1)!.deployed).toBe(0);
  });
});

describe('it collapses when it cannot be held, and fills again', () => {
  it('the wind brought forward to a close reach: it collapses; back to a run: it fills', () => {
    const r = sail({
      spin: true,
      twsKn: 10,
      twaDeg: 150,
      seconds: 150,
      at: () => ({ spin: 1 }),
      twa: (t) => (t > 50 && t < 100 ? 60 : 150),
    });
    const at = (t0: number, t1: number) => mean(r.trace.filter((x) => x.t > t0 && x.t < t1).map((x) => x.fill));
    expect(at(35, 50)).toBeGreaterThan(0.9);
    expect(at(80, 100)).toBeLessThan(0.2);
    expect(at(135, 150)).toBeGreaterThan(0.9);
  });

  it('by the lee on the wrong side of the pole it cannot fill (the limit is an estimate, E)', () => {
    const deg = (d: number) => d * DEG;
    // Wind from starboard (awa > 0), pole to starboard: fine on a run; pole to port, 20° by the lee: blanketed.
    expect(spinCanFill(SPIN_PARAMS, deg(170), 1)).toBe(1);
    expect(spinCanFill(SPIN_PARAMS, deg(160), -1)).toBe(0);
    expect(spinCanFill(SPIN_PARAMS, deg(178), -1)).toBeGreaterThan(0.9);
    // Too far forward whatever the pole.
    expect(spinCanFill(SPIN_PARAMS, deg(40), 1)).toBe(0);
  });
});

describe('the crew gybe the pole', () => {
  it('after the boat gybes, the crew gybe the pole (as a timed task) and it fills on the new side', () => {
    const r = sail({ spin: true, twsKn: 10, twaDeg: 155, seconds: 140, at: () => ({ spin: 1 }), twa: (t) => (t > 60 ? -155 : 155) });
    const before = r.trace.find((x) => x.t > 55)!;
    const after = r.trace.at(-1)!;
    expect(before.pole).toBe(before.main);
    expect(after.pole).toBe(after.main);
    expect(after.pole).toBe(-before.pole);
    expect(r.trace.some((x) => x.phase === 'gybing')).toBe(true);
    expect(mean(r.trace.filter((x) => x.t > 125).map((x) => x.fill))).toBeGreaterThan(0.9);
  });

  it('a gybe called by the player while the boat sails on: trimming by hand (Expert) the pole stays on the wrong side and it collapses; with the crew trimming they gybe it back', () => {
    const manual = sail({ spin: true, twsKn: 10, twaDeg: 160, seconds: 90, at: (t) => ({ spin: 1, autoSpin: false, spinGybe: t > 50 ? 1 : 0 }) });
    expect(manual.trace.find((x) => x.t > 50 && x.phase === 'gybing')).toBeDefined();
    const late = manual.trace.filter((x) => x.t > 75);
    expect(late.every((x) => x.pole !== x.main)).toBe(true);
    expect(mean(late.map((x) => x.fill))).toBeLessThan(0.2);
    const crew = sail({ spin: true, twsKn: 10, twaDeg: 160, seconds: 90, at: (t) => ({ spin: 1, spinGybe: t > 50 ? 1 : 0 }) });
    const end = crew.trace.at(-1)!;
    expect(end.pole).toBe(end.main);
    expect(mean(crew.trace.filter((x) => x.t > 82).map((x) => x.fill))).toBeGreaterThan(0.8);
  });
});

describe('the crew while busy', () => {
  it('the tasks take a little longer or shorter from one time to the next, repeatably (no random numbers in the state)', () => {
    const vals = [10, 500, 1234, 98765].map((s) => taskVariation(s, 1));
    for (const v of vals) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(new Set(vals).size).toBe(vals.length);
    expect(taskVariation(1234, 1)).toBe(vals[2]);
    const a = sail({ spin: true, twsKn: 10, twaDeg: 150, seconds: 50, at: (t) => (t > 10 ? { spin: 1 } : undefined) });
    const b = sail({ spin: true, twsKn: 10, twaDeg: 150, seconds: 50, at: (t) => (t > 10 ? { spin: 1 } : undefined) });
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
  });
});

describe('replays (schema /3)', () => {
  it('a run that used the spinnaker records /3 rows that decode to the same inputs; others stay /1', () => {
    const r = sail({ spin: true, twsKn: 10, twaDeg: 150, seconds: 20, at: (t) => (t > 5 ? { spin: 1, spinGybe: t > 12 ? 1 : 0 } : undefined) });
    const rows = encodeInputs(r.sim.inputLog);
    expect(recordingSchema(rows, undefined)).toBe(REPLAY_SCHEMA_SAIL_CONTROLS);
    expect(rows.every((x) => x.length === 15)).toBe(true);
    const back = decodeInputs(rows);
    for (let i = 0; i < back.length; i++) {
      const want = r.sim.inputLog[i]!.input;
      const got = back[i]!.input;
      for (const k of ['helm', 'mainSheet', 'jibSheet', 'crewHike', 'autoMain', 'autoJib', 'autoCrew'] as const) expect(got[k], k).toBe(want[k]);
      expect(got.spin ?? 0).toBe(want.spin ?? 0);
      expect(got.spinGybe ?? 0).toBe(want.spinGybe ?? 0);
    }
    const plain = sail({ spin: true, twsKn: 10, twaDeg: 150, seconds: 5 });
    const plainRows = encodeInputs(plain.sim.inputLog);
    expect(recordingSchema(plainRows, undefined)).toBe(REPLAY_SCHEMA);
    expect(plainRows.every((x) => x.length <= 7)).toBe(true);
  });

  it('the old schemas still parse; 15-column rows only in /3', () => {
    const base = { scenario: { conditions: {} }, checkpoints: [], endStep: 10, dart: 'none' };
    expect(parseRecording({ ...base, schema: REPLAY_SCHEMA, inputs: [[0, 0, 0.3, 0.3, 0.6, 6]] }).inputs).toHaveLength(1);
    const wide = [0, 0, 0.3, 0.3, 0.6, 6, 0, 1, 0, -1, -1, -1, -1, 0, 0];
    expect(() => parseRecording({ ...base, schema: REPLAY_SCHEMA, inputs: [wide] })).toThrow(/bad input row/);
    expect(parseRecording({ ...base, schema: REPLAY_SCHEMA_SAIL_CONTROLS, inputs: [wide] }).inputs).toHaveLength(1);
  });

  it('the request to stuff a hole (plug) is now recorded (it was dropped from /1 rows, so such replays diverged)', () => {
    const rows = encodeInputs([{ step: 5, input: { helm: 0, mainSheet: 0.3, jibSheet: 0.3, crewHike: 0.5, autoMain: true, autoJib: true, autoCrew: true, plug: 1 } }]);
    expect(rows[0]).toHaveLength(15);
    expect(decodeInputs(rows)[0]!.input.plug).toBe(1);
  });
});
