import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS, lessonById, loadLessonProgress, nextLessonFor, saveLessonDone, type LessonId } from '../../src/app/lessons';
import { Tutorial, type TutorialSample } from '../../src/app/tutorial';
import { SimController } from '../../src/app/controller';
import { sailAdvice, sailState } from '../../src/app/sailStatus';

/** The six lessons (review §8.1, U9): their step logic, and each one sailed to the end by a scripted helmsman. */

const R2D = 180 / Math.PI;
const KN = 0.514444;
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

/** Steer towards a target true wind angle (deg, on the current side) with the helm keys, for `s` seconds. */
function hold(c: SimController, twaTarget: number, s: number, opts: { trim?: boolean; until?: () => boolean } = {}) {
  for (let i = 0; i < s * 10; i++) {
    if (opts.until?.()) break;
    const sn = c.sim.snapshot(false);
    const twa = Math.abs(sn.twa) * R2D;
    const side = Math.sign(sn.twa) || 1;
    const err = twa - twaTarget; // >0: too far off the wind -> head up
    const up = side > 0 ? 'helmRight' : 'helmLeft';
    const down = side > 0 ? 'helmLeft' : 'helmRight';
    c.press(up, err > 3);
    c.press(down, err < -3);
    if (opts.trim) {
      const st = sn.forces.main;
      c.press('mainIn', st.luff < 0.7);
      c.press('mainOut', st.stall > 0.4);
    }
    c.advance(0.1);
  }
  for (const k of ['helmRight', 'helmLeft', 'mainIn', 'mainOut']) c.press(k, false);
}

/** Steer for a compass bearing (deg) for up to `s` seconds or until `until`. */
function steerTo(c: SimController, bearing: () => number, s: number, until: () => boolean) {
  for (let i = 0; i < s * 10 && !until(); i++) {
    const h = c.sim.snapshot(false).heading * R2D;
    const err = ((((bearing() - h) % 360) + 540) % 360) - 180;
    c.press('helmRight', err > 3);
    c.press('helmLeft', err < -3);
    c.advance(0.1);
  }
  c.press('helmRight', false);
  c.press('helmLeft', false);
}

/** Tack (or gybe) by turning hard until the main changes side. */
function turnThrough(c: SimController, gybe = false) {
  const sn = c.sim.snapshot(false);
  const side = sn.mainSide;
  const towardsWind = Math.sign(sn.twa) > 0 ? 'helmRight' : 'helmLeft';
  const away = towardsWind === 'helmRight' ? 'helmLeft' : 'helmRight';
  const key = gybe ? away : towardsWind;
  c.press(key, true);
  for (let i = 0; i < 120 && c.sim.snapshot(false).mainSide === side; i++) c.advance(0.1);
  c.press(key, false);
}

const step = (c: SimController) => c.getState().tutorial?.step.id;
const done = (c: SimController) => !!c.getState().tutorial?.result;

describe('lesson step logic', () => {
  const base: TutorialSample = { t: 0, headingDeg: 165, twaDeg: 60, stwKn: 3.5, mainSide: 1, main: 'drawing', autoMain: true, autoCrew: true, crewHike: 0.6 };
  const feed = (t: Tutorial, s: Partial<TutorialSample>, seconds: number, from: number) => {
    let time = from;
    for (let i = 0; i < Math.round(seconds * 10); i++) t.update({ ...base, ...s, t: (time += 0.1) });
    return time;
  };

  it('six lessons, each starting with its own water and ending on a result', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['steer', 'wind', 'trim', 'turns', 'start', 'tide']);
    for (const l of LESSONS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(3);
      expect(l.steps.at(-1)!.goal).toBeUndefined(); // the result card
      expect(l.scenario.conditions.gusts?.preset).toBe('steady');
    }
  });

  it('a held goal must hold without a break; progress is reported', () => {
    const t = new Tutorial(lessonById('wind').steps);
    t.next(); // reach
    let time = feed(t, { twaDeg: 90 }, 3, 0);
    expect(t.state.progress).toBeGreaterThan(0.5);
    time = feed(t, { twaDeg: 120 }, 0.3, time);
    expect(t.state.progress).toBe(0);
    time = feed(t, { twaDeg: 92 }, 4.9, time);
    expect(t.state.done).toBe(false);
    feed(t, { twaDeg: 92, awsKn: 11.2 }, 0.3, time);
    expect(t.state.done).toBe(true);
    expect(t.record.awsReach).toBeCloseTo(11.2);
  });

  it('a tack is timed from leaving close-hauled to close-hauled on the new tack', () => {
    const t = new Tutorial(lessonById('turns').steps);
    t.next(); // tack
    let time = feed(t, { twaDeg: 45, stwKn: 4.6, mainSide: 1 }, 1, 0);
    time = feed(t, { twaDeg: 20, stwKn: 3.5, mainSide: 1 }, 2, time); // turning in: 2.0 s
    time = feed(t, { twaDeg: 10, stwKn: 2.6, mainSide: -1 }, 3, time);
    expect(t.state.done).toBe(false);
    feed(t, { twaDeg: 40, stwKn: 2.9, mainSide: -1 }, 0.1, time);
    expect(t.state.done).toBe(true);
    expect(t.record.tack1S).toBeCloseTo(5.0, 1);
    expect(t.record.tack1InKn).toBeCloseTo(3.5);
    expect(t.record.tack1MinKn).toBeCloseTo(2.6);
  });

  it('progress is kept in this browser; the next lesson is the first not done', () => {
    expect(nextLessonFor(loadLessonProgress()).id).toBe('steer');
    expect(saveLessonDone('steer', 95).best).toBe(true);
    expect(saveLessonDone('steer', 120).best).toBe(false);
    expect(loadLessonProgress().steer?.bestS).toBe(95);
    expect(nextLessonFor(loadLessonProgress()).id).toBe('wind');
  });

  it('the sail advice tells you which key to press', () => {
    expect(sailAdvice('luffing', { trim: 'W', ease: 'S' })).toMatchObject({ text: 'Luffing', advice: 'trim in (W)' });
    expect(sailAdvice('stalled', { trim: 'E', ease: 'Q' })).toMatchObject({ text: 'Stalled', advice: 'ease out (Q)' });
  });
});

