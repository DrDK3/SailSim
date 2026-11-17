/**
 * The beginner exercise "Trim, tack and recover" (training slice §7), sailed through the app's controller by a
 * scripted learner. Establishes: the exercise runs end to end; help is graduated and every level is logged; a
 * learner who performs well gets no level-3 help; the assistance record separates assisted from independent
 * attempts; restart during a tack and pause during a review behave; overlays can be removed; records persist and
 * export. It does not establish that the exercise teaches well (that needs learners and instructors: §12).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { sailState } from '../../src/app/sailStatus';
import { DEFAULT_THRESHOLDS, loadThresholds, mergeThresholds, saveThresholds, resetThresholds } from '../../src/app/exercises/config';
import { tackRecoverPlans } from '../../src/app/exercises/tackRecover';
import { exportRuns, importRuns, loadRuns } from '../../src/app/exercises/records';
import { isIndependent } from '../../src/app/exercises/engine';

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

const ex = (c: SimController) => c.getState().exercise!;
const st = (c: SimController) => ex(c).state;
const KEYS = ['helmRight', 'helmLeft', 'mainIn', 'mainOut', 'jibIn', 'jibOut'];
const release = (c: SimController) => KEYS.forEach((k) => c.press(k, false));

/**
 * A learner who does each phase promptly: steers to TWA 45° (or up to the luff in the cue phase), tacks in one
 * steady turn, and trims any sheet in their hands by its status. `passiveIn` names a phase where they do nothing.
 */
function learner(c: SimController, opts: { maxS?: number; passiveIn?: string; stopAt?: (c: SimController) => boolean } = {}) {
  let phaseKey = '';
  let sawLuff = false;
  let tackSide = 0;
  for (let i = 0; i < (opts.maxS ?? 1200) * 10; i++) {
    const s = st(c);
    if (opts.stopAt?.(c)) break;
    if (s.stage === 'result') break;
    if (s.stage === 'intro' || s.stage === 'review') {
      release(c);
      c.exerciseNext();
      continue;
    }
    const ph = s.phase!.id;
    const key = `${s.attempt}|${ph}`;
    const sn = c.sim.snapshot(false);
    if (key !== phaseKey) {
      phaseKey = key;
      sawLuff = false;
      tackSide = sn.mainSide;
    }
    const main = sailState(sn.forces.main, sn.boomMain);
    const jib = sailState(sn.forces.jib, sn.boomJib);
    if (main === 'luffing' || jib === 'luffing') sawLuff = true;
    const twa = Math.abs(sn.twa) * R2D;
    const side = Math.sign(sn.twa) || 1;
    const up = side > 0 ? 'helmRight' : 'helmLeft';
    const down = side > 0 ? 'helmLeft' : 'helmRight';
    if (ph === opts.passiveIn) {
      release(c);
      c.advance(0.1);
      continue;
    }
    if (ph === 'tack' && sn.mainSide === tackSide) {
      // One steady turn through the wind.
      c.press(up, true);
      c.press(down, false);
    } else {
      const target = ph === 'cue' && !sawLuff ? 20 : 45;
      const err = twa - target;
      c.press(up, err > 3);
      c.press(down, err < -3);
    }
    // Sheets in the learner's hands: trimmed by their status (the fixed sail advice).
    c.press('mainIn', !sn.input.autoMain && main === 'luffing');
    c.press('mainOut', !sn.input.autoMain && main === 'stalled');
    c.press('jibIn', !sn.input.autoJib && jib === 'luffing');
    c.press('jibOut', !sn.input.autoJib && jib === 'stalled');
    c.advance(0.1);
  }
  release(c);
}

describe('the plan: alternate tacks, seed-varied headings, falling assistance', () => {
  it('four attempts, starboard and port in turn, headings varied by the seed, assistance falling', () => {
    const plans = tackRecoverPlans(DEFAULT_THRESHOLDS.tackRecover);
    expect(plans.map((p) => p.tack)).toEqual([1, -1, 1, -1]);
    expect(new Set(plans.map((p) => Math.round(p.headingDeg))).size).toBe(4);
    expect(plans.map((p) => [p.start.autoMain, p.start.autoJib, p.start.overlay, p.start.help])).toEqual([
      [true, true, true, 'auto'],
      [true, true, true, 'auto'],
      [false, true, true, 'auto'],
      [false, false, false, 'request'],
    ]);
    // Another seed, other headings; the same seed, the same ones.
    const other = tackRecoverPlans({ ...DEFAULT_THRESHOLDS.tackRecover, seed: 2 });
    expect(other.map((p) => p.headingDeg)).not.toEqual(plans.map((p) => p.headingDeg));
    expect(tackRecoverPlans(DEFAULT_THRESHOLDS.tackRecover)).toEqual(plans);
  });

  it('each attempt starts on its tack, on a close reach, in steady wind with no stream', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    expect(st(c).stage).toBe('intro');
    c.exerciseNext(); // end the warm-up
    for (const want of [1, -1]) {
      const sn = c.sim.snapshot(false);
      expect(c.scenario.conditions.gusts.preset).toBe('steady');
      expect(c.scenario.conditions.current).toEqual({ mode: 'none' });
      expect(Math.sign(sn.twa)).toBe(want);
      expect(Math.abs(sn.twa) * R2D).toBeGreaterThan(50);
      expect(Math.abs(sn.twa) * R2D).toBeLessThan(90);
      // Skip through the attempt to the next.
      for (let i = 0; i < 4; i++) c.exerciseNext();
      expect(st(c).stage).toBe('review');
      c.exerciseNext();
    }
  });
});

