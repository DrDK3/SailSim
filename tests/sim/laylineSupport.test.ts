/**
 * Design handover (23 Nov 2026), item 14: the layline aid is honest and bounded. It is offered only in its supported
 * case (still water: the stream under 0.3 kn at the boat and at the mark) and says what it assumes (the model's best
 * angle, no stream or leeway, approach lines rather than the rounding path); elsewhere it is hidden, with the reason.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LAYLINE_MAX_STREAM_KN, laylineSupport } from '../../src/app/raceAids';
import { DEFAULT_SCENARIO, SimController } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';

beforeEach(() => {
  const memory = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
});

describe('the supported case', () => {
  it('still water: offered, with its assumptions', () => {
    const s = laylineSupport(0.1);
    expect(s.supported).toBe(true);
    expect(s.note).toMatch(/still water/);
    expect(s.note).toMatch(/not the path round the mark/);
  });

  it('a stream at or above the limit: hidden, saying why', () => {
    const s = laylineSupport(0.8);
    expect(s.supported).toBe(false);
    expect(s.note).toMatch(/^Laylines hidden: a 0.8 kn stream here moves them/);
    expect(laylineSupport(LAYLINE_MAX_STREAM_KN).supported).toBe(false);
    expect(laylineSupport(Number.NaN).supported).toBe(false);
  });
});

function racing(currentKn: number) {
  const c = new SimController();
  c.restart({ ...DEFAULT_SCENARIO, conditions: { ...DEFAULT_SCENARIO.conditions, gusts: { preset: 'steady', seed: 1 }, current: currentKn > 0 ? { mode: 'uniform', setDeg: 90, rateKn: currentKn } : { mode: 'none' } } });
  expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 1, conditions: 'as-set' })).toBeDefined();
  c.setRaceAids(true);
  // Nobody is steering, so the boat would never cross the line: hold the judge at "racing" on the first leg (a beat)
  // to check the controller's wiring (the stream at the boat and at the mark, the note in the race state).
  const judge = (c as unknown as { race: { session: { judgeOf(id: string): object } } }).race.session.judgeOf('you');
  Object.defineProperty(judge, 'phase', { get: () => 'racing', configurable: true });
  c.advance(1);
  return c;
}

describe('in a race', () => {
  it('no stream: the laylines are drawn, and the race panel says what they assume', () => {
    const c = racing(0);
    const support = c.laylineSupport();
    // The quick race's first leg is a beat: the aid applies.
    expect(support).toBeDefined();
    if (support === undefined) return;
    expect(support.supported).toBe(true);
    expect(c.raceLaylines).toBeDefined();
    expect(c.getState().race?.laylineNote).toMatch(/still water/);
  });

  it('a 0.8 kn stream: no laylines, and the race panel says why', () => {
    const c = racing(0.8);
    const support = c.laylineSupport();
    expect(support).toBeDefined();
    if (support === undefined) return;
    expect(support.supported).toBe(false);
    expect(c.raceLaylines).toBeUndefined();
    expect(c.getState().race?.laylineNote).toMatch(/Laylines hidden: a 0.8 kn stream/);
  });
});
