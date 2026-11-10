/** The traffic's whistle signals (src/app/soundSignals.ts) after COLREGs Rules 32, 34(d) and 35. */
import { describe, expect, it } from 'vitest';
import { FOG_INTERVAL_S, SignalScheduler, blastsInWords, closestApproach, fogSignal, signalDuration } from '../../src/app/soundSignals';
import type { VesselState } from '../../src/sim/env/traffic';

const vessel = (o: Partial<VesselState>): VesselState =>
  ({ id: 'v', name: 'v', label: 'v', unit: 0, kind: 'passenger-ferry', n: 0, e: 0, heading: 0, moving: true, ram: false, length: 20, beam: 6, sog: 3, phase: 'underway', parts: [], ...o }) as VesselState;
const still = { n: 500, e: 0, vn: 0, ve: 0 };

describe('Rule 35: in restricted visibility', () => {
  it('(a) making way: one prolonged; (b) stopped: two prolonged; (c) the ferries, restricted: one prolonged, two short', () => {
    expect(fogSignal(vessel({}))?.blasts).toEqual(['prolonged']);
    expect(fogSignal(vessel({ moving: false, sog: 0, phase: 'holding' }))?.blasts).toEqual(['prolonged', 'prolonged']);
    expect(fogSignal(vessel({ kind: 'tug-float', ram: true, length: 33 }))?.blasts).toEqual(['prolonged', 'short', 'short']);
    expect(fogSignal(vessel({ kind: 'floating-bridge', ram: true, length: 60 }))?.rule).toBe('Rule 35(c)');
  });
  it('none at the berth, and none from boats under 12 m (their "other efficient sound signal" is not modelled)', () => {
    expect(fogSignal(vessel({ phase: 'berthed' }))).toBeUndefined();
    expect(fogSignal(vessel({ kind: 'yacht', length: 10 }))).toBeUndefined();
  });
  it('Rule 32: short about 1 s, prolonged 4–6 s; in words', () => {
    expect(signalDuration(['prolonged'])).toBeGreaterThanOrEqual(4);
    expect(signalDuration(['prolonged'])).toBeLessThanOrEqual(6);
    expect(signalDuration(['short'])).toBe(1);
    expect(blastsInWords(['prolonged', 'short', 'short'])).toBe('one prolonged, two short');
    expect(blastsInWords(['short', 'short', 'short', 'short', 'short'])).toBe('five short');
  });
  it('each vessel at intervals of not more than 2 minutes, only in fog, not all at once', () => {
    const sch = new SignalScheduler();
    const a = vessel({ id: 'a', n: 100 });
    const b = vessel({ id: 'b', n: 200, kind: 'tug-float', ram: true, length: 33 });
    const heard: Record<string, number[]> = { a: [], b: [] };
    for (let t = 0; t <= 600; t += 0.5) for (const s of sch.update(t, [a, b], 300, still)) heard[s.vesselId]!.push(t);
    for (const id of ['a', 'b']) {
      const ts = heard[id]!;
      expect(ts.length).toBeGreaterThanOrEqual(4);
      expect(ts[0]!).toBeLessThanOrEqual(2 * FOG_INTERVAL_S);
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeLessThanOrEqual(120);
    }
    expect(heard.a).not.toEqual(heard.b);
    const clear = new SignalScheduler();
    let n = 0;
    for (let t = 0; t <= 600; t += 0.5) n += clear.update(t, [a, b], 20000, still).length;
    expect(n).toBe(0);
  });
});

describe('Rule 34(d): the doubt signal', () => {
  it('five short when you stand on to pass within a few metres of a vessel under way, in sight, once a minute', () => {
    const sch = new SignalScheduler();
    // The ferry heading north at 3 m/s, 50 m south of you (17 s away); you stopped in her path.
    const f = vessel({ id: 'f', n: -50 });
    const own = { n: 0, e: 0, vn: 0, ve: 0 };
    const s = sch.update(10, [f], 20000, own);
    expect(s.map((x) => x.rule)).toEqual(['Rule 34(d)']);
    expect(s[0]!.blasts).toHaveLength(5);
    expect(sch.update(11, [f], 20000, own)).toEqual([]);
    // Well clear to one side: nothing.
    expect(new SignalScheduler().update(10, [f], 20000, { ...own, e: 40 })).toEqual([]);
    // Not in sight (fog closer than she is): Rule 34(d) is for vessels in sight.
    expect(new SignalScheduler().update(10, [f], 40, own).filter((x) => x.rule === 'Rule 34(d)')).toEqual([]);
  });
  it('closest approach on present courses', () => {
    const c = closestApproach({ n: 0, e: 0, vn: 0, ve: 0 }, vessel({ n: -60, e: 5 }));
    expect(c.t).toBeCloseTo(20, 5);
    expect(c.d).toBeCloseTo(5, 5);
  });
});
