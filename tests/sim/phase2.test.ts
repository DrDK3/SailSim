/**
 * Phase 2 tests: dynamic roll, hinged boom (criterion 5), environment models (gusts, grid wind, tide,
 * tidal stream, live snapshot parsing), geodesy, and reproducibility with the full environment.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEG,
  GUST_PRESETS,
  M2_PERIOD_S,
  RDYC_ORIGIN,
  Simulation,
  WindField,
  autopilotHelm,
  buildConditions,
  createLocalProjection,
  gridBase,
  haversine,
  manualTide,
  parseMetOfficeSnapshot,
  parseTideSnapshot,
  shearCurrent,
  snapshotTide,
  squibParams,
  tidalStream,
  trueWindAngle,
  uniformBase,
  uniformEnvironment,
  type Environment,
} from '../../src/sim/index';
import { rightingArm } from '../../src/sim/boat/dynamics';
import { determinismSim } from '../../src/sim/testing/determinism';
import { KN, toKn } from './helpers';

const LONG = 120_000;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('Dynamic roll (4-DOF)', () => {
  it('free roll decay has the small-angle natural period and decays monotonically', () => {
    const p = squibParams({ crewSpeed: 0 });
    const sim = new Simulation({ params: p, env: uniformEnvironment({ twsKn: 0, twdDeg: 0 }), initial: { headingDeg: 0 }, input: { autoCrew: false } });
    sim.act.crewY = 0;
    sim.state.phi = 15 * DEG;
    const peaks: [number, number][] = [];
    let prev = sim.state.phi;
    let prev2 = prev;
    for (let i = 0; i < 1500; i++) {
      sim.stepOnce();
      const x = sim.state.phi;
      if (prev > prev2 && prev > x) peaks.push([sim.time, prev]);
      prev2 = prev;
      prev = x;
    }
    const theory = 2 * Math.PI * Math.sqrt(p.i44 / (p.weight * p.gm));
    const period = (peaks[3]![0] - peaks[0]![0]) / 3;
    expect(Math.abs(period - theory) / theory).toBeLessThan(0.05);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]![1]).toBeLessThan(peaks[i - 1]![1]);
  });

  it('righting arm: odd, initial slope = GM, maximum near 50–60°, vanishing stability beyond 110°', () => {
    const p = squibParams();
    expect(rightingArm(p, -0.3)).toBeCloseTo(-rightingArm(p, 0.3), 12);
    expect(rightingArm(p, 1 * DEG) / Math.sin(1 * DEG)).toBeCloseTo(p.gm, 1);
    expect(rightingArm(p, 55 * DEG)).toBeGreaterThan(rightingArm(p, 30 * DEG));
    expect(rightingArm(p, 55 * DEG)).toBeGreaterThan(rightingArm(p, 80 * DEG));
    expect(rightingArm(p, 120 * DEG)).toBeLessThan(0);
  });

  for (const tws of [10, 15]) {
    it(`steady sailing: dynamic heel settles to the static equilibrium (TWS ${tws} kn)`, () => {
      const sim = new Simulation({
        params: squibParams(), env: uniformEnvironment({ twsKn: tws, twdDeg: 0 }), initial: { headingDeg: 45, speedKn: 4.5 },
        input: { autoMain: true, autoJib: true }, controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: 45 * DEG }) }),
      });
      sim.advance(90);
      const s = sim.snapshot();
      expect(Math.abs(s.heel - s.heelEquilibrium) / DEG).toBeLessThan(1);
      expect(Math.abs(s.rollRate) / DEG).toBeLessThan(0.5);
      expect(s.heel).toBeLessThan(0); // starboard tack heels to port
    }, LONG);
  }

  it('helm balance: slight weather helm close-hauled, growing with wind', () => {
    const balance = (tws: number) => {
      const sim = new Simulation({
        params: squibParams(), env: uniformEnvironment({ twsKn: tws, twdDeg: 0 }), initial: { headingDeg: 40, speedKn: 4.5 },
        input: { autoMain: true, autoJib: true }, controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: 40 * DEG }) }),
      });
      sim.advance(90);
      return sim.snapshot().helmBalance / DEG;
    };
    const b10 = balance(10);
    const b15 = balance(15);
    expect(b10).toBeGreaterThan(0);
    expect(b15).toBeGreaterThan(b10);
    expect(b15).toBeLessThan(8);
  }, LONG);
});

describe('Criterion 5: the gybe emerges from the boom dynamics', () => {
  function bearAwayThroughGybe(tws: number, mainSheet: number) {
    let target = 160;
    const sim = new Simulation({
      params: squibParams(), env: uniformEnvironment({ twsKn: tws, twdDeg: 0 }), initial: { headingDeg: -160, speedKn: 4 },
      input: { autoMain: false, mainSheet, autoJib: true },
      controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: (target > 180 ? target - 360 : target) * DEG }) }),
    });
    sim.advance(30);
    const res = { crossedAtByTheLee: NaN, maxRate: 0, maxBoom: 0, maxHeadingStep: 0, limit: 0 };
    let lastHeading = sim.state.psi;
    for (let i = 0; i < 6000; i++) {
      target = Math.min(target + 0.01, 200); // bear away at 1°/s
      const before = sim.act.boomMain;
      sim.stepOnce();
      res.maxRate = Math.max(res.maxRate, Math.abs(sim.act.boomRate));
      res.maxBoom = Math.max(res.maxBoom, Math.abs(sim.act.boomMain));
      const dpsi = Math.abs(Math.atan2(Math.sin(sim.state.psi - lastHeading), Math.cos(sim.state.psi - lastHeading)));
      res.maxHeadingStep = Math.max(res.maxHeadingStep, dpsi);
      lastHeading = sim.state.psi;
      if (Number.isNaN(res.crossedAtByTheLee) && before > 0 && sim.act.boomMain <= 0) res.crossedAtByTheLee = 180 - Math.abs(trueWindAngle(sim) / DEG);
    }
    res.limit = sim.snapshot().mainSheetLimit;
    return { ...res, final: sim.snapshot() };
  }

  it('bearing away past dead downwind gybes the boom with no command; swing bounded by the sheet', () => {
    const eased = bearAwayThroughGybe(10, 1);
    expect(eased.crossedAtByTheLee).toBeGreaterThan(0);
    expect(eased.crossedAtByTheLee).toBeLessThan(30);
    expect(eased.final.boomMain).toBeLessThan(0); // now on the other side
    expect(eased.maxBoom).toBeLessThanOrEqual(eased.limit + 1e-9);
    expect(eased.maxHeadingStep / DEG).toBeLessThan(1); // heading continuous (per 10 ms step)
    expect(eased.final.lastBoomEvent).not.toBeNull(); // the boom fetched up against the sheet/shrouds

    const halfSheet = bearAwayThroughGybe(10, 0.5);
    expect(halfSheet.maxBoom).toBeLessThanOrEqual(halfSheet.limit + 1e-9);
    // A crash gybe with the sheet eased is more violent than a controlled one with the sheet half in.
    expect(eased.maxRate).toBeGreaterThan(halfSheet.maxRate);
  }, LONG);

  it('head to wind the boom weathervanes to the centreline (luffing)', () => {
    const sim = new Simulation({ params: squibParams(), env: uniformEnvironment({ twsKn: 10, twdDeg: 0 }), initial: { headingDeg: 0, speedKn: 0 }, input: { autoMain: false, mainSheet: 1 }, lockHeading: true });
    sim.advance(20);
    expect(Math.abs(sim.act.boomMain) / DEG).toBeLessThan(3);
    expect(sim.snapshot().forces.main.luff).toBeLessThan(0.1);
  });
});

describe('Wind field: seeded gusts, shifts and puffs', () => {
  const area = { n: 0, e: 0, radius: 2500 };
  it('is reproducible for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const f = new WindField(uniformBase(5, 0), { ...GUST_PRESETS.moderate, seed }, area);
      const out: number[] = [];
      for (let i = 0; i < 3000; i++) {
        f.step(i * 0.01, 0.01);
        if (i % 100 === 0) out.push(f.sample(100, -200).speed);
      }
      return out;
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('steady preset reproduces the base wind exactly', () => {
    const f = new WindField(uniformBase(5, 1), GUST_PRESETS.steady, area);
    for (let i = 0; i < 500; i++) f.step(0, 0.01);
    expect(f.sample(300, 300)).toEqual({ speed: 5, fromDir: 1, gustFactor: 1 });
  });

  it('oscillating shifts have the configured standard deviation (±15%) and zero mean', () => {
    // Short correlation time so 4000 s holds ~200 independent samples (sampling error ~5%).
    const s = { ...GUST_PRESETS.moderate, seed: 11, puffsPerKm2PerMin: 0, shiftPeriodS: 20 };
    const f = new WindField(uniformBase(5, 0), s, area);
    let sum = 0;
    let sum2 = 0;
    const n = 400_000; // 4000 s ≈ 22 correlation times
    for (let i = 0; i < n; i++) {
      f.step(0, 0.01);
      const x = f.fluctuations().shift / DEG;
      sum += x;
      sum2 += x * x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sum2 / n - mean * mean);
    expect(Math.abs(sd - s.shiftSdDeg) / s.shiftSdDeg).toBeLessThan(0.15);
    expect(Math.abs(mean)).toBeLessThan(s.shiftSdDeg * 0.5);
  });

  it('puffs drift downwind', () => {
    const f = new WindField(uniformBase(6, 0), { ...GUST_PRESETS.moderate, seed: 5 }, area); // wind from north
    const before = f.puffs().map((p) => ({ ...p }));
    expect(before.length).toBeGreaterThan(0);
    for (let i = 0; i < 1000; i++) f.step(0, 0.01);
    const after = f.puffs();
    // Track a puff that survived (puffs are identified by their random radius).
    const p0 = before.find((b) => after.some((a) => a.radius === b.radius))!;
    expect(p0).toBeDefined();
    const p1 = after.find((a) => a.radius === p0.radius)!;
    expect(p1.n - p0.n).toBeLessThan(-40); // moved south ~54 m in 10 s
    expect(Math.abs(p1.e - p0.e)).toBeLessThan(1e-9);
  });

  it('gusts make the boat heel and speed vary; steady wind does not', () => {
    const run = (preset: 'steady' | 'shifty') => {
      const sim = new Simulation({
        params: squibParams(),
        env: buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 12, twdDeg: 0 }, gusts: { preset, seed: 9 }, current: { mode: 'none' } }).env,
        initial: { headingDeg: 50, speedKn: 4.5 }, input: { autoMain: true, autoJib: true, autoCrew: false, crewHike: 0.8 },
        controller: (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: 50 * DEG }) }),
      });
      sim.advance(30);
      const heel: number[] = [];
      for (let i = 0; i < 120; i++) {
        sim.advance(1);
        heel.push(sim.state.phi / DEG);
      }
      const m = heel.reduce((a, b) => a + b) / heel.length;
      return Math.sqrt(heel.reduce((a, b) => a + (b - m) ** 2, 0) / heel.length);
    };
    expect(run('steady')).toBeLessThan(0.05);
    expect(run('shifty')).toBeGreaterThan(1);
  }, LONG);
});

describe('Spatial wind grid and geodesy', () => {
  it('local projection round-trips and matches great-circle distances', () => {
    const proj = createLocalProjection(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    for (const [lat, lon] of [[50.3418, -3.56572], [50.38, -3.6], [50.30, -3.52]] as const) {
      const { n, e } = proj.toLocal(lat, lon);
      const back = proj.toLatLon(n, e);
      expect(Math.abs(back.lat - lat) * 111_000).toBeLessThan(0.001);
      expect(Math.abs(back.lon - lon) * 71_000).toBeLessThan(0.001);
      const d = Math.hypot(n, e);
      const h = haversine(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon, lat, lon);
      expect(Math.abs(d - h) / h).toBeLessThan(0.003); // sphere vs ellipsoid difference
    }
    // RDYC to Dartmouth Castle: 880 m on bearing ~142° (docs/RESEARCH_REPORT.md §3).
    const c = proj.toLocal(50.3418, -3.56572);
    expect(Math.hypot(c.n, c.e)).toBeGreaterThan(870);
    expect(Math.hypot(c.n, c.e)).toBeLessThan(890);
  });

  it('grid base wind reproduces node values and interpolates linearly between them', () => {
    const nodes = [0, 1].map((i) => [0, 1].map((j) => ({ n: i * 2000, e: j * 2000, speed: 5 + i * 2 + j, fromDir: 0 })));
    const g = gridBase(nodes);
    expect(g.at(0, 0).speed).toBeCloseTo(5, 9);
    expect(g.at(2000, 2000).speed).toBeCloseTo(8, 9);
    expect(g.at(1000, 1000).speed).toBeCloseTo(6.5, 9);
    expect(g.at(-5000, 0).speed).toBeCloseTo(5, 9); // clamped outside
  });

  it('parses the real Met Office snapshot into a wind field consistent with its RDYC point', () => {
    const json = fixture('metoffice-snapshot-2026-10-22T0715Z.json');
    const snap = parseMetOfficeSnapshot(json);
    const built = buildConditions({ startTime: snap.model.valid!, weather: { source: 'metoffice', snapshot: json, replay: true }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } });
    const w = built.env.windField!.sample(0, 0);
    const pt = snap.model.points!['rdyc_kingswear']!;
    expect(Math.abs(toKn(w.speed) - pt.speed_kn)).toBeLessThan(1.0);
    const dDir = Math.abs(Math.atan2(Math.sin(w.fromDir - pt.wind_from_deg * DEG), Math.cos(w.fromDir - pt.wind_from_deg * DEG))) / DEG;
    expect(dDir).toBeLessThan(5);
    expect(built.weather.kind).toBe('replay');
    expect(built.weather.attribution).toContain('Met Office');
    expect(() => parseMetOfficeSnapshot({ model: { available: false } })).toThrow(/not available/);
    expect(() => parseMetOfficeSnapshot({ model: { available: true, valid: 'x', grid: { lat: [[1]] } } })).toThrow(/grid/);
  });
});

describe('Tide height and tidal stream', () => {
  const hw = Date.parse('2026-07-15T14:00:00Z');
  const half = (M2_PERIOD_S * 1000) / 2;

  it('manual tide: HW and LW heights at the right times; rising before HW, falling after', () => {
    const t = manualTide(hw, 4.6, 1.2);
    expect(t.at(hw).height).toBeCloseTo(4.6, 9);
    expect(t.at(hw + half).height).toBeCloseTo(1.2, 9);
    expect(t.at(hw - half / 2).height).toBeCloseTo(2.9, 9);
    expect(t.at(hw - 3600e3).rising).toBe(true);
    expect(t.at(hw + 3600e3).rising).toBe(false);
    expect(Math.abs(t.at(hw).phase)).toBeLessThan(1e-9);
    expect(t.at(hw - half / 2).phase).toBeCloseTo(1, 9);
    expect(t.at(hw + 5 * 3600e3).hoursSinceHW).toBeCloseTo(5, 6);
  });

  it('tidal stream: slack at HW and LW, peak flood/ebb at mid-tide, opposite directions, river bias', () => {
    const t = manualTide(hw, 4.6, 1.2);
    const c = tidalStream(t, { floodSetDeg: 90, peakFloodKn: 1.5, peakEbbKn: 2.0, riverEbbKn: 0 });
    expect(toKn(Math.hypot(c.at(hw, 0, 0).n, c.at(hw, 0, 0).e))).toBeLessThan(1e-6);
    expect(toKn(Math.hypot(c.at(hw + half, 0, 0).n, c.at(hw + half, 0, 0).e))).toBeLessThan(1e-6);
    const flood = c.at(hw - half / 2, 0, 0);
    const ebb = c.at(hw + half / 2, 0, 0);
    expect(toKn(flood.e)).toBeCloseTo(1.5, 6);
    expect(toKn(ebb.e)).toBeCloseTo(-2.0, 6);
    const withRiver = tidalStream(t, { floodSetDeg: 90, peakFloodKn: 1.5, peakEbbKn: 2.0, riverEbbKn: 0.5 });
    expect(toKn(withRiver.at(hw, 0, 0).e)).toBeCloseTo(-0.5, 6);
  });

  it('tide snapshot: parses, applies the gauge residual, rejects malformed files', () => {
    const json = fixture('tide-snapshot-SYNTHETIC.json');
    const tide = snapshotTide(parseTideSnapshot(json));
    expect(tide.residual).toBeCloseTo(0.1, 6);
    expect(tide.at(Date.parse('2026-07-15T14:12:38Z')).height).toBeCloseTo(5.1, 6);
    expect(() => parseTideSnapshot({ kind: 'live', generated: 'x', predictions: { events: [] } })).toThrow(/two/);
    expect(() => parseTideSnapshot({ kind: 'other' })).toThrow(/kind/);
  });

  it('criterion 7 (fields): in a sheared current, with the air moving with the water, the boat drifts with it', () => {
    const cur = shearCurrent(0.002); // 0.2 m/s per 100 m of northing
    // Air moving with the water (no apparent wind): isolates the kinematics. In still air a drifting boat
    // would correctly feel an apparent wind and move through the water.
    const env: Environment = { label: 'test', wind: (_t, n, e) => cur.at(0, n, e), current: (_t, n, e) => cur.at(0, n, e) };
    const sim = new Simulation({ params: squibParams(), env, initial: { headingDeg: 0, n: 300 } });
    sim.advance(60);
    const s = sim.snapshot();
    expect(toKn(s.stw)).toBeLessThan(0.05);
    expect(Math.abs(s.sog - 0.002 * s.n)).toBeLessThan(0.01);
  }, LONG);

  it('flags wind against tide only when they oppose with enough of both', () => {
    const mk = (twdDeg: number, setDeg: number) =>
      buildConditions({
        startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 15, twdDeg }, gusts: { preset: 'steady', seed: 1 },
        current: { mode: 'uniform', setDeg, rateKn: 1.5 },
      }).env.describe!(0, 0, 0).windAgainstTide;
    expect(mk(0, 0)).toBe(true); // wind from north (blowing south) against a north-going current
    expect(mk(180, 0)).toBe(false); // wind with tide
  });
});

describe('Criterion 11 with the full environment (gusts, shifts, tidal stream)', () => {
  it('600 s run is bit-identical between runs', () => {
    const a = determinismSim();
    a.advance(600);
    const b = determinismSim();
    b.advance(600);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(Math.hypot(a.state.n, a.state.e)).toBeGreaterThan(300);
    expect(KN).toBeGreaterThan(0);
  }, LONG);
});
