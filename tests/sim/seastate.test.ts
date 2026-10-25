import { describe, expect, it } from 'vitest';
import { G } from '../../src/sim/units';
import { DEG, buildConditions } from '../../src/sim/index';
import { SeaStateModel, groupVelocity, jonswap, wavenumber, wavenumberOnCurrent, whitecapFraction, type SeaStateInputs } from '../../src/sim/env/seaState';
import { loadDartGeo } from './helpers';

const KN = 1852 / 3600;

describe('wave physics', () => {
  it('JONSWAP fetch-limited growth and the fully developed cap', () => {
    const a = jonswap(10, 10_000);
    expect(a.hs).toBeCloseTo(0.0016 * 10 * Math.sqrt(10_000 / G), 9);
    expect(a.tp).toBeCloseTo(0.286 * Math.cbrt((G * 10_000) / 100) * (10 / G), 9);
    const full = jonswap(10, 1e8);
    expect(full.hs).toBeCloseTo((0.243 * 100) / G, 9);
    expect(full.tp).toBeCloseTo((8.13 * 10) / G, 9);
    expect(jonswap(0.2, 1000).hs).toBe(0);
  });

  it('dispersion: deep and shallow water, group velocity', () => {
    const sig = (2 * Math.PI) / 3;
    expect(wavenumber(sig, 1000)).toBeCloseTo((sig * sig) / G, 9);
    // Shallow water: c → √(gh).
    const kS = wavenumber(0.05, 2);
    expect(0.05 / kS).toBeCloseTo(Math.sqrt(G * 2), 2);
    // Deep water: cg = c / 2.
    const k = wavenumber(sig, 1000);
    expect(groupVelocity(k, 1000)).toBeCloseTo(sig / k / 2, 6);
  });

  it('on an opposing current waves shorten, and are blocked at |U| = g/4ω (deep water)', () => {
    const omega = (2 * Math.PI) / 2.5;
    const k0 = wavenumberOnCurrent(omega, 0, 1000)!;
    expect(k0).toBeCloseTo((omega * omega) / G, 9);
    const kAgainst = wavenumberOnCurrent(omega, -0.5, 1000)!;
    const kWith = wavenumberOnCurrent(omega, 0.5, 1000)!;
    expect(kAgainst).toBeGreaterThan(k0);
    expect(kWith).toBeLessThan(k0);
    const uBlock = -G / (4 * omega);
    expect(wavenumberOnCurrent(omega, uBlock * 0.98, 1000)).toBeDefined();
    expect(wavenumberOnCurrent(omega, uBlock * 1.02, 1000)).toBeUndefined();
    // The solution satisfies the Doppler-shifted dispersion relation.
    expect(Math.sqrt(G * kAgainst) - 0.5 * kAgainst).toBeCloseTo(omega, 9);
  });

  it('Monahan and O’Muircheartaigh whitecap cover: about 1% at 10 m/s', () => {
    expect(whitecapFraction(10)).toBeCloseTo(3.84e-6 * Math.pow(10, 3.41), 12);
    expect(whitecapFraction(10)).toBeGreaterThan(0.008);
    expect(whitecapFraction(10)).toBeLessThan(0.012);
  });
});

/**
 * Open sea (no land), wind blowing towards the north. The stream runs (north-going for currentTo > 0) only
 * within `zone` metres south of the point, as in a harbour entrance; everywhere when zone is Infinity.
 */
function openSea(windTo: number, currentTo: number, zone = 1500): SeaStateModel {
  const src: SeaStateInputs = {
    startEpochMs: 0,
    wind: () => ({ n: windTo, e: 0 }),
    current: (_t, n) => ({ n: n > -zone ? currentTo : 0, e: 0 }),
  };
  return new SeaStateModel(src);
}

