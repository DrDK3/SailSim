/**
 * The scripted wind shift (training slice §8): an environment input only. Before its time the wind is exactly the
 * manual wind; it turns at a steady rate over the ramp, at constant speed; after, it holds. A scenario without a
 * shift builds exactly the same wind as before (so nothing else changes), and the boat's parameters are untouched.
 */
import { describe, expect, it } from 'vitest';
import { scriptedShiftBase, uniformBase } from '../../src/sim/env/wind';
import { buildConditions, DEFAULT_CONDITIONS, type ConditionsSettings } from '../../src/sim/env/conditions';
import { Simulation, squibParams } from '../../src/sim/index';

const DEG = Math.PI / 180;
const KN = 1852 / 3600;

describe('scriptedShiftBase', () => {
  const base = scriptedShiftBase(10 * KN, 225 * DEG, { atS: 60, deg: -15, rampS: 20 });
  it('is the manual wind before the shift, turns linearly over the ramp at constant speed, then holds', () => {
    expect(base.at(0, 0, 0)).toEqual(uniformBase(10 * KN, 225 * DEG).at(0, 0, 0));
    expect(base.at(500, -300, 60).fromDir).toBeCloseTo(225 * DEG, 12);
    expect(base.at(0, 0, 70).fromDir).toBeCloseTo(217.5 * DEG, 12);
    expect(base.at(0, 0, 80).fromDir).toBeCloseTo(210 * DEG, 12);
    expect(base.at(0, 0, 400).fromDir).toBeCloseTo(210 * DEG, 12);
    for (const t of [0, 61, 70, 79, 200]) expect(base.at(0, 0, t).speed).toBe(10 * KN);
    // Uniform in space.
    expect(base.at(-2000, 900, 75)).toEqual(base.at(10, 10, 75));
  });

  it('wraps through north and handles a zero ramp', () => {
    const b = scriptedShiftBase(5, 5 * DEG, { atS: 10, deg: -20, rampS: 0 });
    expect(b.at(0, 0, 10).fromDir).toBeCloseTo(5 * DEG, 12);
    expect(b.at(0, 0, 10.01).fromDir).toBeCloseTo(345 * DEG, 12);
  });
});

describe('the conditions with and without a shift', () => {
  const plain: ConditionsSettings = { ...DEFAULT_CONDITIONS, weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } };
  const shifted: ConditionsSettings = { ...plain, weather: { source: 'manual', twsKn: 10, twdDeg: 225, shift: { atS: 60, deg: -15, rampS: 20 } } };

  it('a scenario without a shift gives exactly the wind it gave before; with one, only the direction moves', () => {
    const a = buildConditions(plain).env;
    const b = buildConditions(shifted).env;
    // The wind field keeps its own clock, stepped as the simulation steps it.
    const stepTo = (env: typeof a, from: number, to: number) => {
      for (let t = from; t < to - 1e-9; t += 0.1) env.step?.(t, 0.1);
    };
    let t = 0;
    for (const at of [0, 30, 59.9]) {
      stepTo(a, t, at);
      stepTo(b, t, at);
      t = at;
      expect(b.wind(t, 100, -50)).toEqual(a.wind(t, 100, -50));
    }
    stepTo(a, t, 300);
    stepTo(b, t, 300);
    const late = b.wind(300, 100, -50);
    const early = a.wind(300, 100, -50);
    expect(Math.hypot(late.n, late.e)).toBeCloseTo(Math.hypot(early.n, early.e), 9);
    // The wind blows towards fromDir + 180°: backing 15° turns the vector 15° anticlockwise.
    const ang = (v: { n: number; e: number }) => Math.atan2(v.e, v.n);
    expect(((ang(late) - ang(early)) / DEG + 540) % 360 - 180).toBeCloseTo(-15, 6);
    expect(buildConditions(shifted).weather.label).toMatch(/shifting 15° left \(backing\) at 60 s/);
  });

  it('the boat is the same boat: same parameters, and the same track until the shift arrives', () => {
    const mk = (c: ConditionsSettings) => new Simulation({ params: squibParams(), env: buildConditions(c).env, initial: { headingDeg: 180, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    const a = mk(plain);
    const b = mk(shifted);
    expect(b.params).toEqual(a.params);
    for (let i = 0; i < 6000; i++) {
      a.stepOnce();
      b.stepOnce();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    for (let i = 0; i < 3000; i++) {
      a.stepOnce();
      b.stepOnce();
    }
    expect(b.stateHash()).not.toBe(a.stateHash());
  });
});
