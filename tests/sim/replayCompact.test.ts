import { describe, expect, it } from 'vitest';
import {
  decodeInputs,
  decodeInputsCompact,
  encodeInputs,
  encodeInputsCompact,
  INPUT_GRID,
  parseRecording,
  quantiseInput,
  recordingLog,
  recordingRows,
  REPLAY_SCHEMA,
  REPLAY_SCHEMA_COMPACT,
  REPLAY_SCHEMA_SAIL_CONTROLS,
  replacingInput,
  rowRecording,
  type Recording,
} from '../../src/app/replay';
import { SimController, type AppScenario } from '../../src/app/controller';
import type { ControlInput, InputLogEntry } from '../../src/sim/simulation';

/**
 * Compact replay inputs (package C, review #12, issue 214): the player's controls on a grid of thousandths, the log written
 * as deltas of only what changed (schema /4), decoded to exactly the inputs sailed; every older schema still reads and
 * replays; a control handed back to its default replays as handed back.
 */

const FREE: AppScenario = {
  conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 225 }, gusts: { preset: 'shifty', seed: 9 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 0,
  startSpeedKn: 3,
};

/** On the grid: decoding k / INPUT_GRID gives this very value back. */
const onGrid = (v: number) => Math.round(v * INPUT_GRID) / INPUT_GRID === v;

const BASE: ControlInput = { helm: 0, mainSheet: 0.3, jibSheet: 0.3, crewHike: 0.6, autoMain: false, autoJib: true, autoCrew: true };

/** A seeded generator (no Math.random in tests). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random input log on the grid, using every control and handing optional ones back (undefined) at times. */
function randomLog(seed: number, n: number): InputLogEntry[] {
  const r = rng(seed);
  const g = (lo: number) => Math.round((lo + (1 - lo) * r()) * INPUT_GRID) / INPUT_GRID;
  const log: InputLogEntry[] = [];
  let input: ControlInput = { ...BASE };
  let step = 0;
  let spin = 0;
  for (let i = 0; i < n; i++) {
    const next: ControlInput = { ...input };
    const k = Math.floor(r() * 12);
    if (k === 0) next.helm = g(-1);
    else if (k === 1) next.mainSheet = g(0);
    else if (k === 2) next.jibSheet = g(0);
    else if (k === 3) next.crewHike = g(0);
    else if (k === 4) next.autoMain = !next.autoMain;
    else if (k === 5) next.flatten = g(0);
    else if (k === 6) next.spin = ++spin;
    else if (k === 7) next.autoSpin = r() < 0.5 ? false : r() < 0.5 ? true : undefined;
    else if (k === 8) next.spinSheet = r() < 0.3 ? undefined : g(0);
    else if (k === 9) next.kicker = r() < 0.3 ? undefined : g(0);
    else if (k === 10) next.jibLead = r() < 0.3 ? undefined : g(-1);
    else next.plug = (next.plug ?? 0) + 1;
    step += 1 + Math.floor(r() * 40);
    log.push({ step, input: next });
    input = next;
  }
  return log;
}

/** Inputs compared as the simulation sees them: a control set to undefined is the same as one not there. */
const plain = (log: readonly InputLogEntry[]) => log.map(({ step, input }) => ({ step, input: JSON.parse(JSON.stringify(input)) as ControlInput }));

describe('compact inputs (schema /4)', () => {
  it('decodes to exactly the inputs sailed, every control included (seeded property test, 20 logs)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const log = randomLog(seed, 300);
      const q = encodeInputsCompact(log);
      expect(q, `seed ${seed}`).toBeDefined();
      expect(plain(decodeInputsCompact(q!))).toEqual(plain(log));
      // Small integers only.
      expect(q!.every((x) => Number.isInteger(x) && Math.abs(x) <= 1 << 14)).toBe(true);
    }
  });

  it('only what changed is written: one row of three numbers for a helm change', () => {
    const log: InputLogEntry[] = [
      { step: 0, input: { ...BASE } },
      { step: 7, input: { ...BASE, helm: 0.25 } },
    ];
    const q = encodeInputsCompact(log)!;
    // [0, mask, mainSheet, jibSheet, crewHike, flags] then [7, helm bit, 250].
    expect(q.slice(-3)).toEqual([7, 1, 250]);
    expect(decodeInputsCompact(q)).toEqual(log);
  });

  it('a value off the grid is not written compact (the recording keeps the row form)', () => {
    expect(encodeInputsCompact([{ step: 0, input: { ...BASE, helm: 0.1234567 } }])).toBeUndefined();
    expect(encodeInputsCompact([{ step: 0, input: { ...BASE, helm: quantiseInput({ helm: 0.1234567 }).helm } }])).toBeDefined();
  });

  it('quantiseInput puts every control on the grid and leaves flags and counts alone', () => {
    const q = quantiseInput({ helm: 0.123456, mainSheet: 1 / 3, spin: 2, autoMain: true, jibLead: -0.7777 });
    for (const v of [q.helm!, q.mainSheet!, q.jibLead!]) expect(onGrid(v)).toBe(true);
    expect(Math.abs(q.helm! - 0.123456)).toBeLessThanOrEqual(0.5 / INPUT_GRID);
    expect(q).toMatchObject({ spin: 2, autoMain: true });
    // Already on the grid: the same object back (no allocation in the per-step path).
    const on = { helm: 0.5 };
    expect(quantiseInput(on)).toBe(on);
  });

  it('a malformed compact list is refused with a reason', () => {
    const base = { schema: REPLAY_SCHEMA_COMPACT, scenario: FREE, checkpoints: [], endStep: 10, dart: 'none' };
    expect(parseRecording({ ...base, inputsQ: [0, 1, 512] }).inputsQ).toHaveLength(3);
    expect(() => parseRecording({ ...base })).toThrow(/compact inputs/);
    expect(() => parseRecording({ ...base, inputsQ: [0, 1, 0.5] })).toThrow(/compact inputs/);
    expect(() => parseRecording({ ...base, inputsQ: [0, 1] })).toThrow(/bad compact input value/);
    expect(() => parseRecording({ ...base, inputsQ: [-1, 0] })).toThrow(/bad compact input row/);
    expect(() => parseRecording({ ...base, inputsQ: [0, 1 << 20] })).toThrow(/bad compact input row/);
  });

  it('the older schemas still parse, and read the same inputs through recordingLog and recordingRows', () => {
    const log = randomLog(5, 50).map(({ step, input }) => ({ step, input: { ...BASE, helm: input.helm, mainSheet: input.mainSheet, autoMain: input.autoMain } }));
    const rows = encodeInputs(log);
    const v1 = parseRecording({ schema: REPLAY_SCHEMA, scenario: FREE, inputs: rows, checkpoints: [], endStep: 2000, dart: 'none' });
    const v4 = parseRecording({ schema: REPLAY_SCHEMA_COMPACT, scenario: FREE, inputsQ: encodeInputsCompact(log), checkpoints: [], endStep: 2000, dart: 'none' });
    expect(recordingLog(v1)).toEqual(decodeInputs(rows));
    expect(plain(recordingLog(v4))).toEqual(plain(recordingLog(v1)));
    expect(recordingRows(v4)).toEqual(rows);
  });
});

