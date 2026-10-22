import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOBS, cost, fit, parseObservationsCsv, residuals, squibParams } from '../../src/sim/index';

const FIXTURE = 'tests/fixtures/observations-SYNTHETIC-residuary1.4.csv';

describe('calibration workflow', () => {
  it('parses observations and refuses rows without a source', () => {
    const obs = parseObservationsCsv(readFileSync(FIXTURE, 'utf8'));
    expect(obs).toHaveLength(3);
    expect(obs[0]).toMatchObject({ twsKn: 12, twaDeg: 60, weight: 1 });
    expect(() => parseObservationsCsv('tws_kn,twa_deg,stw_kn,source\n10,45,4.5,\n')).toThrow(/source/);
    expect(() => parseObservationsCsv('tws_kn,twa_deg,stw_kn\n10,45,4.5\n')).toThrow(/source/);
    expect(() => parseObservationsCsv('tws_kn,twa_deg,stw_kn,source\n10,45,fast,log\n')).toThrow(/not a number/);
  });

  it('the observation template ships with no data rows', () => {
    expect(parseObservationsCsv(readFileSync('data/observations/TEMPLATE.csv', 'utf8'))).toEqual([]);
  });

  it('self-consistency: recovers a known residuary multiplier from model-generated points', { timeout: 120_000 }, () => {
    const obs = parseObservationsCsv(readFileSync(FIXTURE, 'utf8'));
    const base = squibParams();
    // The truth reproduces the synthetic points (to the 4 d.p. written in the file).
    const atTruth = residuals(KNOBS.residuary!.apply(base, 1.4), obs, { durationS: 60 });
    for (const r of atTruth) expect(Math.abs(r.dStwKn!)).toBeLessThan(1e-3);
    expect(cost(atTruth)).toBeLessThan(0.01);
    const r = fit(base, obs, [KNOBS.residuary!], { durationS: 60, tol: 0.02 });
    console.log(`[calibration] residuary fitted ×${r.multipliers.residuary!.toFixed(3)} (truth ×1.4), cost ${r.costBefore.toFixed(2)} → ${r.costAfter.toFixed(4)}, ${r.evaluations} evaluations`);
    expect(r.multipliers.residuary).toBeCloseTo(1.4, 1);
    expect(Math.abs(r.multipliers.residuary! - 1.4)).toBeLessThan(0.02);
    expect(r.costAfter).toBeLessThan(r.costBefore / 100);
    expect(r.atBound).toEqual([]);
  });

  it('flags knobs the data cannot constrain, and knobs that cannot explain the data', { timeout: 120_000 }, () => {
    const base = squibParams();
    // Downwind at 12 kn the boat is upright: the righting arm has no influence on speed.
    const downwind = [{ twsKn: 12, twaDeg: 150, stwKn: 4.0, source: 'SYNTHETIC test point' }];
    const r1 = fit(base, downwind, [KNOBS.righting!], { durationS: 45, tol: 0.05 });
    expect(r1.insensitive).toEqual(['righting']);
    expect(r1.atBound).toEqual([]);
    // 3 kn on a 12 kn beam reach is far slower than any plausible resistance multiplier can produce.
    const impossible = [{ twsKn: 12, twaDeg: 90, stwKn: 3.0, source: 'SYNTHETIC impossible point' }];
    const r2 = fit(base, impossible, [KNOBS.residuary!], { durationS: 45, tol: 0.05 });
    expect(r2.atBound).toEqual(['residuary']);
    expect(r2.multipliers.residuary).toBeGreaterThan(1.9);
  });
});
