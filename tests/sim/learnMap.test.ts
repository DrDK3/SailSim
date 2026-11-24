import { afterEach, describe, expect, it, vi } from 'vitest';
import { learnSteps, loadStarted, nextStep, noteStarted, type LearnInputs } from '../../src/app/learnMap';
import type { AttemptRecord } from '../../src/app/exercises/engine';

/**
 * The Learn map (review #13, package D): one order through the lessons, the exercises and the challenges; done from the
 * progress the app already keeps; the next step suggested; its own record kept in this browser, every access guarded.
 */
const NONE: LearnInputs = { lessons: {}, exerciseRuns: [], bests: { races: {} }, dailyKey: 'challenge:2026-11-21', weeklyDone: false, started: [] };
const attempt = (outcome: AttemptRecord['outcome'], independent = false) => ({ outcome, independent }) as AttemptRecord;

afterEach(() => vi.unstubAllGlobals());

describe('the Learn map', () => {
  it('orders the six basic lessons, the three seamanship lessons, the two exercises, then four challenges; nothing done, the first lesson next', () => {
    const steps = learnSteps(NONE);
    expect(steps.map((s) => s.group)).toEqual([...Array(6).fill('Basics'), ...Array(3).fill('Seamanship'), 'Exercises', 'Exercises', ...Array(4).fill('Challenges')]);
    expect(steps.slice(0, 6).map((s) => s.id)).toEqual(['lesson:steer', 'lesson:wind', 'lesson:trim', 'lesson:turns', 'lesson:start', 'lesson:tide']);
    expect(steps.some((s) => s.done)).toBe(false);
    expect(nextStep(steps).id).toBe('lesson:steer');
  });

  it('a lesson sailed in full is done; the next step is the first not done', () => {
    const steps = learnSteps({ ...NONE, lessons: { steer: { done: true, at: '2026-11-23T10:00:00Z', completedAt: '2026-11-23T10:00:00Z' } } });
    expect(steps[0]).toMatchObject({ done: true, note: undefined });
    expect(nextStep(steps).id).toBe('lesson:wind');
  });

  it('a lesson whose end was reached with steps skipped is started, not done, and says so (design handover item 3)', () => {
    const steps = learnSteps({ ...NONE, lessons: { steer: { done: false, at: '2026-11-23T10:00:00Z', skipped: ['Turn the boat', 'Sail to the buoy'] } } });
    expect(steps[0]).toMatchObject({ done: false, started: true, note: '2 steps skipped last time' });
    expect(nextStep(steps).id).toBe('lesson:steer');
  });

  it('a record from before 23 Nov 2026 stays done, marked as an earlier record', () => {
    const steps = learnSteps({ ...NONE, lessons: { steer: { done: true, bestS: 95, at: '2026-11-20T10:00:00Z', legacy: true } } });
    expect(steps[0]).toMatchObject({ done: true, note: 'Done (an earlier record)' });
  });

  it('an exercise is done only when an attempt was completed; tried but not completed is "started"', () => {
    const tried = learnSteps({ ...NONE, exerciseRuns: [{ exercise: 'tack-recover', attempts: [attempt('incomplete')] }] });
    expect(tried.find((s) => s.id === 'exercise:tack-recover')).toMatchObject({ done: false, started: true, note: '0 of 1 attempt completed' });
    const done = learnSteps({ ...NONE, exerciseRuns: [{ exercise: 'tack-recover', attempts: [attempt('incomplete'), attempt('complete', true)] }] });
    expect(done.find((s) => s.id === 'exercise:tack-recover')).toMatchObject({ done: true, note: '1 of 2 attempts completed' });
  });

  it('challenges: today’s from its best, a drill from a best start, a race from any other course best, the weekly course from its flag', () => {
    const steps = learnSteps({
      ...NONE,
      bests: { races: { 'challenge:2026-11-21': { timeS: 301, at: '', label: '' }, 'challenge:2026-11-20': { timeS: 290, at: '', label: '' } }, start: { delayS: 1.4, at: '' } },
    });
    const by = (id: string) => steps.find((s) => s.id === id)!;
    expect(by('challenge:daily')).toMatchObject({ done: true, note: 'Your time today 5:01' });
    expect(by('challenge:drill')).toMatchObject({ done: true });
    // Only challenge times: no other race yet.
    expect(by('challenge:race').done).toBe(false);
    expect(by('challenge:weekly').done).toBe(false);
    // Yesterday's challenge does not count for today.
    expect(learnSteps({ ...NONE, bests: { races: { 'challenge:2026-11-20': { timeS: 290, at: '', label: '' } } } }).find((s) => s.id === 'challenge:daily')!.done).toBe(false);
    expect(learnSteps({ ...NONE, weeklyDone: true }).find((s) => s.id === 'challenge:weekly')!.done).toBe(true);
  });

  it('with everything done, today’s challenge is suggested (a new one each day)', () => {
    const all = learnSteps(NONE).map((s) => ({ ...s, done: true }));
    expect(nextStep(all).id).toBe('challenge:daily');
  });

  it('a step started from the map is marked started until it is done', () => {
    const steps = learnSteps({ ...NONE, started: ['lesson:wind', 'lesson:steer'] });
    expect(steps.find((s) => s.id === 'lesson:wind')!.started).toBe(true);
    const doneToo = learnSteps({ ...NONE, started: ['lesson:steer'], lessons: { steer: { done: true, at: '' } } });
    expect(doneToo[0]).toMatchObject({ done: true, started: false });
  });

  it('its record is kept in this browser; blocked storage never breaks it', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    expect(loadStarted()).toEqual([]);
    noteStarted('lesson:steer');
    noteStarted('lesson:steer');
    expect(loadStarted()).toEqual(['lesson:steer']);
    // Unreadable or blocked: no record, no exception, and the step is still noted for this visit.
    store.set('squib.learnmap.v1', '{not json');
    expect(loadStarted()).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadStarted()).toEqual([]);
    expect(noteStarted('exercise:wind-shift', ['lesson:steer'])).toEqual(['lesson:steer', 'exercise:wind-shift']);
  });
});