describe('compact replays in the app', () => {
  /** Keys, the gamepad-style helm drag and a sail control, for half a minute. */
  function sail(c: SimController): void {
    c.press('helmRight', true);
    c.advance(2);
    c.press('helmRight', false);
    c.setHelmDrag(0.37);
    c.advance(3);
    c.setHelmDrag(undefined);
    c.press('mainIn', true);
    c.advance(1.5);
    c.press('mainIn', false);
    c.advance(4);
    c.press('helmLeft', true);
    c.advance(3);
    c.press('helmLeft', false);
    c.advance(12.2);
  }

  function replays(rec: Recording): void {
    const p = new SimController();
    expect(p.startReplay(JSON.parse(JSON.stringify(rec)))).toBe(true);
    p.advance(rec.endStep * 0.01 + 1);
    const st = p.getState().replay!;
    expect(st.state).toBe('ended');
    expect(st.checkpointsMatched).toBe(st.checkpointsTotal);
    expect(p.stateHash()).toBe(rec.checkpoints.at(-1)![1]);
  }

  it('a run is saved compact (/4), every input of it on the grid, and plays back bit for bit; its row form (/1) too', () => {
    const c = new SimController();
    expect(c.restart(FREE)).toBe(true);
    sail(c);
    for (const { input } of c.sim.inputLog.slice(1)) for (const k of ['helm', 'mainSheet', 'jibSheet', 'crewHike'] as const) expect(onGrid(input[k]), `${k} ${input[k]}`).toBe(true);
    const rec = c.saveRecording('compact');
    expect(rec.schema).toBe(REPLAY_SCHEMA_COMPACT);
    expect(rec.inputs).toBeUndefined();
    expect(plain(recordingLog(rec))).toEqual(plain(c.sim.inputLog));
    replays(rec);
    const old = rowRecording(rec);
    expect(old.schema).toBe(REPLAY_SCHEMA);
    expect(old.inputsQ).toBeUndefined();
    replays(old);
    // Smaller than the row form.
    expect(JSON.stringify(rec).length).toBeLessThan(JSON.stringify(old).length);
  });

  it('a kicker set by hand and handed back to the Flat control replays as handed back (both forms)', () => {
    const c = new SimController();
    c.restart(FREE);
    c.advance(2);
    c.setSailControl('kicker', 0.9);
    c.setSailControl('jibLead', 0.5);
    c.advance(4);
    c.setSailControl('kicker', null);
    c.setSailControl('jibLead', 0);
    c.advance(14);
    expect(c.sim.input.kicker).toBeUndefined();
    const rec = c.saveRecording('handed back');
    replays(rec);
    const old = rowRecording(rec);
    expect(old.schema).toBe(REPLAY_SCHEMA_SAIL_CONTROLS);
    replays(old);
  });

  it('a held sheet key keeps its rate on the grid (0.35 of the travel a second), not 0.4 from rounding each step', () => {
    const c = new SimController();
    c.restart(FREE);
    c.press('mainOut', true);
    c.advance(0.01);
    const s0 = c.sim.input.mainSheet;
    c.advance(1);
    c.press('mainOut', false);
    // Two values on the grid: within a step (and a rounding error of the arithmetic) of the exact 0.35.
    expect(Math.abs(c.sim.input.mainSheet - s0 - 0.35)).toBeLessThanOrEqual(1 / INPUT_GRID + 1e-9);
    expect(onGrid(c.sim.input.mainSheet)).toBe(true);
  });

  it('replacingInput hands back every optional control the recorded input does not have', () => {
    const r = replacingInput({ ...BASE });
    for (const k of ['flatten', 'spin', 'spinGybe', 'autoSpin', 'spinSheet', 'kicker', 'cunningham', 'outhaul', 'jibLead', 'plug']) {
      expect(k in r).toBe(true);
      expect((r as Record<string, unknown>)[k]).toBeUndefined();
    }
    expect(replacingInput({ ...BASE, kicker: 0.5 }).kicker).toBe(0.5);
  });
});
