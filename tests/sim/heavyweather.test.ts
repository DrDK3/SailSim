/**
 * Heavy weather (red-team round): the Squib overpowered. Before this round the auto main sheeted for maximum
 * drive whatever the wind, so in 20 kn close-hauled the boat heeled to about 49° and filled, and on a reach it
 * broached with the rudder hard over. These check the depowering added: the auto main easing in gusts and
 * against weather helm, the flatten control, the AI crews flattening, and the gusty preset.
 */
import { describe, expect, it } from 'vitest';
import {
  DEG,
  GUST_PRESETS,
  OVERPOWERED,
  Simulation,
  WindField,
  autopilotHelm,
  buildConditions,
  knToMs,
  overpoweredEaseTarget,
  squibParams,
  uniformBase,
  type ControlInput,
} from '../../src/sim/index';
import { FLATTEN, flattenedParams } from '../../src/sim/boat/flatten';
import { aiFlatten } from '../../src/sim/ai/sheets';
import { decodeInputs, encodeInputs, parseRecording } from '../../src/app/replay';

function sail(twsKn: number, twaDeg: number, input: Partial<ControlInput>, seconds = 60, gusts: 'steady' | 'shifty' | 'gusty' = 'steady') {
  const env = buildConditions({
    startTime: '2026-07-15T12:00:00Z',
    weather: { source: 'manual', twsKn, twdDeg: 225 },
    gusts: { preset: gusts, seed: 3 },
    current: { mode: 'none' },
  }).env;
  const sim = new Simulation({
    params: squibParams(),
    env,
    // Start on the tack the autopilot holds (wind from starboard), at a sailing speed.
    initial: { headingDeg: 225 - twaDeg, speedKn: 4 },
    input,
    controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twaDeg * DEG }) }),
  });
  const after: { heel: number; rudder: number; stw: number; twa: number; water: number }[] = [];
  for (let t = 0; t < seconds; t += 0.5) {
    sim.advance(0.5);
    if (sim.time < 30) continue;
    const s = sim.snapshot(false);
    after.push({ heel: Math.abs(s.heel), rudder: Math.abs(s.rudder), stw: s.stw, twa: s.twa, water: s.cockpitWater });
  }
  const mean = (k: keyof (typeof after)[number]) => after.reduce((a, x) => a + x[k], 0) / after.length;
  const max = (k: keyof (typeof after)[number]) => Math.max(...after.map((x) => x[k]));
  return { sim, mean, max, after };
}

describe('flattening the sails', () => {
  const p = squibParams();
  it('lowers the maximum lift and the centre of effort, and caches by 1% steps', () => {
    const f = flattenedParams(p, 1);
    expect(f.main.coeff.clMax).toBeCloseTo(p.main.coeff.clMax * (1 - FLATTEN.clMaxDrop), 10);
    expect(f.jib.coeff.clMax).toBeCloseTo(p.jib.coeff.clMax * (1 - FLATTEN.clMaxDrop), 10);
    expect(f.main.ceHeight).toBeLessThan(p.main.ceHeight);
    expect(f.main.coeff.cd0).toBeLessThan(p.main.coeff.cd0);
    expect(flattenedParams(p, 0)).toBe(p);
    expect(flattenedParams(p, 0.501)).toBe(flattenedParams(p, 0.499));
    expect(flattenedParams(p, 2)).toBe(f);
    // Everything else is the boat's own.
    expect(f.rudder).toBe(p.rudder);
    expect(f.gz).toBe(p.gz);
  });

  it('follows the control at the crew’s pace', () => {
    const { sim } = sail(12, 60, { autoMain: true, autoJib: true, flatten: 0 }, 1);
    expect(sim.flattening).toBe(0);
    sim.setInput({ flatten: 1 });
    sim.advance(2);
    expect(sim.flattening).toBeCloseTo(2 * FLATTEN.ratePerS, 6);
    sim.advance(3);
    expect(sim.flattening).toBe(1);
  });

  it('cuts the heel on a reach in 20 kn for a small loss of speed', () => {
    const full = sail(20, 90, { autoMain: false, autoJib: false, mainSheet: 0.45, jibSheet: 0.45, autoCrew: true, flatten: 0 });
    const flat = sail(20, 90, { autoMain: false, autoJib: false, mainSheet: 0.45, jibSheet: 0.45, autoCrew: true, flatten: 1 });
    expect(flat.mean('heel')).toBeLessThan(full.mean('heel') - 5 * DEG);
    expect(flat.mean('stw')).toBeGreaterThan(0.85 * full.mean('stw'));
  });
});

