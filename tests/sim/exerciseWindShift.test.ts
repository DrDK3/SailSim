/**
 * The tactical exercise "Wind shift on a beat" (training slice §8), sailed through the app's controller by scripted
 * learners. Establishes: the scripted shift arrives as set; the mark is upwind; a learner who tacks on each header and
 * one who holds are both judged on the decision against the model demonstrations, apart from their time; the review
 * map has the learner's track and both demonstrations; the better choice holds under the sensitivity harness. Model
 * output only: none of this says what is faster on the water.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController, START_LOCATIONS } from '../../src/app/controller';
import { sailState } from '../../src/app/sailStatus';
import { DEFAULT_THRESHOLDS } from '../../src/app/exercises/config';
import { PRACTICE_AREA, windShiftSetup } from '../../src/app/exercises/windShift';
import { shiftSensitivity } from '../../src/app/exercises/sensitivity';

const R2D = 180 / Math.PI;
const DEG = Math.PI / 180;
const T = DEFAULT_THRESHOLDS.windShift;
const { setup } = windShiftSetup(T);
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const st = (c: SimController) => c.getState().exercise!.state;
const KEYS = ['helmRight', 'helmLeft', 'mainIn', 'mainOut', 'jibIn', 'jibOut'];
const release = (c: SimController) => KEYS.forEach((k) => c.press(k, false));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Sail one attempt to the mark. 'tack': tack on each header (8 s after it begins), then the laylines; 'hold': only the
 * laylines. Close-hauled at TWA 42°, straight at the mark once it can be fetched; sheets in hand trimmed by status.
 */
function sailBeat(c: SimController, strategy: 'tack' | 'hold', stopAt?: (c: SimController) => boolean) {
  const returnAt = T.shiftAtS + T.shiftRampS + T.shiftHoldS;
  const events = [T.shiftAtS + 8, returnAt + 8];
  let next = 0;
  let want = 1;
  let lastTack = -Infinity;
  for (let i = 0; i < T.timeLimitS * 10 + 50; i++) {
    if (st(c).stage !== 'attempt' || stopAt?.(c)) break;
    const sn = c.sim.snapshot(false);
    const t = c.sim.time;
    const side = sn.mainSide === 1 ? 1 : -1;
    const from = sn.twd;
    const toMark = Math.atan2(setup.mark.e - sn.e, setup.mark.n - sn.n);
    const rel = wrap(toMark - from);
    const lim = (42 + 6) * DEG;
    const fetchThis = side === 1 ? rel <= -lim : rel >= lim;
    const fetchOther = side === 1 ? rel >= lim : rel <= -lim;
    if (want === side) {
      if (strategy === 'tack' && next < events.length && t >= events[next]!) {
        next++;
        const headed = (side === 1 && next === 1) || (side === -1 && next === 2);
        if (headed && !fetchThis) want = -side;
      } else if (next < events.length && t >= events[next]!) next++;
      if (want === side && fetchOther && t - lastTack > 12) want = -side;
      if (want !== side) lastTack = t;
    }
    const up = Math.sign(sn.twa) > 0 ? 'helmRight' : 'helmLeft';
    const down = up === 'helmRight' ? 'helmLeft' : 'helmRight';
    if (want !== side) {
      c.press(up, true);
      c.press(down, false);
    } else if (fetchThis && t - lastTack > 6) {
      const err = wrap(toMark + side * 3 * DEG - sn.heading) * R2D;
      c.press('helmRight', err > 3);
      c.press('helmLeft', err < -3);
    } else {
      const err = Math.abs(sn.twa) * R2D - 42;
      c.press(up, err > 3);
      c.press(down, err < -3);
    }
    const main = sailState(sn.forces.main, sn.boomMain);
    const jib = sailState(sn.forces.jib, sn.boomJib);
    c.press('mainIn', !sn.input.autoMain && main === 'luffing');
    c.press('mainOut', !sn.input.autoMain && main === 'stalled');
    c.press('jibIn', !sn.input.autoJib && jib === 'luffing');
    c.press('jibOut', !sn.input.autoJib && jib === 'stalled');
    c.advance(0.1);
  }
  release(c);
}

describe('set-up', () => {
  it('the practice area is the app\'s Start Bay start; the mark is 600 m upwind; the shift arrives as scripted', () => {
    const loc = START_LOCATIONS.find((l) => l.id === 'start-bay-practice')!;
    expect(PRACTICE_AREA).toEqual({ n: loc.n, e: loc.e });
    const c = new SimController();
    c.startExercise('wind-shift');
    expect(st(c).stage).toBe('intro');
    expect(st(c).extras?.predictions?.map((p) => p.id)).toEqual(['tack', 'hold', 'unsure']);
    c.exercisePredict('tack');
    expect(st(c).stage).toBe('attempt');
    expect(c.scenario.conditions.weather).toMatchObject({ source: 'manual', shift: { atS: 60, deg: -15, rampS: 20, holdS: 90 } });
    const sn = c.sim.snapshot(false);
    expect(Math.hypot(setup.mark.n - sn.n, setup.mark.e - sn.e)).toBeCloseTo(600, 0);
    expect(Math.sign(sn.twa)).toBe(1); // starboard
    const twd = () => ((c.sim.snapshot(false).twd * R2D) % 360 + 360) % 360;
    expect(twd()).toBeCloseTo(225, 3);
    c.advance(85);
    expect(twd()).toBeCloseTo(210, 3);
    c.advance(100); // past the return (60 + 20 + 90 + 20 = 190 s)
    c.advance(10);
    expect(twd()).toBeCloseTo(225, 3);
  });
});

