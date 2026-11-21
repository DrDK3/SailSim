import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';
import { encodeInputs, encodeInputsCompact, quantiseInput } from '../../src/app/replay';
import { createRace } from '../../src/sim/race/setup';
import { practiceCourse } from '../../src/sim/course/practice';
import type { InputLogEntry } from '../../src/sim/simulation';

/**
 * Replay sizes (package C, review #12, issue 214): a keyboard sailor, a game controller's stick moving every frame and
 * an AI-style helm changing every step, written in the row form and in the compact form (schema /4).
 *
 * By default each sails one minute, and the compact form must be at least half the size of the row form of the same
 * (already quantised) log, compressed. The figures in
 * docs/NEXT_ROUND_REPORT.md §C.4 are for ten minutes: `REPLAY_SIZES=1 npx vitest run tests/sim/replaySizes.test.ts`
 * sails ten and prints the table.
 */
const FULL = !!process.env.REPLAY_SIZES;
const MINUTES = FULL ? 10 : 1;

const SCN = {
  ...DEFAULT_SCENARIO,
  conditions: { ...DEFAULT_SCENARIO.conditions, gusts: { preset: 'shifty' as const, seed: 4 }, current: { mode: 'none' as const } },
  startLocation: 'start-bay-practice' as const,
  startHeadingDeg: 170,
  startSpeedKn: 3,
};

interface Size {
  rows: number;
  rowsJson: number;
  rowsDeflate: number;
  compactJson: number;
  compactDeflate: number;
}

function size(name: string, log: readonly InputLogEntry[]): Size {
  const rows = JSON.stringify(encodeInputs(log));
  const q = encodeInputsCompact(log);
  expect(q, `${name}: every input on the grid`).toBeDefined();
  const compact = JSON.stringify(q);
  const s = { rows: log.length, rowsJson: rows.length, rowsDeflate: deflateRawSync(rows).length, compactJson: compact.length, compactDeflate: deflateRawSync(compact).length };
  if (FULL) console.log(`${name.padEnd(9)} ${MINUTES} min: ${s.rows} changes; rows ${s.rowsJson} B JSON, ${s.rowsDeflate} B deflate; compact ${s.compactJson} B JSON, ${s.compactDeflate} B deflate`);
  return s;
}

describe(`replay sizes, ${MINUTES} minute(s) of sailing`, () => {
  it('keyboard: a key held for 1.2 s every 5 s', () => {
    const c = new SimController();
    c.restart(structuredClone(SCN));
    c.setInput({ autoMain: false, autoJib: true, autoCrew: true });
    for (let k = 0; k < 12 * MINUTES; k++) {
      const key = ['helmLeft', 'helmRight', 'mainIn', 'mainOut'][k % 4]!;
      c.press(key, true);
      c.advance(1.2);
      c.press(key, false);
      c.advance(3.8);
    }
    const s = size('keyboard', c.sim.inputLog);
    expect(s.compactDeflate * 2).toBeLessThan(s.rowsDeflate);
  }, 600_000);

  it('game controller: the stick moving every frame', () => {
    const c = new SimController();
    c.restart(structuredClone(SCN));
    c.setInput({ autoMain: true, autoJib: true, autoCrew: true });
    for (let f = 0; f < 60 * 60 * MINUTES; f++) {
      c.setHelmDrag(0.6 * Math.sin(f / 90) + 0.2 * Math.sin(f / 17));
      c.advance(1 / 60);
    }
    const s = size('stick', c.sim.inputLog);
    expect(s.compactDeflate * 2).toBeLessThan(s.rowsDeflate);
  }, 600_000);

  it('an AI-style helm changing every step (an AI boat in a race, its inputs on the player grid)', () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: 0 }, windFromDeg: 225, startLineM: 120 });
    const { session } = createRace({ conditions: SCN.conditions, course, aiCount: 1, level: 'good', seed: 3, committee: { startAt: 60, sequence: 'one-minute' } });
    const ai = session.fleet.boats[0]!;
    const log: InputLogEntry[] = [];
    const own = ai.sim.controller!;
    let last = '';
    ai.sim.controller = (s) => {
      const out = own(s);
      const inp = quantiseInput({ ...s.input, ...(out ?? {}) });
      const key = JSON.stringify(inp);
      if (key !== last) {
        log.push({ step: s.step, input: inp });
        last = key;
      }
      return out;
    };
    for (let i = 0; i < 6000 * MINUTES; i++) session.step();
    const s = size('AI helm', log);
    expect(s.compactDeflate * 2).toBeLessThan(s.rowsDeflate);
  }, 600_000);
});