describe('the auto main when overpowered', () => {
  it('eases beyond the heel limit, and for weather helm only when heeled', () => {
    const max = OVERPOWERED.heel;
    expect(overpoweredEaseTarget(max - 1 * DEG, 0, 0.6, 1)).toBe(0);
    expect(overpoweredEaseTarget(max + 7 * DEG, 0, 0.6, 1)).toBeCloseTo(0.5, 6);
    expect(overpoweredEaseTarget(max + 20 * DEG, 0, 0.6, 1)).toBe(1);
    // Rudder hard over bearing away (main to port: rudder to port) at 20° of heel: ease fully.
    expect(overpoweredEaseTarget(20 * DEG, -0.6, 0.6, 1)).toBe(1);
    // The same rudder upright (light airs, just steering), or heading up: no ease.
    expect(overpoweredEaseTarget(2 * DEG, -0.6, 0.6, 1)).toBe(0);
    expect(overpoweredEaseTarget(20 * DEG, 0.6, 0.6, 1)).toBe(0);
  });

  it('keeps the boat on its feet close-hauled in 20 kn (it heeled to 49° and filled before)', () => {
    const r = sail(20, 40, { autoMain: true, autoJib: true, autoCrew: true });
    expect(r.mean('heel')).toBeLessThan(30 * DEG);
    expect(r.max('water')).toBe(0);
    expect(r.mean('stw')).toBeGreaterThan(knToMs(5));
  });

  it('does not broach on a reach in 25 kn of gusty wind (rudder saturated and 50° off course before)', () => {
    const r = sail(25, 90, { autoMain: true, autoJib: true, autoCrew: true }, 90, 'gusty');
    const maxRudder = squibParams().rudder.maxAngle;
    expect(r.max('rudder')).toBeLessThan(0.9 * maxRudder);
    expect(Math.max(...r.after.map((x) => Math.abs(x.twa - 90 * DEG)))).toBeLessThan(20 * DEG);
    expect(r.max('heel')).toBeLessThan(40 * DEG);
  });

  it('is off with a manual main', () => {
    const r = sail(20, 40, { autoMain: false, autoJib: true, mainSheet: 0.05, autoCrew: true }, 35);
    expect(r.sim.overpoweredEase).toBe(0);
  });
});

describe('AI crews and gusts', () => {
  it('AI crews flatten from 12 kn to fully flat at 20 kn', () => {
    expect(aiFlatten(10)).toBe(0);
    expect(aiFlatten(12)).toBe(0);
    expect(aiFlatten(16)).toBeCloseTo(0.5, 6);
    expect(aiFlatten(20)).toBe(1);
    expect(aiFlatten(30)).toBe(1);
  });

  it('the gusty preset has stronger and more frequent gusts than shifty', () => {
    const area = { n: 0, e: 0, radius: 2500 };
    const p95 = (preset: 'shifty' | 'gusty', seed: number) => {
      const f = new WindField(uniformBase(8, 0), { ...GUST_PRESETS[preset], seed }, area);
      const g: number[] = [];
      for (let i = 0; i < 12000; i++) {
        f.step(i * 0.1, 0.1);
        if (i % 10 === 0) for (let k = 0; k < 9; k++) g.push(f.sample(300 * (k - 4), 200 * ((k * 7) % 5 - 2)).gustFactor);
      }
      g.sort((a, b) => a - b);
      return g[Math.floor(0.95 * g.length)]!;
    };
    // 20 minutes at nine points, two seeds: the 95th-percentile gust is about 1.39 against shifty's 1.31.
    for (const seed of [21, 5]) expect(p95('gusty', seed)).toBeGreaterThan(p95('shifty', seed) + 0.04);
  });
});

describe('replays carry the flatten control', () => {
  it('encodes it as a seventh column, and reads old six-column rows without it (the simulation takes 0)', () => {
    const log = [{ step: 0, input: { helm: 0.1, mainSheet: 0.2, jibSheet: 0.3, crewHike: 0.6, autoMain: true, autoJib: false, autoCrew: true, flatten: 0.75 } }];
    const rows = encodeInputs(log);
    expect(rows[0]).toHaveLength(7);
    expect(decodeInputs(rows)[0]!.input.flatten).toBe(0.75);
    expect(decodeInputs([[0, 0, 0.3, 0.3, 0.6, 7]])[0]!.input.flatten).toBeUndefined();
    const rec = { schema: 'squib-replay/1', scenario: { conditions: {} }, inputs: [[0, 0, 0.3, 0.3, 0.6, 7], [5, 0, 0.3, 0.3, 0.6, 7, 0.5]], checkpoints: [], endStep: 10, dart: 'none' };
    expect(() => parseRecording(rec)).not.toThrow();
  });
});
