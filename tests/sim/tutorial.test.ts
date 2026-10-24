import { describe, expect, it } from 'vitest';
import { TUTORIAL_SCENARIO, TUTORIAL_STEPS, Tutorial, type TutorialSample } from '../../src/app/tutorial';
import { SimController } from '../../src/app/controller';
import { sailAdvice } from '../../src/app/sailStatus';

/** The tutorial's step logic, and the tutorial running in the app controller (headless). */

const R2D = 180 / Math.PI;
/** Steer towards a target true wind angle (deg, on the current side) with the helm keys, for `s` seconds. */
function hold(c: SimController, twaTarget: number, s: number, opts: { trim?: boolean } = {}) {
  for (let i = 0; i < s * 10; i++) {
    const sn = c.sim.snapshot(false);
    const twa = Math.abs(sn.twa) * R2D;
    const side = Math.sign(sn.twa) || 1;
    const err = twa - twaTarget; // >0: too far off the wind -> head up
    // heading up towards the wind: for wind on stbd (twa>0) turn to starboard
    const up = side > 0 ? 'helmRight' : 'helmLeft';
    const down = side > 0 ? 'helmLeft' : 'helmRight';
    c.press(up, err > 3); c.press(down, err < -3);
    if (opts.trim) {
      const st = sn.forces.main;
      c.press('mainIn', st.luff < 0.7); c.press('mainOut', st.stall > 0.4);
    }
    c.advance(0.1);
  }
  for (const k of ['helmRight', 'helmLeft', 'mainIn', 'mainOut']) c.press(k, false);
}


const base: TutorialSample = { t: 0, headingDeg: 165, twaDeg: 60, stwKn: 3.5, mainSide: 1, main: 'drawing', autoMain: true, autoCrew: true, crewHike: 0.6 };

/** Feed the same sample for `seconds` at 10 Hz. */
function feed(t: Tutorial, s: Partial<TutorialSample>, seconds: number, from: number): number {
  let time = from;
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    time += 0.1;
    t.update({ ...base, ...s, t: time });
  }
  return time;
}

const at = (id: string) => TUTORIAL_STEPS.findIndex((s) => s.id === id);

