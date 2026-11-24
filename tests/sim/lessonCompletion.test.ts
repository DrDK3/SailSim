/**
 * Design handover (23 Nov 2026), item 3: a lesson is complete only when every step with a goal was sailed (owner's
 * choice: performed steps only). Skipping still moves on, and is recorded as skipped; reaching the end that way is not
 * completing. No fastest time is kept or rewarded. Records made before the change stay as they were, marked as such.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { lessonById, loadLessonProgress, saveLessonResult } from '../../src/app/lessons';
import { SimController } from '../../src/app/controller';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const result = (c: SimController) => c.getState().tutorial?.result;

describe('skipping is not completing', () => {
  it('skipping every step reaches the end: not complete, the skipped steps named, the lesson not done, no best time', () => {
    const c = new SimController();
    c.startLesson('steer');
    for (let i = 0; i < 3; i++) c.tutorialNext();
    c.advance(0.2);
    const r = result(c)!;
    expect(r).toBeDefined();
    expect(r.complete).toBe(false);
    expect(r.skipped).toEqual(['Steer', 'Sail to the buoy']);
    expect(r.steps).toBe(2);
    expect(r.lines.join(' ')).not.toMatch(/Lesson time/);
    expect(c.getState().lessons.find((l) => l.id === 'steer')).toMatchObject({ done: false, skipped: ['Steer', 'Sail to the buoy'] });
    const saved = loadLessonProgress().steer!;
    expect(saved.done).toBe(false);
    expect(saved.bestS).toBeUndefined();
  });

  it('a step skipped then gone back to and sailed counts as sailed', () => {
    const c = new SimController();
    c.startLesson('steer');
    c.tutorialNext(); // intro (no goal: never skipped)
    c.tutorialNext(); // skip "Steer"
    c.tutorialBack(); // back to it, and sail it
    const start = c.sim.snapshot(false).heading;
    for (let i = 0; i < 200 && Math.abs(((c.sim.snapshot(false).heading - start) * 180) / Math.PI) < 35; i++) {
      c.press('helmRight', true);
      c.advance(0.1);
    }
    c.press('helmRight', false);
    c.advance(0.2);
    expect(c.getState().tutorial?.done).toBe(true);
    c.tutorialNext(); // on to the buoy: skip it
    c.tutorialNext();
    c.advance(0.2);
    expect(result(c)!.skipped).toEqual(['Sail to the buoy']);
  });
});

describe('the record', () => {
  it('complete: done, with when it was first completed; a later run with skips does not undo it', () => {
    const first = new Date('2026-11-23T10:00:00Z');
    expect(saveLessonResult('wind', [], first).complete).toBe(true);
    expect(loadLessonProgress().wind).toMatchObject({ done: true, completedAt: first.toISOString() });
    saveLessonResult('wind', ['Beat'], new Date('2026-11-24T10:00:00Z'));
    expect(loadLessonProgress().wind).toMatchObject({ done: true, completedAt: first.toISOString() });
  });

  it('a record from before the change (done, with a best time) stays done and is marked as an earlier record', () => {
    memory.set('squib.lessons.v1', JSON.stringify({ steer: { done: true, bestS: 95, at: '2026-11-20T10:00:00Z' } }));
    expect(loadLessonProgress().steer).toMatchObject({ done: true, legacy: true, bestS: 95 });
    const c = new SimController();
    expect(c.getState().lessons.find((l) => l.id === 'steer')).toMatchObject({ done: true, legacy: true });
    // A complete run replaces it with an ordinary record.
    saveLessonResult('steer', []);
    expect(loadLessonProgress().steer!.legacy).toBeUndefined();
  });

  it('every lesson has at least one step to sail (so "complete" always means something was sailed)', () => {
    for (const id of ['steer', 'wind', 'trim', 'turns', 'start', 'tide'] as const) expect(lessonById(id).steps.some((s) => s.goal)).toBe(true);
  });
});
