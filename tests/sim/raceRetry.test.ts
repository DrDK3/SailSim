/**
 * Design handover (23 Nov 2026), item 10 (a prototype): a race result leads to a useful retry. "Race it again" starts
 * the same race (course, wind, fleet, sequence, seed and rules setting), so the next time is compared like with like
 * (item 6); it is refused while the race is still at stake, so nothing is thrown away.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { raceIdentityKey } from '../../src/app/bests';

beforeEach(() => {
  const memory = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

describe('Race it again', () => {
  it('after retiring: the same race starts again, with the same identity for bests', () => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set' })).toBeDefined();
    const before = { scenario: JSON.stringify(c.getState().scenario), id: raceIdentityKey(c.raceIdentity()), hash: c.stateHash() };
    c.advance(5);
    c.retire();
    expect(c.raceAgain()).toBe(true);
    expect(JSON.stringify(c.getState().scenario)).toBe(before.scenario);
    expect(raceIdentityKey(c.raceIdentity())).toBe(before.id);
    // Back at the beginning of the same race (deterministic: the same state as the first start).
    expect(c.sim.time).toBe(0);
    expect(c.stateHash()).toBe(before.hash);
  });

  it('refused while the race is at stake (after the start signal, before you finish)', () => {
    const c = new SimController();
    c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 1, conditions: 'as-set' });
    const startAt = c.race!.session.judgeOf('you').startSignalTime;
    c.advance(startAt + 2);
    expect(c.raceAgain()).toBe(false);
  });

  it('not in free sailing', () => {
    expect(new SimController().raceAgain()).toBe(false);
  });
});