describe('tutorial steps', () => {
  it('starts with an explanation that only needs Next, and ends on a summary', () => {
    const t = new Tutorial();
    expect(t.state.step.id).toBe('welcome');
    expect(t.state.step.goal).toBeUndefined();
    feed(t, {}, 3, 0);
    expect(t.state.done).toBe(false); // explanation steps wait for Next
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) t.next();
    expect(t.state.step.id).toBe('done');
    expect(t.finished).toBe(true);
  });

  it('steer: met once the heading has changed by 30° from where the step began', () => {
    const t = new Tutorial();
    t.next();
    let time = feed(t, { headingDeg: 165 }, 1, 0);
    time = feed(t, { headingDeg: 190 }, 1, time);
    expect(t.state.done).toBe(false);
    feed(t, { headingDeg: 196 }, 0.2, time);
    expect(t.state.done).toBe(true);
    // Across north too: 350° → 20° is 30°.
    const u = new Tutorial();
    u.next();
    feed(u, { headingDeg: 20 }, 0.3, feed(u, { headingDeg: 350 }, 0.2, 0));
    expect(u.state.done).toBe(true);
  });

  it('a held goal must hold without a break; progress is reported', () => {
    const t = new Tutorial();
    while (t.state.step.id !== 'reach') t.next();
    let time = feed(t, { twaDeg: 90 }, 3, 0);
    expect(t.state.progress).toBeGreaterThan(0.5);
    time = feed(t, { twaDeg: 120 }, 0.3, time); // falls off the reach: start again
    expect(t.state.progress).toBe(0);
    time = feed(t, { twaDeg: 92 }, 4.9, time);
    expect(t.state.done).toBe(false);
    feed(t, { twaDeg: 92 }, 0.3, time);
    expect(t.state.done).toBe(true);
  });

  it('trim: needs the main to luff first, then draw for 3 s; the step hands the main sheet over', () => {
    const t = new Tutorial();
    while (t.state.step.id !== 'trim') t.next();
    expect(t.pendingInput).toEqual({ autoMain: false });
    let time = feed(t, { main: 'drawing' }, 4, 0);
    expect(t.state.done).toBe(false); // drawing all along is not the lesson
    time = feed(t, { main: 'luffing' }, 1, time);
    feed(t, { main: 'drawing' }, 3.1, time);
    expect(t.state.done).toBe(true);
  });

  it('tack and gybe: the main changes side, upwind for a tack and downwind for a gybe', () => {
    const tack = new Tutorial();
    while (tack.state.step.id !== 'tack') tack.next();
    feed(tack, { mainSide: -1, twaDeg: 140, stwKn: 3 }, 0.5, feed(tack, { mainSide: 1 }, 0.2, 0));
    expect(tack.state.done).toBe(false); // that was a gybe
    feed(tack, { mainSide: -1, twaDeg: 45, stwKn: 2 }, 0.2, 2);
    expect(tack.state.done).toBe(true);
    const gybe = new Tutorial();
    while (gybe.state.step.id !== 'gybe') gybe.next();
    feed(gybe, { mainSide: -1, twaDeg: 165 }, 0.2, feed(gybe, { mainSide: 1, twaDeg: 165 }, 0.2, 0));
    expect(gybe.state.done).toBe(true);
  });

  it('crew: must change the hike by hand and turn auto crew back on', () => {
    const t = new Tutorial();
    while (t.state.step.id !== 'crew') t.next();
    let time = feed(t, { autoCrew: false, crewHike: 0.6 }, 1, 0);
    time = feed(t, { autoCrew: true }, 1, time);
    expect(t.state.done).toBe(false);
    time = feed(t, { autoCrew: false, crewHike: 0.2 }, 1, time);
    feed(t, { autoCrew: true, crewHike: 0.2 }, 0.2, time);
    expect(t.state.done).toBe(true);
  });

  it('back returns to the previous step with its goal unmet', () => {
    const t = new Tutorial();
    t.next();
    feed(t, { headingDeg: 230 }, 0.3, feed(t, {}, 0.1, 0));
    expect(t.state.done).toBe(true);
    t.next();
    t.back();
    expect(t.state.index).toBe(at('steer'));
    expect(t.state.done).toBe(false);
  });

  it('the sail advice tells you which key to press', () => {
    expect(sailAdvice('luffing', { trim: 'W', ease: 'S' })).toMatchObject({ text: 'Luffing', advice: 'trim in (W)' });
    expect(sailAdvice('stalled', { trim: 'E', ease: 'Q' })).toMatchObject({ text: 'Stalled', advice: 'ease out (Q)' });
  });
});

