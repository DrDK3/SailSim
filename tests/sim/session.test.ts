import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, SimController, type AppScenario, type UiState } from '../../src/app/controller';
import { activityOf } from '../../src/ui/activity';

/**
 * UI v2, slice 1: the activity shown in the toolbar, and the session rules behind the experience hub: leaving a
 * race in progress asks first (as Reset does), a new session starts sailing, free sailing drops a course but
 * keeps the place, the conditions and the boat. Headless: the controller without a view.
 */

/** A practice race in Start Bay with two AI boats whose start signal comes 10 s after the run begins. */
const RACE: AppScenario = {
  ...structuredClone(DEFAULT_SCENARIO),
  startLocation: 'start-bay-practice',
  boat: 'classic',
  course: { source: 'practice', kind: 'windward-leeward' },
  race: { sequence: 'one-minute', startInS: 10 },
  fleet: { aiCount: 2, level: 'good', prepFlag: 'P' },
};

describe('activity', () => {
  const ui = (patch: Partial<Pick<UiState, 'replay' | 'tutorial' | 'race'>>) => activityOf({ replay: undefined, tutorial: undefined, race: undefined, ...patch });

  it('names what the session is doing, from its own state', () => {
    const c = new SimController();
    expect(activityOf(c.getState())).toEqual({ kind: 'free', label: 'Free sailing' });
    c.startTutorial();
    expect(activityOf(c.getState())).toEqual({ kind: 'tutorial', label: 'Tutorial', detail: 'step 1 of 11' });
    c.restart(structuredClone(RACE));
    expect(activityOf(c.getState())).toEqual({ kind: 'race', label: 'Race', detail: '2 AI · starting' });
    c.restart({ ...structuredClone(RACE), fleet: { aiCount: 0, level: 'good', prepFlag: 'P' } });
    const a = activityOf(c.getState());
    expect(a.kind).toBe('course');
    expect(a.detail).toMatch(/· starting$/);
  });

  it('a replay comes first, and a race that is over says so', () => {
    const race = { fleetSize: 3, phase: 'racing', raceOver: true, courseName: 'X' } as unknown as UiState['race'];
    expect(ui({ race })).toEqual({ kind: 'race', label: 'Race', detail: '2 AI · over' });
    expect(ui({ race, replay: { title: 'Tuesday' } as UiState['replay'] })).toEqual({ kind: 'replay', label: 'Replay', detail: 'Tuesday' });
  });
});

describe('leaving the current activity', () => {
  it('starts at once when nothing would be lost: free sailing, and a race before its start signal', () => {
    const c = new SimController();
    let ran = 0;
    c.leaveTo('Loading something', () => ran++);
    expect(ran).toBe(1);
    c.restart(structuredClone(RACE));
    c.advance(5);
    c.leaveTo('Loading something', () => ran++);
    expect(ran).toBe(2);
    expect(c.getState().confirmLeave).toBeUndefined();
  });

  it('asks during a race that has started; keeping racing loses nothing, leaving starts the new activity', () => {
    const c = new SimController();
    c.restart(structuredClone(RACE));
    c.advance(12);
    const step = c.sim.step;
    let ran = 0;
    c.leaveTo('Loading “Fog in the harbour”', () => ran++);
    expect(ran).toBe(0);
    expect(c.getState().confirmLeave).toBe('Loading “Fog in the harbour”');
    // Reset asks under exactly the same condition.
    c.requestReset();
    expect(c.getState().confirmReset).toBe(true);
    c.answerReset(false);
    c.answerLeave(false);
    expect(ran).toBe(0);
    expect(c.getState().confirmLeave).toBeUndefined();
    expect(c.race).toBeDefined();
    expect(c.sim.step).toBe(step);
    c.advance(1);
    expect(c.sim.step).toBe(step + 100);
    c.leaveTo('Starting the tutorial', () => c.startTutorial());
    c.answerLeave(true);
    expect(c.getState().tutorial).toBeDefined();
    expect(c.race).toBeUndefined();
  });

  it('a restart by another way clears a pending question', () => {
    const c = new SimController();
    c.restart(structuredClone(RACE));
    c.advance(12);
    c.leaveTo('Loading something', () => undefined);
    expect(c.getState().confirmLeave).toBeDefined();
    c.restart(structuredClone(DEFAULT_SCENARIO));
    expect(c.getState().confirmLeave).toBeUndefined();
  });
});

describe('starting a session', () => {
  it('a session started from the hub or the library sails, even from a pause', () => {
    const c = new SimController();
    c.togglePause();
    expect(c.getState().paused).toBe(true);
    expect(c.startSession(structuredClone(DEFAULT_SCENARIO))).toBe(true);
    expect(c.getState().paused).toBe(false);
  });

  it('free sailing from a race keeps the place, the conditions and the boat, without the course or the fleet', () => {
    const c = new SimController();
    c.restart(structuredClone(RACE));
    c.togglePause();
    c.freeSail();
    const s = c.scenario;
    expect(c.race).toBeUndefined();
    expect(s.course).toBeUndefined();
    expect(s.fleet).toBeUndefined();
    expect(s.race).toBeUndefined();
    expect(s.startLocation).toBe('start-bay-practice');
    expect(s.boat).toBe('classic');
    expect(s.conditions).toEqual(RACE.conditions);
    expect(c.getState().paused).toBe(false);
  });

  it('free sailing from the tutorial ends the lesson where the boat is (no restart)', () => {
    const c = new SimController();
    c.startTutorial();
    c.advance(3);
    const step = c.sim.step;
    c.freeSail();
    expect(c.getState().tutorial).toBeUndefined();
    expect(c.sim.step).toBe(step);
    expect(activityOf(c.getState()).kind).toBe('free');
  });
});
