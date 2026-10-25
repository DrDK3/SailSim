import { describe, expect, it } from 'vitest';
import { DEG, Simulation, autopilotHelm, uniformEnvironment } from '../../src/sim/index';
import { DEFAULT_SQUIB_TYPE, SQUIB_TYPES, isSquibType, squibParams, squibTypeParams, type SquibTypeId } from '../../src/sim/boat/squib';
import { cockpitEdgeUnderHeel, greenWaterInflow, outflow, railUnderHeel, sprayInflow, stepWater, waterOffset } from '../../src/sim/boat/cockpit';
import { computePolar } from '../../src/sim/ai/polar';
import { toKn } from './helpers';

describe('Squib types', () => {
  it('offers the three types, each with a label, summary and sourced differences', () => {
    expect(SQUIB_TYPES.map((t) => t.id)).toEqual(['rondar', 'classic', 'new-sails']);
    expect(DEFAULT_SQUIB_TYPE).toBe('rondar');
    for (const t of SQUIB_TYPES) {
      expect(t.label.length).toBeGreaterThan(10);
      expect(t.summary.length).toBeGreaterThan(40);
      for (const d of t.differences) expect(d.source.length).toBeGreaterThan(0);
    }
    // The Rondar type is the calibrated default: it changes nothing.
    expect(SQUIB_TYPES[0]!.differences).toEqual([]);
    expect(isSquibType('classic')).toBe(true);
    expect(isSquibType('laser')).toBe(false);
  });

  it('the default parameters are the Rondar type', () => {
    expect(squibTypeParams('rondar')).toEqual(squibParams());
  });

  it('builds differ only where the sources say: the classic cockpit is not self-draining (and the hull is heavier, E)', () => {
    const r = squibTypeParams('rondar');
    const c = squibTypeParams('classic');
    expect(r.cockpit.selfDraining).toBe(true);
    expect(c.cockpit.selfDraining).toBe(false);
    expect(c.mass - r.mass).toBeCloseTo(15, 9);
    // Same hull form and sail plan (one-design).
    for (const k of ['loa', 'lwl', 'beam', 'draft', 'mastLength', 'wettedArea', 'gm'] as const) expect(c[k]).toBe(r[k]);
    expect(c.main).toEqual(r.main);
    expect(c.jib).toEqual(r.jib);
  });

  it('the new sail package sheets closer to the centreline with a wider groove, on the same hull', () => {
    const r = squibTypeParams('rondar');
    const n = squibTypeParams('new-sails');
    expect(n.jib.sheetMin).toBeLessThan(r.jib.sheetMin);
    expect(n.main.sheetMin).toBeLessThan(r.main.sheetMin);
    expect(n.main.coeff.stallWidth).toBeGreaterThan(r.main.coeff.stallWidth);
    expect(n.cockpit).toEqual(r.cockpit);
    expect(n.mass).toBe(r.mass);
  });

  it('the sail package changes speeds by a few per cent at most (the effects are estimates)', { timeout: 120_000 }, () => {
    const r = computePolar(squibTypeParams('rondar'), [10], [42, 90, 150]);
    const n = computePolar(squibTypeParams('new-sails'), [10], [42, 90, 150]);
    const rows = r.stwKn[0]!.map((v, i) => n.stwKn[0]![i]! / v);
    console.log(`[types] new sails / standard at 10 kn, TWA 42/90/150: ${rows.map((x) => x.toFixed(3)).join(' ')}`);
    for (const x of rows) {
      expect(x).toBeGreaterThan(0.97);
      expect(x).toBeLessThan(1.05);
    }
    expect(rows.some((x) => Math.abs(x - 1) > 0.002)).toBe(true);
  });
});