describe('lessons in the app, sailed by a scripted helmsman with the keys alone (the goals are reachable in this model)', () => {
  const start = (id: LessonId) => {
    const c = new SimController();
    c.startLesson(id);
    expect(c.scenario).toEqual(lessonById(id).scenario);
    return c;
  };
  const finish = (c: SimController, log: string[]) => {
    c.advance(2.5);
    expect(done(c), log.join('; ')).toBe(true);
    return c.getState().tutorial!.result!;
  };

  it('1 Steering: turn, then sail to the buoy', () => {
    const c = start('steer');
    const log: string[] = [];
    c.tutorialNext();
    c.press('helmRight', true);
    c.advance(3);
    c.press('helmRight', false);
    c.advance(3);
    log.push(`after steer: ${step(c)}`);
    const tg = (c as unknown as { lessonTarget: { n: number; e: number } }).lessonTarget;
    steerTo(c, () => {
      const s = c.sim.snapshot(false);
      return (Math.atan2(tg.e - s.e, tg.n - s.n) * R2D + 360) % 360;
    }, 240, () => step(c) !== 'target' && step(c) !== 'steer');
    log.push(`after target: ${step(c)}`);
    const r = finish(c, log);
    expect(r.lines.join(' ')).toMatch(/reached the buoy in \d+:\d\d/);
    expect(r.next?.id).toBe('wind');
    expect(c.getState().lessons.find((l) => l.id === 'steer')?.done).toBe(true);
  });

  it('2 The wind: reach, beat, the no-go zone and out of it, run; apparent wind reported', () => {
    const c = start('wind');
    const log: string[] = [];
    c.tutorialNext();
    hold(c, 90, 14);
    log.push(`after reach: ${step(c)}`);
    hold(c, 45, 25);
    log.push(`after upwind: ${step(c)}`);
    hold(c, 18, 10, { until: () => step(c) !== 'nogo' });
    log.push(`after nogo: ${step(c)}`);
    hold(c, 75, 25, { until: () => step(c) !== 'out' });
    log.push(`after out: ${step(c)}`);
    hold(c, 160, 25, { until: () => step(c) !== 'run' });
    const r = finish(c, log);
    const m = /Apparent wind: ([\d.]+) kn close-hauled, ([\d.]+) kn on a beam reach, ([\d.]+) kn running/.exec(r.lines.join(' '));
    expect(m, r.lines.join(' ')).not.toBeNull();
    const [beat, reach, run] = m!.slice(1).map(Number) as [number, number, number];
    // The apparent wind is strongest upwind and lightest downwind.
    expect(beat).toBeGreaterThan(reach);
    expect(reach).toBeGreaterThan(run);
  });

  it('3 Trim: main and jib by hand, then auto-trim back on', () => {
    const c = start('trim');
    const log: string[] = [];
    c.tutorialNext();
    expect(c.sim.input.autoMain).toBe(false);
    c.press('mainOut', true);
    for (let i = 0; i < 100 && c.sim.snapshot(false).forces.main.luff > 0.4; i++) c.advance(0.1);
    c.press('mainOut', false);
    hold(c, 90, 10, { trim: true });
    log.push(`after main: ${step(c)}`);
    expect(c.sim.input.autoJib).toBe(false);
    c.press('jibOut', true);
    for (let i = 0; i < 100 && sailState(c.sim.snapshot(false).forces.jib) !== 'luffing'; i++) c.advance(0.1);
    c.press('jibOut', false);
    for (let i = 0; i < 100 && step(c) === 'jib'; i++) {
      const st = sailState(c.sim.snapshot(false).forces.jib);
      c.press('jibIn', st === 'luffing');
      c.press('jibOut', st === 'stalled');
      c.advance(0.1);
    }
    c.press('jibIn', false);
    c.press('jibOut', false);
    log.push(`after jib: ${step(c)}`);
    c.setInput({ autoMain: true, autoJib: true });
    c.advance(3);
    finish(c, log);
  });

  it('4 Tacking and gybing: two tacks timed, then a gybe', () => {
    const c = start('turns');
    const log: string[] = [];
    hold(c, 45, 12);
    log.push(`after upwind: ${step(c)}`);
    for (const id of ['tack', 'tack2']) {
      turnThrough(c);
      hold(c, 45, 10, { until: () => step(c) !== id });
      c.advance(2.2);
      log.push(`after ${id}: ${step(c)}`);
    }
    hold(c, 160, 20, { until: () => step(c) !== 'run' });
    log.push(`after run: ${step(c)}`);
    turnThrough(c, true);
    c.advance(3);
    const r = finish(c, log);
    const tack = /Tack 1: ([\d.]+) s, ([\d.]+) → ([\d.]+) kn/.exec(r.lines.join(' '));
    expect(tack, r.lines.join(' ')).not.toBeNull();
    expect(Number(tack![1])).toBeGreaterThan(2);
    expect(Number(tack![1])).toBeLessThan(20);
    expect(Number(tack![3])).toBeLessThan(Number(tack![2]));
    expect(r.lines.join(' ')).toMatch(/Gybe: /);
  });

  it('5 The start: hold back until the signal, then beat up to the line and cross it', () => {
    const c = start('start');
    const log: string[] = [];
    c.tutorialNext();
    // The line lies upwind (wind from 225°): beat towards its middle, close-hauled on whichever tack points
    // nearer to it, tacking only when the other tack is clearly better. It is far enough away that the boat
    // reaches it after the signal.
    const line = (c as unknown as { race: { resolved: { start: [{ n: number; e: number }, { n: number; e: number }] } } }).race.resolved.start;
    const mid = { n: (line[0].n + line[1].n) / 2, e: (line[0].e + line[1].e) / 2 };
    let tack = 180;
    const diff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
    // Hold back, sails eased, until 45 s before the signal.
    c.releaseSheets();
    steerTo(c, () => 135, 70, () => (c.getState().race?.toStart ?? 0) <= 45);
    c.setInput({ autoMain: true, autoJib: true });
    steerTo(c, () => {
      const s = c.sim.snapshot(false);
      const r = c.getState().race;
      // Over early: run back below the line (either end), as the lesson says, then start again.
      if (r?.ocs && r.toStart <= 0) return 45;
      const b = (Math.atan2(mid.e - s.e, mid.n - s.n) * R2D + 360) % 360;
      const other = tack === 180 ? 270 : 180;
      if (diff(b, other) + 15 < diff(b, tack)) tack = other;
      return tack;
    }, 300, () => step(c) === 'result');
    log.push(`after: ${step(c)} ocs=${c.getState().race?.ocs} toStart=${c.getState().race?.toStart.toFixed(0)}`);
    const r = finish(c, log);
    expect(r.lines.join(' ')).toMatch(/You started [\d.]+ s after the signal, at [\d.]+ kn/);
    // The clean start is also kept as your best start (src/app/bests.ts).
    expect(c.getState().race?.best?.start?.best).toBe(true);
    expect(JSON.parse(memory.get('squib.bests.v1')!).start.delayS).toBeGreaterThan(0);
  });

  it('6 The stream: SOG against STW both ways, then VMG', () => {
    const c = start('tide');
    const log: string[] = [];
    c.tutorialNext();
    hold(c, 45, 30, { until: () => step(c) !== 'against' });
    log.push(`after against: ${step(c)} stw=${(c.sim.snapshot(false).stw / KN).toFixed(2)} sog=${(c.sim.snapshot(false).sog / KN).toFixed(2)}`);
    hold(c, 165, 30, { until: () => step(c) !== 'with' });
    log.push(`after with: ${step(c)}`);
    turnThrough(c, true);
    hold(c, 45, 40, { until: () => step(c) !== 'vmg' });
    log.push(`after vmg: ${step(c)}`);
    const r = finish(c, log);
    expect(r.lines.join(' ')).toMatch(/VMG held at [\d.]+ kn/);
    expect(r.next).toBeUndefined();
  });

  it('Reset keeps the step (and the sheet handed over); another scenario ends the lesson; free sailing ends it in place', () => {
    const c = start('trim');
    c.tutorialNext();
    expect(c.sim.input.autoMain).toBe(false);
    c.requestReset(); // not racing: resets at once
    expect(step(c)).toBe('main');
    expect(c.sim.input.autoMain).toBe(false);
    c.restart({ ...lessonById('trim').scenario, startHeadingDeg: 10 });
    expect(c.getState().tutorial).toBeUndefined();
    const d = start('steer');
    d.advance(2);
    const t = d.sim.time;
    d.freeSail();
    expect(d.getState().tutorial).toBeUndefined();
    expect(d.sim.time).toBe(t);
  });

  it('"Learn to sail" starts the next lesson not done', () => {
    saveLessonDone('steer', 80);
    const c = new SimController();
    c.startTutorial();
    expect(c.getState().tutorial?.lesson.id).toBe('wind');
  });
});