describe('a learner who tacks on each header', () => {
  it('is told the decision matched the faster choice in this model, apart from the outcome; the map has three tracks', () => {
    const c = new SimController();
    c.startExercise('wind-shift');
    c.exercisePredict('tack');
    sailBeat(c, 'tack');
    const s = st(c);
    expect(s.stage).toBe('review');
    const rec = s.records[0]!;
    expect(rec.values.decisionTackS).toBeGreaterThan(0);
    expect(rec.values.decisionTackS).toBeLessThan(T.decisionWindowS);
    expect(rec.values.markS).toBeGreaterThan(200);
    const decision = s.review!.find((i) => i.id === 'decision')!;
    expect(decision.observation).toMatch(/you tacked \d+ s after the wind began to shift/);
    expect(decision.cause).toMatch(/In this model, from the same start, tacking on each header reached the mark \d+ s sooner/);
    expect(decision.action).toMatch(/matched the faster choice in this model/);
    const outcome = s.review!.find((i) => i.id === 'outcome')!;
    expect(outcome.observation).toMatch(/you reached the mark in \d+ s/);
    expect(outcome.cause).toMatch(/model demonstration of the same decision took \d+ s/);
    expect(s.review!.find((i) => i.id === 'prediction')?.observation).toMatch(/You predicted: tack onto the other tack\. You tacked\./);
    const chart = s.extras!.chart!;
    expect(chart.tracks.map((t) => t.id)).toEqual(['you', 'tack', 'hold']);
    expect(chart.tracks[0]!.points.length).toBeGreaterThan(100);
    expect(chart.tracks[1]!.timeS!).toBeLessThan(chart.tracks[2]!.timeS!);
    // The second attempt, on your own (sheets in hand, no overlay, help only when asked), then the result.
    c.exerciseNext();
    expect(st(c).plan.start).toMatchObject({ autoMain: false, autoJib: false, overlay: false, help: 'request' });
    sailBeat(c, 'tack');
    expect(st(c).stage).toBe('review');
    c.exerciseNext();
    const r = st(c).result!;
    expect(r.assisted.attempts + r.independent.attempts).toBe(2);
    expect(r.notes.join(' ')).toMatch(/in this model/);
    expect(r.notes.join(' ')).toMatch(/draft/);
  }, 60_000);
});

describe('a learner who holds on', () => {
  it('is told the decision differed from the faster choice in this model, and what to try', () => {
    const c = new SimController();
    c.startExercise('wind-shift');
    c.exerciseNext(); // skip the prediction
    sailBeat(c, 'hold');
    const s = st(c);
    expect(s.stage).toBe('review');
    expect(s.records[0]!.values.decisionTackS).toBeUndefined();
    const decision = s.review!.find((i) => i.id === 'decision')!;
    expect(decision.observation).toMatch(/you held starboard for 30 s or more/);
    expect(decision.action).toMatch(/consider tacking onto the lifted tack/);
    expect(s.review!.some((i) => i.id === 'prediction')).toBe(false);
  }, 60_000);

  it('gets help about the header while it holds on (attempt 1 has help that comes by itself)', () => {
    const c = new SimController();
    c.startExercise('wind-shift');
    c.exerciseNext();
    sailBeat(c, 'hold', (cc) => cc.sim.time > T.shiftAtS + T.shiftRampS / 2 + 12);
    expect(st(c).help).toMatchObject({ level: 1, id: 'headed' });
    expect(st(c).help!.text).toMatch(/heading history/);
    expect(st(c).extras!.headingHistory!.length).toBeGreaterThan(60);
  });

  it('restarting the attempt forgets its track', () => {
    const c = new SimController();
    c.startExercise('wind-shift');
    c.exerciseNext();
    sailBeat(c, 'hold', (cc) => cc.sim.time > 40);
    c.exerciseRestartAttempt();
    expect(c.sim.time).toBe(0);
    c.advance(5);
    expect(st(c).extras!.headingHistory!.length).toBeLessThan(10);
  });
});

describe('pointing sensitivity (test harness only)', () => {
  it('the better choice is the same with sail lift, drag, righting and pointing changed', () => {
    const rows = shiftSensitivity();
    expect(rows).toHaveLength(11);
    for (const r of rows) {
      expect(r.better, r.label).toBe('tack-on-header');
      expect(r.marginS!, r.label).toBeGreaterThan(10);
    }
  }, 120_000);
});