describe('a learner who performs well', () => {
  it('completes all four attempts with no level-3 help; the last one is independent', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    learner(c);
    const s = st(c);
    expect(s.stage).toBe('result');
    const recs = s.records;
    expect(recs).toHaveLength(4);
    expect(recs.map((r) => r.outcome)).toEqual(['complete', 'complete', 'complete', 'complete']);
    const levels = c.getState().exercise!.state.records.flatMap((r) => [r.help[1], r.help[2], r.help[3]]);
    // No "try this" (level 3) help for a learner who performs well.
    expect(recs.every((r) => r.help[3] === 0), JSON.stringify(levels)).toBe(true);
    // Assisted (auto-trim or overlay) for the first three; the last on their own.
    expect(recs.map((r) => r.independent)).toEqual([false, false, false, true]);
    expect(recs[3]!.assists).toMatchObject({ autoMain: false, autoJib: false, overlay: false, liveHelp: false });
    // Every attempt measured the tack and the recovery.
    for (const r of recs) {
      expect(r.values.tackS).toBeGreaterThan(2);
      expect(r.values.tackMinKn).toBeLessThan(r.values.tackInKn!);
      expect(r.values.recoverS).toBeGreaterThan(0);
    }
    // The result card keeps assisted and independent apart.
    expect(s.result!.assisted.attempts).toBe(3);
    expect(s.result!.independent.attempts).toBe(1);
    expect(s.result!.independent.complete).toBe(1);
    expect(s.result!.notes.join(' ')).toMatch(/provisional \(E\)/);
    expect(s.result!.notes.join(' ')).toMatch(/draft/);
    // The run is kept in this browser.
    expect(loadRuns()).toHaveLength(1);
    expect(ex(c).saved).toBe(true);
  });
});

describe('graduated help', () => {
  it('comes by itself in order, attention → explain → suggest, and every level is logged', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    c.exerciseNext(); // the first attempt
    expect(st(c).phase!.id).toBe('close-hauled');
    // Sailing on across the wind (TWA 80°) instead of heading up: help at 10, 20 and 30 s stuck (E). (Left alone,
    // the model's weather helm rounds the boat up to close-hauled by itself in about 14 s.)
    const across = (s: number) => {
      for (let i = 0; i < s * 10; i++) {
        const sn = c.sim.snapshot(false);
        const err = Math.abs(sn.twa) * R2D - 80;
        const side = Math.sign(sn.twa) || 1;
        c.press(side > 0 ? 'helmRight' : 'helmLeft', err > 3);
        c.press(side > 0 ? 'helmLeft' : 'helmRight', err < -3);
        c.advance(0.1);
      }
    };
    across(9);
    expect(st(c).help).toBeUndefined();
    across(2);
    expect(st(c).help).toMatchObject({ level: 1, name: 'Look', id: 'too-low' });
    across(10);
    expect(st(c).help).toMatchObject({ level: 2, name: 'Why' });
    expect(st(c).help!.text).toMatch(/TWA \d+°/);
    across(10);
    release(c);
    expect(st(c).help).toMatchObject({ level: 3, name: 'Try' });
    expect(st(c).help!.text).toMatch(/Turn the bow towards the wind \(D or →\)/);
    const rec = st(c).records[0]!;
    expect(rec.help).toMatchObject({ 1: 1, 2: 1, 3: 1, requested: 0 });
    expect(rec.assists.liveHelp).toBe(true);
  });

  it('in the last attempt, help comes only when asked; asking makes the attempt assisted', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    c.exerciseNext();
    for (let a = 0; a < 3; a++) {
      for (let i = 0; i < 4; i++) c.exerciseNext();
      c.exerciseNext();
    }
    expect(st(c).attempt).toBe(4);
    expect(st(c).plan.start.help).toBe('request');
    c.advance(40);
    expect(st(c).help).toBeUndefined();
    expect(st(c).canAskHelp).toBe(true);
    c.exerciseHelp();
    expect(st(c).help).toMatchObject({ level: 1, requested: true });
    c.exerciseHelp();
    c.exerciseHelp();
    expect(st(c).help?.level).toBe(3);
    expect(st(c).canAskHelp).toBe(false);
    const rec = st(c).records[3]!;
    expect(rec.help).toMatchObject({ 1: 1, 2: 1, 3: 1, requested: 3 });
    expect(isIndependent(rec.assists)).toBe(false);
  });
});

