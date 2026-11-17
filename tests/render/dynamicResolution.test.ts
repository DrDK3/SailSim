import { describe, expect, it } from 'vitest';
import { DynamicResolution, reversals } from '../../src/render/dynamicResolution';
import { createRng } from '../../src/sim/math/rng';

/**
 * Dynamic resolution never flips back and forth (juniors round, §7 "hysteresis is shown to work (no oscillation over
 * a 5-minute run)"): a device modelled as frame time = fixed cost + pixel cost × scale², with noise, run for 5 minutes
 * of 60 Hz frames.
 */
function run(frameMs: (scale: number) => number, minutes = 5, seed = 3) {
  const d = new DynamicResolution();
  const rng = createRng(seed);
  let t = 0;
  while (t < minutes * 60_000) {
    const ms = frameMs(d.scale) * (0.9 + 0.2 * rng.next());
    t += ms;
    const a = d.frame(t, ms);
    if (a?.kind === 'scale') d.skipWindow(t);
  }
  return d;
}

describe('dynamic resolution', () => {
  it('stays at full resolution on a device within budget', () => {
    const d = run(() => 16);
    expect(d.scale).toBe(1);
    expect(d.history).toHaveLength(0);
  });

  it('steps down to a resolution that holds and stays there for five minutes', () => {
    // 1.0 → 40 ms, 0.9 → 34.6, 0.8 → 29.6: settles at 0.8 (under budget, not far enough under to step up).
    const d = run((s) => 9 + 31 * s * s);
    expect(d.scale).toBeCloseTo(0.8, 5);
    expect(reversals(d.history)).toBe(0);
    expect(d.history.filter((h) => h.action.kind === 'scale')).toHaveLength(2);
  });

  it('a step up that does not hold backs off: few reversals in five minutes, with growing gaps', () => {
    // Adversarial: well under budget one step down, over budget at full (a cliff, e.g. a reflection pass).
    const d = run((s) => (s > 0.95 ? 38 : 18));
    const steps = d.history.filter((h) => h.action.kind === 'scale');
    expect(reversals(d.history)).toBeLessThanOrEqual(6);
    const ups = steps.filter((h) => h.action.kind === 'scale' && h.action.direction === 'up').map((h) => h.at);
    for (let i = 2; i < ups.length; i++) expect(ups[i]! - ups[i - 1]!).toBeGreaterThan(ups[i - 1]! - ups[i - 2]!);
  });

  it('asks for a lower preset only after the floor still misses the budget', () => {
    const d = run(() => 60, 1);
    const kinds = d.history.map((h) => h.action.kind);
    expect(kinds.indexOf('lower-preset')).toBeGreaterThan(kinds.lastIndexOf('scale') - 1);
    expect(kinds.filter((k) => k === 'scale')).toHaveLength(4); // 1 → 0.9 → 0.8 → 0.7 → 0.6
    expect(kinds).toContain('lower-preset');
  });

  it('does nothing when switched off (the player chose their graphics)', () => {
    const d = new DynamicResolution();
    d.enabled = false;
    for (let t = 0; t < 60_000; t += 50) expect(d.frame(t, 50)).toBeUndefined();
  });
});