describe('cockpit water', () => {
  const c = squibTypeParams('classic').cockpit;
  const r = squibTypeParams('rondar').cockpit;

  it('no water comes in until the rail is under; the cockpit floods once its edge is under', () => {
    const rail = railUnderHeel(c);
    const edge = cockpitEdgeUnderHeel(c);
    expect(rail / DEG).toBeGreaterThan(28);
    expect(edge / DEG).toBeGreaterThan(rail / DEG);
    expect(greenWaterInflow(c, rail - 1 * DEG)).toBe(0);
    expect(greenWaterInflow(c, -(rail + 6 * DEG))).toBeGreaterThan(0);
    const slop = greenWaterInflow(c, rail + 6 * DEG);
    const flood = greenWaterInflow(c, edge + 6 * DEG);
    expect(flood).toBeGreaterThan(10 * slop);
  });

  it('spray comes aboard only in waves from ahead, growing with wave height and speed', () => {
    expect(sprayInflow(c, 0.1, 2.5, 1)).toBe(0);
    expect(sprayInflow(c, 0.6, 2.5, -0.5)).toBe(0);
    expect(sprayInflow(c, 0.6, 2.5, 1)).toBeGreaterThan(sprayInflow(c, 0.4, 2.5, 1));
    expect(sprayInflow(c, 0.6, 3, 1)).toBeGreaterThan(sprayInflow(c, 0.6, 2, 1));
  });

  it('a self-draining cockpit empties itself; an older boat keeps the water until it is bailed', () => {
    let wr = 100;
    let wc = 100;
    for (let i = 0; i < 6000; i++) {
      wr = stepWater(r, wr, 0, 0.01);
      wc = stepWater(c, wc, 0, 0.01);
    }
    expect(wr).toBeLessThan(2);
    // 60 s of bailing at 0.5 kg/s: 30 kg out of 100.
    expect(wc).toBeCloseTo(70, 3);
    // Below the bailing threshold the water stays.
    expect(stepWater(c, 5, 0, 1)).toBe(5);
    expect(outflow(c, 5)).toBe(0);
    expect(stepWater(c, c.capacity, 100, 1)).toBeLessThanOrEqual(c.capacity);
  });

  it('shipped water runs to the low side: continuous, odd in heel, never past the side of the floor', () => {
    const w = 60;
    expect(waterOffset(c, w, 0)).toBe(0);
    expect(waterOffset(c, w, -10 * DEG)).toBeCloseTo(-waterOffset(c, w, 10 * DEG), 12);
    let prev = 0;
    for (let d = 0.1; d < 60; d += 0.1) {
      const y = waterOffset(c, w, d * DEG);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(y - prev).toBeLessThan(0.05);
      expect(y).toBeLessThanOrEqual(c.soleWidth / 2);
      prev = y;
    }
  });
});

describe('the types in the physics', () => {
  // A beat in 16 kn with the crew sitting in (no hiking) and the sheets nearly hard in: the rail goes under
  // and stays under. Wind from 000°.
  const beat = (id: SquibTypeId) => {
    const sim = new Simulation({
      params: squibTypeParams(id),
      env: uniformEnvironment({ twsKn: 16, twdDeg: 0 }),
      initial: { headingDeg: -45, speedKn: 4 },
      input: { autoMain: false, autoJib: false, mainSheet: 0.05, jibSheet: 0.05, autoCrew: false, crewHike: 0 },
      controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: 45 * DEG }) }),
    });
    let maxWater = 0;
    let heelSum = 0;
    const steps = 9000;
    for (let i = 0; i < steps; i++) {
      sim.stepOnce();
      maxWater = Math.max(maxWater, sim.act.water);
      if (i >= 6000) heelSum += Math.abs(sim.state.phi);
    }
    return { sim, maxWater, water: sim.act.water, heel: heelSum / 3000, stw: toKn(Math.hypot(sim.state.u, sim.state.v)) };
  };

  it('with the rail buried the classic boat fills up and slows; the Rondar drains', { timeout: 120_000 }, () => {
    const r = beat('rondar');
    const c = beat('classic');
    console.log(`[types] 16 kn, no hiking: Rondar ${r.water.toFixed(0)} kg aboard, heel ${(r.heel / DEG).toFixed(1)}°, ${r.stw.toFixed(2)} kn; classic ${c.water.toFixed(0)} kg, heel ${(c.heel / DEG).toFixed(1)}°, ${c.stw.toFixed(2)} kn`);
    expect(c.water).toBeGreaterThan(100);
    expect(r.water).toBeLessThan(20);
    expect(c.stw).toBeLessThan(r.stw - 0.1);
  });

  it('water aboard makes the boat more tender: less righting moment at the same heel', () => {
    const p = squibTypeParams('classic');
    const sim = new Simulation({ params: p, env: uniformEnvironment({ twsKn: 0, twdDeg: 0 }), initial: { headingDeg: 0, speedKn: 0 } });
    const rightingAt = (water: number, heelDeg: number) => {
      sim.state = { ...sim.state, phi: heelDeg * DEG, p: 0 };
      sim.act = { ...sim.act, water, crewY: 0 };
      return -sim.snapshot(false).forces.roll.total;
    };
    for (const heel of [10, 20, 30, 40]) expect(rightingAt(150, heel)).toBeLessThan(rightingAt(0, heel));
  });

  it('is deterministic for every type', { timeout: 120_000 }, () => {
    for (const id of ['classic', 'new-sails'] as const) expect(beat(id).sim.stateHash()).toBe(beat(id).sim.stateHash());
  });
});
