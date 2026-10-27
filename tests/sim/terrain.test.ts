/** The land shapes the wind (shelter, valley steering) and local departures shape the tidal stream. */
import { describe, expect, it } from 'vitest';
import { DEG, buildConditions, knToMs } from '../../src/sim/index';
import { TERRAIN_WIND, TerrainWind, shelterAt } from '../../src/sim/env/terrainWind';
import { DepthWeight, STREAM_ANOMALIES, northerlyOutflowKn, offshoreStream, offshoreWeight } from '../../src/sim/env/streamAnomalies';
import type { TideState } from '../../src/sim/env/tide';
import { loadDartGeo } from './helpers';

const domain = { nMin: -2000, nMax: 2000, eMin: -2000, eMax: 2000 };
/** A 60 m ridge running north-south at e = 0 (100 m wide), sea elsewhere. */
const ridge = (_n: number, e: number) => (Math.abs(e) < 50 ? 60 : -10);
const windFrom = (deg: number, speed = 10) => ({ n: -speed * Math.cos(deg * DEG), e: -speed * Math.sin(deg * DEG) });

describe('shelter', () => {
  it('is greatest from 2 to 6 heights downwind of a rise and gone by 30', () => {
    expect(shelterAt(0)).toBe(0);
    expect(shelterAt(1)).toBeGreaterThan(TERRAIN_WIND.leeShelter);
    expect(shelterAt(4)).toBe(TERRAIN_WIND.maxShelter);
    expect(shelterAt(18)).toBeCloseTo(TERRAIN_WIND.maxShelter / 2, 9);
    expect(shelterAt(30)).toBe(0);
  });

  it('cuts the wind in the lee of a ridge, not to windward or far downwind; open water is untouched', () => {
    const tw = new TerrainWind({ bedElevation: ridge, domain });
    // West wind: the lee is to the east. The ridge stands 60 - (0.1 + 3) ≈ 57 m above the sails.
    const lee = tw.factor(0, 250, 270 * DEG).speed;
    expect(lee).toBeCloseTo(1 - TERRAIN_WIND.maxShelter, 2);
    expect(tw.factor(0, -400, 270 * DEG).speed).toBe(1);
    expect(tw.factor(0, 1900, 270 * DEG).speed).toBe(1);
    // Unchanged where no land lies upwind: the very same velocity.
    const w = windFrom(270);
    expect(tw.apply(w, 0, -400)).toBe(w);
    const v = tw.apply(w, 0, 250);
    expect(Math.hypot(v.n, v.e)).toBeCloseTo(10 * lee, 6);
  });

  it('turns an oblique wind along a sheltered valley, and leaves a wind square across it', () => {
    // A valley running north-south: ridges at e = ±300 m; the river's line north-south.
    const valley = (_n: number, e: number) => (Math.abs(Math.abs(e) - 300) < 60 ? 80 : -5);
    const tw = new TerrainWind({ bedElevation: valley, domain, axis: () => ({ n: 1, e: 0 }) });
    const oblique = tw.factor(0, 0, 225 * DEG);
    // Blowing to 045° (from the south-west): turned towards 000°, i.e. anticlockwise (negative).
    expect(oblique.turn).toBeLessThan(-2 * DEG);
    expect(Math.abs(oblique.turn)).toBeLessThanOrEqual(TERRAIN_WIND.maxTurn + 1e-9);
    expect(Math.abs(tw.factor(0, 0, 270 * DEG).turn)).toBeLessThan(0.5 * DEG);
  });

  it('on the River Dart: a westerly is lighter off RDYC than out in Start Bay; a northerly runs down the river', () => {
    const geo = loadDartGeo();
    const tw = new TerrainWind({ bedElevation: (n, e) => geo.bedElevation(n, e), domain: geo.domain, axis: (n, e) => geo.streamPattern(n, e).tidal });
    expect(tw.factor(0, -150, 270 * DEG).speed).toBeLessThan(0.75);
    expect(tw.factor(0, -150, 0).speed).toBeGreaterThan(0.95);
    expect(tw.factor(-3500, 1200, 225 * DEG).speed).toBe(1);
  });

  it('the environment applies it and says so; a run can turn it off', () => {
    const geo = loadDartGeo();
    const base = { startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual' as const, twsKn: 15, twdDeg: 270 }, gusts: { preset: 'steady' as const, seed: 1 }, current: { mode: 'none' as const } };
    const on = buildConditions(base, geo).env;
    const off = buildConditions({ ...base, landEffects: false }, geo).env;
    const sp = (w: { n: number; e: number }) => Math.hypot(w.n, w.e);
    expect(sp(on.wind(0, 0, -150))).toBeLessThan(0.8 * sp(off.wind(0, 0, -150)));
    expect(sp(off.wind(0, 0, -150))).toBeCloseTo(knToMs(15), 6);
    expect(on.describe!(0, 0, -150).landEffect?.speed).toBeLessThan(0.8);
    expect(off.describe!(0, 0, -150).landEffect).toBeUndefined();
  });
});

const tideAt = (hoursSinceHW: number): TideState => ({ height: 3, rising: false, hoursSinceHW, rateMPerH: 0, phase: 0 });

describe('the tidal stream, locally', () => {
  it('runs faster over deep water than over the shallows beside it', () => {
    // A channel 20 m deep down the middle (|e| < 75 m), 2 m deep either side.
    const bed = (_n: number, e: number) => (Math.abs(e) < 75 ? -20 : -2);
    const dw = new DepthWeight(bed, domain);
    expect(dw.at(0, 0)).toBeGreaterThan(1.05);
    expect(dw.at(0, 400)).toBeCloseTo(1, 6);
    expect(dw.at(0, 125)).toBeLessThan(dw.at(0, 0));
  });

  it("Start Bay's coastal stream: north-east-going from HW-2 to HW+4, south-west-going from LW-2 to LW+4", () => {
    const ne = offshoreStream(tideAt(1));
    expect(ne.n).toBeGreaterThan(0);
    expect(ne.e).toBeGreaterThan(0);
    const sw = offshoreStream(tideAt(7.5));
    expect(sw.n).toBeLessThan(0);
    expect(sw.e).toBeLessThan(0);
    // Turning at HW+4 (and HW-2): slack.
    expect(Math.hypot(offshoreStream(tideAt(4.21)).n, offshoreStream(tideAt(4.21)).e)).toBeLessThan(0.01);
    expect(Math.hypot(ne.n, ne.e)).toBeLessThanOrEqual(knToMs(STREAM_ANOMALIES.offshorePeakKn) + 1e-9);
    // Only offshore, seaward of the entrance: not in the harbour or up the river.
    expect(offshoreWeight(-3500, 1200)).toBe(1);
    expect(offshoreWeight(0, -150)).toBe(0);
    expect(offshoreWeight(-680, 755)).toBe(0);
  });

  it('strong northerlies add to the ebb; southerlies and light winds do not', () => {
    expect(northerlyOutflowKn(0, 20)).toBeCloseTo(STREAM_ANOMALIES.northerlyMaxKn, 9);
    expect(northerlyOutflowKn(0, 15)).toBeCloseTo(0.5, 9);
    expect(northerlyOutflowKn(180 * DEG, 20)).toBe(0);
    expect(northerlyOutflowKn(0, 8)).toBe(0);
    expect(northerlyOutflowKn(50 * DEG, 20)).toBe(0);
  });
});
