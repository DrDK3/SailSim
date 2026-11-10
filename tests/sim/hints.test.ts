/** Hints when you are stuck (src/app/hints.ts): shown when the condition lasts, once per kind, cleared when out of it. */
import { describe, expect, it } from 'vitest';
import { HintEngine, type HintSample } from '../../src/app/hints';

const base: HintSample = { t: 0, twaDeg: 90, stwKn: 4, sogKn: 4, heelDeg: 10, grounded: false, main: 'drawing', jib: 'drawing', autoMain: true, autoJib: true };

/** Feed `seconds` of samples every 0.1 s; return the hints that appeared. */
function feed(e: HintEngine, from: number, seconds: number, s: Partial<HintSample>): string[] {
  const out: string[] = [];
  for (let k = 0; k <= seconds * 10; k++) {
    const h = e.update({ ...base, ...s, t: from + k / 10 });
    if (h) out.push(h.id);
  }
  return out;
}

describe('hints', () => {
  it('in irons: after 5 s pointing into the wind and stopped, with a Show me that bears away', () => {
    const e = new HintEngine(new Set());
    expect(feed(e, 0, 4, { twaDeg: 20, stwKn: 0.2 })).toEqual([]);
    const shown = feed(e, 4.1, 2, { twaDeg: 20, stwKn: 0.2 });
    expect(shown).toEqual(['in-irons']);
    expect(e.current?.showMe?.action).toMatchObject({ kind: 'bear-away' });
  });

  it('each kind once: a second time in irons shows nothing', () => {
    const e = new HintEngine(new Set());
    feed(e, 0, 6, { twaDeg: 20, stwKn: 0.2 });
    e.dismiss();
    feed(e, 7, 3, { twaDeg: 90, stwKn: 4 });
    expect(feed(e, 11, 8, { twaDeg: 20, stwKn: 0.2 })).toEqual([]);
  });

  it('clears itself once she is out of it', () => {
    const e = new HintEngine(new Set());
    feed(e, 0, 6, { twaDeg: 20, stwKn: 0.2 });
    expect(e.current?.id).toBe('in-irons');
    feed(e, 6.1, 6, { twaDeg: 80, stwKn: 3 });
    expect(e.current).toBeUndefined();
  });

  it('sails flapping only when the crew are not trimming them; heeling hard; aground', () => {
    expect(feed(new HintEngine(new Set()), 0, 8, { main: 'luffing', autoMain: true, autoJib: true })).toEqual([]);
    expect(feed(new HintEngine(new Set()), 0, 8, { main: 'luffing', autoMain: false })).toEqual(['flapping']);
    expect(feed(new HintEngine(new Set()), 0, 6, { heelDeg: 35 })).toEqual(['overpowered']);
    expect(feed(new HintEngine(new Set()), 0, 3, { grounded: true, stwKn: 0 })).toEqual(['aground']);
  });

  it('the harbour speed limit (6 kn) inside the harbour only; a ferry close by', () => {
    expect(feed(new HintEngine(new Set()), 0, 4, { sogKn: 6.5, inHarbour: false })).toEqual([]);
    expect(feed(new HintEngine(new Set()), 0, 4, { sogKn: 6.5, inHarbour: true })).toEqual(['harbour-speed']);
    expect(feed(new HintEngine(new Set()), 0, 1, { ferryM: 30 })).toEqual(['ferry-close']);
  });

  it('one hint at a time, and none for kinds already seen in this browser', () => {
    const e = new HintEngine(new Set(['in-irons']));
    expect(feed(e, 0, 8, { twaDeg: 20, stwKn: 0.2, heelDeg: 35 })).toEqual(['overpowered']);
  });
});