describe('wind over tide (open water)', () => {
  it('waves running into a stream against them get shorter and steeper, with whitecaps; with them, flatter', () => {
    const wind = 8; // m/s towards the north
    const slack = openSea(wind, 0).exact(0, 0, 0);
    const against = openSea(wind, -1).exact(0, 0, 0);
    const withIt = openSea(wind, 1).exact(0, 0, 0);
    console.log(`[sea] 8 m/s wind: slack Hs ${slack.hs.toFixed(2)} m L ${slack.wavelength.toFixed(1)} m; against 1 m/s Hs ${against.hs.toFixed(2)} L ${against.wavelength.toFixed(1)} steep ×${(against.steepness / slack.steepness).toFixed(2)}; with Hs ${withIt.hs.toFixed(2)} L ${withIt.wavelength.toFixed(1)}`);
    expect(against.steepness).toBeGreaterThan(1.1 * slack.steepness);
    expect(withIt.steepness).toBeLessThan(slack.steepness);
    expect(against.windAgainstTide).toBe(true);
    expect(withIt.windAgainstTide).toBe(false);
    expect(slack.windAgainstTide).toBe(false);
    expect(against.whitecaps).toBeGreaterThan(slack.whitecaps);
    expect(against.wavelength).toBeLessThan(slack.wavelength);
    // Waves travel downwind (relative to the water).
    expect(Math.abs(against.dirTo)).toBeLessThan(1e-9);
  });

  it('a stream that is the same all along the fetch only changes the wind over the water (no steepening)', () => {
    const slack = openSea(8, 0, Infinity).exact(0, 0, 0);
    const against = openSea(8, -1, Infinity).exact(0, 0, 0);
    expect(against.hs).toBeGreaterThan(slack.hs);
    expect(against.steepness / slack.steepness).toBeGreaterThan(0.9);
    expect(against.steepness / slack.steepness).toBeLessThan(1.1);
  });

  it('a stream strong enough blocks the waves: they break', () => {
    const s = openSea(6, -2.5).exact(0, 0, 0);
    expect(s.blocked).toBe(true);
    expect(s.whitecaps).toBeGreaterThanOrEqual(0.15);
  });

  it('never steeper than the breaking limit', () => {
    for (const c of [-3, -2, -1.5, -1, 0, 1]) {
      const s = openSea(12, c).exact(0, 0, 0);
      expect(s.steepness).toBeLessThanOrEqual(0.1 + 1e-12);
      expect(Number.isFinite(s.hs)).toBe(true);
    }
  });

  it('the cached field never depends on who asks first', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ t: (i * 7) % 61, n: i * 13.7, e: -i * 9.1 }));
    const a = openSea(9, -0.8);
    const b = openSea(9, -0.8);
    const fa = pts.map((p) => a.at(p.t, p.n, p.e).hs);
    const fb = [...pts].reverse().map((p) => b.at(p.t, p.n, p.e).hs).reverse();
    expect(fa).toEqual(fb);
  });
});

describe('wind over tide in the River Dart', () => {
  const geo = loadDartGeo();
  const [a, b] = [geo.manifest.entrance.a, geo.manifest.entrance.b];
  const mid = { n: (a[1] + b[1]) / 2, e: (a[0] + b[0]) / 2 };
  // Tide: HW 12:00, LW about 18:12. Mid-ebb about 15:06, mid-flood about 09:00.
  const conditions = (startTime: string, windFromDeg: number) =>
    buildConditions(
      {
        startTime,
        weather: { source: 'manual', twsKn: 18, twdDeg: windFromDeg },
        gusts: { preset: 'steady', seed: 1 },
        tide: { mode: 'manual', hwTime: '2026-07-15T12:00:00Z', hwHeightM: 4.8, lwHeightM: 0.9 },
        current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } },
      },
      geo,
    ).env;

  it('a southerly against the ebb in the entrance: short, steep, breaking waves; on the flood they are not', () => {
    const ebb = conditions('2026-07-15T15:06:00Z', 180).seaState!(0, mid.n, mid.e);
    const flood = conditions('2026-07-15T09:00:00Z', 180).seaState!(0, mid.n, mid.e);
    console.log(`[sea] entrance, 18 kn southerly: ebb Hs ${ebb.hs.toFixed(2)} m L ${ebb.wavelength.toFixed(1)} m steep ${(ebb.steepness * 100).toFixed(1)}% stream ${(ebb.currentAlong / KN).toFixed(1)} kn whitecaps ${(ebb.whitecaps * 100).toFixed(0)}%${ebb.blocked ? ' (blocked)' : ''}; flood Hs ${flood.hs.toFixed(2)} L ${flood.wavelength.toFixed(1)} steep ${(flood.steepness * 100).toFixed(1)}%; fetch ${(ebb.fetch / 1000).toFixed(1)} km`);
    expect(ebb.fetch).toBeGreaterThan(10_000); // open to Start Bay and the Channel
    expect(ebb.currentAlong).toBeLessThan(-0.5);
    expect(ebb.windAgainstTide).toBe(true);
    expect(ebb.steepness).toBeGreaterThan(1.2 * flood.steepness);
    expect(ebb.whitecaps).toBeGreaterThan(flood.whitecaps);
    expect(flood.windAgainstTide).toBe(false);
  });

  it('a short fetch inside the harbour gives small waves; the env reports them', () => {
    const env = conditions('2026-07-15T15:06:00Z', 90); // easterly: across the river off the RDYC
    const s = env.seaState!(0, 0, -150);
    expect(s.fetch).toBeLessThan(800);
    expect(s.hs).toBeLessThan(0.25);
    expect(env.describe!(0, 0, -150).sea?.hs).toBeCloseTo(s.hs, 9);
    expect(Math.abs(s.dirTo - 270 * DEG + 2 * Math.PI) % (2 * Math.PI)).toBeLessThan(0.3);
  });
});