describe('state machine', () => {
  it('restart during a tack: back to the attempt\'s start and its first phase; help seen still counts', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    learner(c, { stopAt: (cc) => st(cc).phase?.id === 'tack' && Math.abs(cc.sim.snapshot(false).twa) * R2D < 20 });
    expect(st(c).phase!.id).toBe('tack');
    const before = st(c).records[0]!;
    const plan = st(c).plan;
    c.requestReset(); // R: in an exercise, restart the attempt
    const s = st(c);
    expect(s.stage).toBe('attempt');
    expect(s.attempt).toBe(1);
    expect(s.phase!.id).toBe('close-hauled');
    expect(s.records[0]!.restarts).toBe(1);
    expect(s.records[0]!.values).toEqual({});
    expect(s.records[0]!.help).toEqual(before.help);
    expect(c.sim.time).toBe(0);
    expect(Math.abs(c.sim.snapshot(false).heading * R2D - plan.headingDeg)).toBeLessThan(0.2);
    // And it can be finished from there.
    learner(c);
    expect(st(c).stage).toBe('result');
  });

  it('pause during a review: nothing moves; Next starts the next attempt', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    learner(c, { stopAt: (cc) => st(cc).stage === 'review' });
    expect(st(c).stage).toBe('review');
    expect(st(c).review!.length).toBeGreaterThan(0);
    c.togglePause();
    expect(c.getState().paused).toBe(true);
    const t = c.sim.time;
    // A paused app's frames do not step the boat.
    const frame = (c as unknown as { frame(now: number): void }).frame.bind(c);
    frame(performance.now() + 500);
    expect(c.sim.time).toBe(t);
    expect(st(c).stage).toBe('review');
    // Next, even while paused, starts the next attempt from its own start, running.
    c.exerciseNext();
    expect(st(c).stage).toBe('attempt');
    expect(st(c).attempt).toBe(2);
    expect(c.getState().paused).toBe(false);
    expect(c.sim.time).toBe(0);
  });

  it('starting something else ends the exercise', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    c.startLesson('steer');
    expect(c.getState().exercise).toBeUndefined();
    c.startExercise('tack-recover');
    c.freeSail();
    expect(c.getState().exercise).toBeUndefined();
  });
});

describe('removable overlays', () => {
  it('with the overlay switched off from the start, the exercise still completes, and the overlay is not counted', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    learner(c, {
      stopAt: (cc) => {
        // Switch the overlay off at every set-up.
        if (ex(cc).overlay) cc.setExerciseOverlay(false);
        return false;
      },
    });
    const recs = st(c).records;
    expect(recs.map((r) => r.outcome)).toEqual(['complete', 'complete', 'complete', 'complete']);
    expect(recs.every((r) => !r.assists.overlay)).toBe(true);
  });
});

describe('records and thresholds', () => {
  it('records export to a file and import back (without duplicates); nothing personal in them', () => {
    const c = new SimController();
    c.startExercise('tack-recover');
    learner(c);
    const text = exportRuns();
    expect(text).not.toMatch(/name|email|user/i);
    memory.clear();
    expect(importRuns(text)).toMatchObject({ added: 1, skipped: 0 });
    expect(importRuns(text)).toMatchObject({ added: 0, skipped: 1 });
    expect(importRuns('{"schema":"other"}').error).toBeDefined();
    expect(importRuns('not json').error).toBeDefined();
  });

  it('an instructor can change the thresholds for this browser; bad values are ignored', () => {
    expect(mergeThresholds({ tackRecover: { attempts: 2, holdS: 'x', nope: 1 } }).tackRecover).toMatchObject({ attempts: 2, holdS: DEFAULT_THRESHOLDS.tackRecover.holdS });
    expect(saveThresholds({ tackRecover: { attempts: 2 } })).toBe(true);
    expect(loadThresholds().tackRecover.attempts).toBe(2);
    const c = new SimController();
    c.startExercise('tack-recover');
    expect(st(c).attempts).toBe(2);
    expect(ex(c).thresholdsChanged).toBe(true);
    resetThresholds();
    expect(loadThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe('the activity chip', () => {
  it('names the exercise and where it is', async () => {
    const { activityOf } = await import('../../src/ui/activity');
    const c = new SimController();
    c.startExercise('tack-recover');
    expect(activityOf(c.getState())).toEqual({ kind: 'exercise', label: 'Exercise', detail: 'Trim, tack and recover · warm-up' });
    c.exerciseNext();
    expect(activityOf(c.getState()).detail).toBe('Trim, tack and recover · attempt 1 of 4');
  });
});
