/**
 * "Continue where you left off" (src/app/resume.ts): the run is kept in this browser and, on the next visit, sailed
 * again step by step to exactly where it was left.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { RESUME_MAX_BYTES, loadResume, resumeSummary, saveResume } from '../../src/app/resume';
import { DT } from '../../src/sim/simulation';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

type Inner = { keepResumePoint(): void; stateHash(): string };

describe('continue where you left off', () => {
  it('nothing is kept in the first 30 s, nor from a lesson', () => {
    const c = new SimController();
    c.advance(20);
    (c as unknown as Inner).keepResumePoint();
    expect(loadResume()).toBeUndefined();
    c.startTutorial();
    c.advance(40);
    (c as unknown as Inner).keepResumePoint();
    expect(loadResume()).toBeUndefined();
  });

  it('a run kept on leaving is sailed again to the same state, then handed over', async () => {
    const a = new SimController();
    a.press('helmRight', true);
    a.advance(12);
    a.press('helmRight', false);
    a.press('mainOut', true);
    a.advance(3);
    a.press('mainOut', false);
    a.advance(30);
    (a as unknown as Inner).keepResumePoint();
    const left = { step: a.sim.step, hash: (a as unknown as Inner).stateHash(), n: a.sim.snapshot(false).n };
    expect(loadResume()?.label).toMatch(/^Free sailing from /);

    // The next visit: offered, then caught up.
    const b = new SimController();
    expect(b.getState().resume?.label).toMatch(/^Free sailing from /);
    expect(b.continueSession()).toBe(true);
    expect(b.getState().resume).toBeUndefined();
    for (let i = 0; i < 400 && b.getState().catchingUp !== undefined; i++) await new Promise((r) => setTimeout(r, 5));
    expect(b.getState().catchingUp).toBeUndefined();
    expect(b.getState().replay).toBeUndefined();
    expect(b.sim.step).toBe(left.step);
    expect((b as unknown as Inner).stateHash()).toBe(left.hash);
    expect(b.sim.snapshot(false).n).toBe(left.n);
    // Sailing on from there; while last visit's run was on offer nothing overwrote it.
    b.press('helmLeft', true);
    b.advance(1);
    expect(b.sim.input.helm).toBeLessThan(0);
  });

  it('start fresh forgets it; one too large is not kept; the summary', () => {
    const a = new SimController();
    a.advance(35);
    (a as unknown as Inner).keepResumePoint();
    const b = new SimController();
    b.dismissResume();
    expect(loadResume()).toBeUndefined();
    expect(saveResume({ rec: { big: 'x'.repeat(RESUME_MAX_BYTES) } as never, label: 'x', savedAt: '' })).toBe(false);
    const p = { rec: { endStep: 72_000 } as never, label: 'x', savedAt: '2026-11-10T09:00:00Z' };
    expect(resumeSummary(p, new Date('2026-11-10T12:00:00Z'), DT)).toBe('12 min in · saved 3 h ago');
  });
});