describe('tutorial in the app', () => {
  it('runs on its own scenario; steering the boat completes the step and moves on after 2 s', () => {
    const c = new SimController();
    c.startTutorial();
    expect(c.scenario).toEqual(TUTORIAL_SCENARIO);
    expect(c.getState().tutorial?.step.id).toBe('welcome');
    c.tutorialNext();
    expect(c.getState().tutorial?.step.id).toBe('steer');
    c.press('helmRight', true);
    for (let i = 0; i < 40 && !c.getState().tutorial!.done; i++) c.advance(0.5);
    c.press('helmRight', false);
    expect(c.getState().tutorial?.done).toBe(true);
    c.advance(2.2);
    expect(c.getState().tutorial?.step.id).toBe('reach');
  });

  it('hands over the main sheet at the trimming step; Reset keeps the tutorial, another scenario ends it', () => {
    const c = new SimController();
    c.startTutorial();
    expect(c.sim.input.autoMain).toBe(true);
    while (c.getState().tutorial!.step.id !== 'trim') c.tutorialNext();
    expect(c.sim.input.autoMain).toBe(false);
    c.requestReset(); // not racing: resets at once
    expect(c.getState().tutorial?.step.id).toBe('trim');
    c.restart({ ...TUTORIAL_SCENARIO, startHeadingDeg: 10 });
    expect(c.getState().tutorial).toBeUndefined();
  });

  it('asks before resetting a race that has started, and not before', () => {
    const c = new SimController();
    c.restart({
      ...TUTORIAL_SCENARIO,
      course: { source: 'practice', kind: 'windward-leeward' },
      race: { sequence: 'one-minute', startInS: 10 },
      fleet: { aiCount: 0, level: 'good', prepFlag: 'P' },
    });
    c.requestReset();
    expect(c.getState().confirmReset).toBe(false); // before the start: reset at once
    c.advance(12); // past the start signal at 10 s (whether or not this boat has crossed the line)
    const t = c.sim.time;
    c.requestReset();
    expect(c.getState().confirmReset).toBe(true);
    c.answerReset(false);
    expect(c.getState().confirmReset).toBe(false);
    expect(c.sim.time).toBe(t);
    c.requestReset();
    c.answerReset(true);
    expect(c.sim.time).toBe(0);
  });
  it('a scripted helmsman completes every step with the keys alone (the goals are reachable in this model)', () => {
  const c = new SimController();
  c.startTutorial();
  const step = () => c.getState().tutorial!.step.id;
  const log: string[] = [];
  c.tutorialNext(); // steer
  c.press('helmRight', true); c.advance(3); c.press('helmRight', false); c.advance(3);
  log.push(`steer done=${c.getState().tutorial!.done} now=${step()}`);
  hold(c, 90, 12); log.push(`after reach: ${step()} twa=${(Math.abs(c.sim.snapshot(false).twa)*R2D).toFixed(0)}`);
  // trim: ease until luffing then trim back
  c.press('mainOut', true); for (let i = 0; i < 100 && c.sim.snapshot(false).forces.main.luff > 0.4; i++) c.advance(0.1); c.press('mainOut', false);
  hold(c, 90, 10, { trim: true }); log.push(`after trim: ${step()}`);
  hold(c, 45, 25, { trim: true }); log.push(`after upwind: ${step()} stw=${(c.sim.snapshot(false).stw/0.5144).toFixed(2)} twa=${(Math.abs(c.sim.snapshot(false).twa)*R2D).toFixed(0)}`);
  // tack: turn hard through the wind
  const sideBefore = c.sim.snapshot(false).mainSide;
  const turn = Math.sign(c.sim.snapshot(false).twa) > 0 ? 'helmRight' : 'helmLeft';
  c.press(turn, true); for (let i = 0; i < 80 && c.sim.snapshot(false).mainSide === sideBefore; i++) c.advance(0.1); c.press(turn, false);
  hold(c, 50, 8, { trim: true }); log.push(`after tack: ${step()}`);
  // run
  c.press('mainOut', true); hold(c, 160, 15); c.press('mainOut', false); log.push(`after run: ${step()} twa=${(Math.abs(c.sim.snapshot(false).twa)*R2D).toFixed(0)}`);
  // gybe: keep bearing away
  const sb = c.sim.snapshot(false).mainSide;
  const away = Math.sign(c.sim.snapshot(false).twa) > 0 ? 'helmLeft' : 'helmRight';
  c.press(away, true); for (let i = 0; i < 100 && c.sim.snapshot(false).mainSide === sb; i++) c.advance(0.1); c.press(away, false);
  c.advance(3); log.push(`after gybe: ${step()}`);
  // crew
  c.setInput({ autoCrew: false }); c.advance(0.5); c.setInput({ crewHike: 0.1 }); c.advance(1); c.setInput({ autoCrew: true }); c.advance(3);
  log.push(`after crew: ${step()}`);
  // stop: release sheets and wait
  hold(c, 90, 5);
  c.releaseSheets(); let t = 0; for (; t < 120 && c.sim.snapshot(false).stw / 0.5144 >= 1; t++) hold(c, 25, 1);
  log.push(`stop after ${t}s stw=${(c.sim.snapshot(false).stw/0.5144).toFixed(2)}`);
  c.advance(3);
  log.push(`final: ${step()} done=${c.getState().tutorial!.done}`);
    expect(step(), log.join('; ')).toBe('done');
  });
});

