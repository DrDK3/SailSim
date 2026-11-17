/**
 * The sail status and its advice (training slice §6; issues 199 and 200, observations O2 and O3).
 *
 * Regression tests reproduce the audit's probe states (docs/TRAINING_SLICE_REPORT.md §3.1). The property test sweeps
 * seeded boat states and checks three rules for every sail in every state:
 *  1. never ask to ease or trim a sheet that is at its end stop;
 *  2. never ask to work a sheet auto-trim is setting (unless the advice also says to turn auto-trim off);
 *  3. never contradict the state shown: the label is the state's own name, a sheet key appears only with the
 *     matching action, drawing asks for nothing, luffing never eases, stalled never trims, by the lee is helm work.
 * What this establishes: the advice is actionable and consistent in the model's states. It does not establish that
 * the advice is good sailing teaching (an instructor's question: docs/VALIDATION_SHEET.md).
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment, type ControlInput } from '../../src/sim/index';
import { autopilotHelm } from '../../src/sim/control/autopilot';
import { SHEET_END, sailAdvice, sailState, type SailState } from '../../src/app/sailStatus';
import { RaceCoach, type BriefingInput, type CoachSample } from '../../src/app/coach';
import { Polar } from '../../src/sim/ai/polar';
import { AI_POLAR } from '../../src/sim/ai/polarData';
import type { SailForce } from '../../src/sim/boat/forces';

const R2D = 180 / Math.PI;
const DEG = Math.PI / 180;
const KN = 1852 / 3600;
const KEYS = { main: { trim: 'W', ease: 'S' }, jib: { trim: 'E', ease: 'Q' } } as const;

/** Sail at a true wind angle (> 0: starboard tack) in steady wind, with the input applied after 10 s, for `seconds`. */
function sailAt(twaDeg: number, input: Partial<ControlInput>, opts: { twsKn?: number; seconds?: number; thenTwaDeg?: number } = {}): Simulation {
  const sim = new Simulation({ params: squibParams(), env: uniformEnvironment({ twsKn: opts.twsKn ?? 10, twdDeg: 0 }), initial: { headingDeg: -twaDeg, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const n = (opts.seconds ?? 40) * 100;
  for (let i = 0; i < n; i++) {
    const target = opts.thenTwaDeg !== undefined && i > n - 600 ? opts.thenTwaDeg : twaDeg;
    sim.setInput({ helm: autopilotHelm(sim, { mode: 'twa', target: target * DEG }), ...(i > 1000 ? input : {}) });
    sim.stepOnce();
  }
  return sim;
}

function read(sim: Simulation, sail: 'main' | 'jib') {
  const s = sim.snapshot(false);
  const f = s.forces[sail];
  const angle = sail === 'main' ? s.boomMain : s.boomJib;
  const state = sailState(f, angle);
  const ctx = { sail, sheet: sim.currentSheet(sail), auto: sail === 'main' ? s.input.autoMain : s.input.autoJib };
  return { f, angle, state, ctx, advice: sailAdvice(state, KEYS[sail], ctx) };
}

describe('issue 200 (O3): an over-sheeted main is stalled, not by the lee', () => {
  it('broad reach (TWA 136°) with the main sheeted to 23%: "Stalled: ease out (S)"', () => {
    const r = read(sailAt(136, { autoMain: false, mainSheet: 0.23 }), 'main');
    // The probe state: the airflow more than 90° onto the sail, the wind on the other side from the boom.
    expect(Math.abs(r.f.incidence) * R2D).toBeGreaterThan(90);
    expect(r.state).toBe('stalled');
    expect(r.advice).toMatchObject({ text: 'Stalled', advice: 'ease out (S)', action: 'ease' });
  });

  it('with the wind on the boom\'s side (by the lee in fact) it is still "By the lee: gybe risk"', () => {
    // Run on starboard (boom to port), then 8° by the lee: the boom stays out (the gybe threshold is 15°).
    const sim = sailAt(172, {}, { thenTwaDeg: -172, seconds: 46 });
    const r = read(sim, 'main');
    expect(sim.snapshot(false).boomMain).toBeGreaterThan(0);
    expect(r.state).toBe('by-the-lee');
    expect(r.advice).toMatchObject({ text: 'By the lee', advice: 'gybe risk: head up', action: 'helm' });
  });

  it('the side decides, for the same airflow angle (both sails)', () => {
    const f = { incidence: 100 * DEG, awa: 170 * DEG, luff: 1, stall: 1 } as SailForce;
    // Sail set to port (+), wind from starboard (+): over-sheeted.
    expect(sailState(f, 60 * DEG)).toBe('stalled');
    // Sail set to starboard (−), the same wind: the wind is behind the sail.
    expect(sailState(f, -60 * DEG)).toBe('by-the-lee');
    // The jib has no boom: its advice is about the jib crossing, not a gybe.
    expect(sailAdvice('by-the-lee', KEYS.jib, { sail: 'jib', sheet: 1, auto: true }).advice).not.toMatch(/gybe/);
  });
});

describe('issue 199 (O2): the advice asks only for what can be done', () => {
  it('running (TWA 169°) with auto-trim: neither sail asks for easing or a gybe', () => {
    const sim = sailAt(169, {});
    for (const sail of ['main', 'jib'] as const) {
      const r = read(sim, sail);
      expect(r.ctx.sheet).toBeGreaterThan(1 - SHEET_END);
      expect(r.state).toBe('stalled');
      expect(r.advice.action).toBe('none');
      expect(r.advice.advice).not.toMatch(/ease out|gybe|\((S|Q)\)/);
    }
  });

  it('auto-trim on: no sheet key is asked for while the assist sets the sheet', () => {
    expect(sailAdvice('stalled', KEYS.main, { sail: 'main', sheet: 0.5, auto: true })).toMatchObject({ action: 'none' });
    expect(sailAdvice('luffing', KEYS.jib, { sail: 'jib', sheet: 0.5, auto: true })).toMatchObject({ action: 'none' });
  });

  it('luffing with the sheet hard in (pinching): bear away, not "trim in"', () => {
    const a = sailAdvice('luffing', KEYS.main, { sail: 'main', sheet: 0, auto: false });
    expect(a.action).toBe('helm');
    expect(a.advice).toMatch(/bear away/);
    expect(a.advice).not.toMatch(/\(W\)/);
  });

  it('the race coach does not ask to ease a main already eased right out, nor count it as poor trim', () => {
    const base: BriefingInput = { twsKn: 10, twdDeg: 180, gusts: 'steady', line: { a: { n: 0, e: -50 }, b: { n: 0, e: 50 } }, endLabels: ['pin', 'committee boat'], firstMark: { n: -600, e: 0 }, sequence: 'three-minute', competitors: 3 };
    const run = (mainSheet: number) => {
      const c = new RaceCoach(base, new Polar(AI_POLAR));
      for (let t = 0; t <= 40; t += 0.5) {
        const s: CoachSample = {
          t, n: -100 - t, e: 0, stw: 5 * KN, vmg: -4 * KN, tws: 10 * KN, twd: 180 * DEG, twa: 170 * DEG, heel: 3 * DEG, rudderFrac: 0,
          mainLuff: 1, mainStall: 1, mainSheet, autoMain: false, flatten: 0,
          race: { phase: 'racing', toStart: -100, ocs: false, mark: { n: 600, e: 0 }, penaltyOwed: 0 },
        };
        c.update(s);
      }
      return c;
    };
    expect(run(1).recent.some((x) => x.id === 'stalled')).toBe(false);
    // Over-sheeted (the sheet can go out): the tip still comes.
    expect(run(0.3).recent.some((x) => x.id === 'stalled')).toBe(true);
  });
});

/** Seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABEL: Record<SailState, string> = { drawing: 'Drawing', luffing: 'Luffing', stalled: 'Stalled', 'by-the-lee': 'By the lee' };

describe('advice actionability (property, seeded sweep)', () => {
  it('over 120 seeded states, every sail obeys the three rules', () => {
    const r = rng(20261117);
    const pickSheet = () => {
      const u = r();
      return u < 0.15 ? 0 : u < 0.3 ? 1 : r();
    };
    const seen = new Set<string>();
    let checked = 0;
    for (let k = 0; k < 120; k++) {
      const twa = 20 + r() * 160;
      const byLee = twa > 165 && r() < 0.6;
      const input: Partial<ControlInput> = { autoMain: r() < 0.5, autoJib: r() < 0.5, mainSheet: pickSheet(), jibSheet: pickSheet() };
      const sim = sailAt(twa, input, { twsKn: 4 + r() * 14, seconds: 25, thenTwaDeg: byLee ? -twa : undefined });
      for (const sail of ['main', 'jib'] as const) {
        const { state, ctx, advice } = read(sim, sail);
        const keys = KEYS[sail];
        const where = `#${k} ${sail} twa ${twa.toFixed(0)} ${state} sheet ${ctx.sheet.toFixed(3)} auto ${ctx.auto}: "${advice.advice}"`;
        seen.add(`${state}/${advice.action}`);
        // 1. Never past an end stop.
        if (advice.action === 'ease') expect(ctx.sheet, where).toBeLessThan(1 - SHEET_END);
        if (advice.action === 'trim') expect(ctx.sheet, where).toBeGreaterThan(SHEET_END);
        // 2. Never a sheet the assist is setting (unless the advice says to turn auto-trim off).
        if (ctx.auto && (advice.action === 'ease' || advice.action === 'trim')) expect(advice.advice, where).toMatch(/auto-trim off/i);
        // 3. Never contradicting the state shown.
        expect(advice.text, where).toBe(LABEL[state]);
        const asksTrim = advice.advice.includes(`(${keys.trim})`);
        const asksEase = advice.advice.includes(`(${keys.ease})`);
        expect(asksTrim, where).toBe(advice.action === 'trim');
        expect(asksEase, where).toBe(advice.action === 'ease');
        if (state === 'drawing') expect(advice.action, where).toBe('none');
        if (state === 'luffing') expect(advice.action, where).not.toBe('ease');
        if (state === 'stalled') expect(advice.action, where).not.toBe('trim');
        if (state === 'by-the-lee') expect(advice.action, where).toBe('helm');
        checked++;
      }
    }
    expect(checked).toBe(240);
    // The sweep reaches the cases that matter (else it proves little).
    for (const want of ['drawing/none', 'luffing/trim', 'stalled/ease', 'stalled/none']) expect([...seen], want).toContain(want);
    // 120 simulated sails: about 3 s alone, longer on a loaded machine.
  }, 60_000);
});
