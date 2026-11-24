/**
 * Design handover (23 Nov 2026), item 1: protect active sessions and saved progress.
 * - A failed save says so: storage full or blocked gives an accurate status (and the notice's words), instead of
 *   failing silently; existing records stay readable; a later successful save clears it.
 * - The device check sails its own route, so it waits until the race, lesson, exercise, drill or replay in progress
 *   is over (owner's choice: between activities). It used to end them, and only the scenario came back, restarted.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBests, recordRaceTime } from '../../src/app/bests';
import { persist, resetStorageStatus, storageNotice, storageStatus } from '../../src/app/storage';
import { SimController } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';

const memory = new Map<string, string>();
let failWith: Error | undefined;
const install = () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWith) throw failWith;
      memory.set(k, v);
    },
    removeItem: (k: string) => void memory.delete(k),
  };
};
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
const security = () => Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError', code: 18 });

beforeEach(() => {
  memory.clear();
  failWith = undefined;
  resetStorageStatus();
  install();
});
afterEach(() => {
  failWith = undefined;
});

describe('saving says when it fails', () => {
  it('storage full: the status says full and what was not kept; the earlier best stays readable', () => {
    recordRaceTime('Course · 1 lap', 'Course', 300);
    expect(storageStatus().state).toBe('ok');
    failWith = quota();
    recordRaceTime('Course · 1 lap', 'Course', 290);
    expect(storageStatus()).toMatchObject({ state: 'full', what: 'your best times' });
    // The record already kept is still there (the failed write changed nothing).
    failWith = undefined;
    expect(loadBests().races['Course · 1 lap']!.timeS).toBe(300);
    const n = storageNotice(storageStatus())!;
    expect(n.title).toMatch(/full/);
    expect(n.title).toMatch(/your best times/);
    expect(n.detail).toMatch(/carries on/);
  });

  it('storage blocked (a private window): the status says blocked, with advice', () => {
    failWith = security();
    expect(persist('squib.x', '1', 'lesson progress')).toBe(false);
    expect(storageStatus()).toMatchObject({ state: 'blocked', what: 'lesson progress' });
    expect(storageNotice(storageStatus())!.detail).toMatch(/normal window/);
  });

  it('no storage at all: blocked', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(persist('squib.x', '1', 'your best times')).toBe(false);
    expect(storageStatus().state).toBe('blocked');
  });

  it('a later save that works clears the status, and the notice goes', () => {
    failWith = quota();
    persist('squib.x', '1', 'your best times');
    expect(storageStatus().state).toBe('full');
    failWith = undefined;
    expect(persist('squib.x', '2', 'your best times')).toBe(true);
    expect(storageStatus().state).toBe('ok');
    expect(storageNotice(storageStatus())).toBeUndefined();
  });

  it('the app’s state carries the status (the interface shows the notice from it)', () => {
    const c = new SimController();
    expect(c.getState().saveStatus.state).toBe('ok');
    failWith = quota();
    recordRaceTime('Course · 1 lap', 'Course', 280);
    expect(c.getState().saveStatus.state).toBe('full');
  });
});

describe('the device check waits for the activity in progress', () => {
  it('free sailing: it may run (and free sailing starts again afterwards)', () => {
    const c = new SimController();
    expect(c.deviceCheckBlocker()).toBeUndefined();
    expect(c.getState().deviceCheckBlocked).toBeUndefined();
  });

  it('a race under way: it waits; once the player is out of the race (retired), it may run', () => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 1, conditions: 'as-set' })).toBeDefined();
    expect(c.deviceCheckBlocker()).toMatch(/race is under way/);
    expect(c.getState().deviceCheckBlocked).toMatch(/race/);
    c.retire();
    expect(c.deviceCheckBlocker()).toBeUndefined();
  });

  it('a lesson under way: it waits', () => {
    const c = new SimController();
    c.startLesson('steer');
    expect(c.deviceCheckBlocker()).toMatch(/lesson is under way/);
  });
});
