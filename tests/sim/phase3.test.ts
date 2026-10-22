/**
 * Phase 3: the River Dart data (projection of landmarks, terrain, provisional bed), grounding (the boat cannot
 * sail through land), the channel-following stream and water levels from the tide.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DART_PROJECTION,
  DEG,
  MEAN_LEVEL_CD,
  Simulation,
  autopilotHelm,
  buildConditions,
  groundContact,
  knToMs,
  squibParams,
  type ConditionsSettings,
} from '../../src/sim/index';
import { loadDartGeo, toKn } from './helpers';

const LONG = 120_000;
const geo = loadDartGeo();
const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as {
  landmarks: { name: string; lat: number; lon: number; e: number; n: number }[];
  marks: { name: string; e: number; n: number }[];
  moorings: { e: number; n: number }[];
};
const reference = JSON.parse(readFileSync(new URL('../fixtures/reference-landmarks.json', import.meta.url), 'utf8')) as {
  landmarks: { name: string; lat: number; lon: number }[];
  pairs: { a: string; b: string; geodesic_m: number }[];
};

/** Mid-river off RDYC (water about 280 m wide here). */
const OFF_RDYC = { n: 0, e: -150 };
const tideAt = (hwTime: string): ConditionsSettings['tide'] => ({ mode: 'manual', hwTime, hwHeightM: 4.8, lwHeightM: 0.6 });

function dartSim(o: { n: number; e: number; headingDeg: number; speedKn?: number; twsKn?: number; twdDeg?: number; tide?: ConditionsSettings['tide']; startTime?: string; current?: ConditionsSettings['current'] }) {
  const built = buildConditions(
    {
      startTime: o.startTime ?? '2026-07-15T12:00:00Z',
      weather: { source: 'manual', twsKn: o.twsKn ?? 10, twdDeg: o.twdDeg ?? 225 },
      gusts: { preset: 'steady', seed: 1 },
      current: o.current ?? { mode: 'none' },
      tide: o.tide,
    },
    geo,
  );
  return new Simulation({
    params: squibParams(),
    env: built.env,
    seabed: geo,
    initial: { n: o.n, e: o.e, headingDeg: o.headingDeg, speedKn: o.speedKn ?? 4 },
    input: { autoMain: true, autoJib: true },
  });
}

describe('Phase 3 acceptance: reference landmarks', () => {
  it('projected distances between the eight reference landmarks match the source data within 2 m', () => {
    expect(reference.landmarks).toHaveLength(8);
    expect(reference.pairs).toHaveLength(28);
    const pos = new Map(features.landmarks.map((l) => [l.name, l]));
    let worst = 0;
    for (const p of reference.pairs) {
      const a = pos.get(p.a)!;
      const b = pos.get(p.b)!;
      const d = Math.hypot(a.n - b.n, a.e - b.e); // what the app uses (public/geo/features.json)
      worst = Math.max(worst, Math.abs(d - p.geodesic_m));
      expect(Math.abs(d - p.geodesic_m), `${p.a} – ${p.b}`).toBeLessThan(2);
    }
    // The app's run-time projection gives the same positions as the pipeline's (to the 0.1 m rounding).
    for (const l of reference.landmarks) {
      const q = DART_PROJECTION.toLocal(l.lat, l.lon);
      const f = pos.get(l.name)!;
      expect(Math.hypot(q.n - f.n, q.e - f.e)).toBeLessThan(0.08);
    }
    console.log(`[phase 3] worst landmark distance error over 28 pairs: ${(worst * 100).toFixed(1)} cm`);
  });
});

describe('River Dart data', () => {
  const level = MEAN_LEVEL_CD - geo.cdBelowOdn;
  it('puts land, water and the drying areas where they belong', () => {
    const at = (name: string) => features.landmarks.find((l) => l.name === name)!;
    for (const name of ['Royal Dart Yacht Club', 'Dartmouth Castle', 'Kingswear Castle', "St Saviour's Church", 'Britannia Royal Naval College']) {
      const l = at(name);
      expect(geo.bedElevation(l.n, l.e), name).toBeGreaterThan(2.5); // above high water
    }
    expect(geo.depth(OFF_RDYC.n, OFF_RDYC.e, level)).toBeGreaterThan(4);
    const [a, b] = [geo.manifest.entrance.a, geo.manifest.entrance.b];
    expect(geo.depth((a[1] + b[1]) / 2, (a[0] + b[0]) / 2, level)).toBeGreaterThan(5);
    // Castle Ledge buoy (the only mark with a stated position) is in water.
    const cl = features.marks.find((m) => m.name === 'Castle Ledge')!;
    expect(geo.depth(cl.n, cl.e, level)).toBeGreaterThan(2);
    // Provisional moorings were only laid in water.
    for (const m of features.moorings) expect(geo.depth(m.n, m.e, level)).toBeGreaterThan(0.5);
  });
});

describe('Phase 3 acceptance: the boat cannot sail through land', () => {
  // Eight shore landmarks (all on land). Start in deep water about 280 m away and steer straight at the
  // landmark, running before 12 kn, for up to five minutes: the boat must ground and stop in the water.
  const targets = ['Royal Dart Yacht Club', 'Dartmouth Castle', 'Kingswear Castle', "St Saviour's Church", 'Kingswear Railway Station', 'Dart Lifeboat Station', 'Royal Castle Hotel', 'Dartmouth Yacht Club'];
  const level = MEAN_LEVEL_CD - geo.cdBelowOdn;
  for (const name of targets) {
    it(`steering at ${name}: grounds at the shore and stops, never onto dry land`, () => {
      const lm = features.landmarks.find((l) => l.name === name)!;
      // Deterministic start: the deepest point 280 m from the landmark.
      let start = { n: 0, e: 0, depth: -Infinity };
      for (let a = 0; a < 360; a += 5) {
        const n = lm.n + 280 * Math.cos(a * DEG);
        const e = lm.e + 280 * Math.sin(a * DEG);
        const d = geo.depth(n, e, level);
        if (d > start.depth) start = { n, e, depth: d };
      }
      expect(start.depth).toBeGreaterThan(3);
      const bearing = (sim: Simulation) => Math.atan2(lm.e - sim.state.e, lm.n - sim.state.n);
      const hdg = (Math.atan2(lm.e - start.e, lm.n - start.n) / DEG + 360) % 360;
      const sim = dartSim({ n: start.n, e: start.e, headingDeg: hdg, speedKn: 5, twsKn: 12, twdDeg: (hdg + 180) % 360, tide: tideAt('2026-07-15T12:00:00Z') });
      sim.controller = (x) => ({ helm: autopilotHelm(x, { mode: 'heading', target: bearing(x) }) });
      let maxBedAboveWater = -Infinity;
      let groundedAt = -1;
      for (let i = 0; i < 30000; i++) {
        sim.stepOnce();
        maxBedAboveWater = Math.max(maxBedAboveWater, geo.bedElevation(sim.state.n, sim.state.e) - sim.waterLevel());
        if (groundedAt < 0 && sim.snapshot(false).grounded) groundedAt = sim.time;
        if (groundedAt > 0 && sim.time > groundedAt + 30) break;
      }
      const s = sim.snapshot(false);
      const left = Math.hypot(lm.n - s.n, lm.e - s.e);
      console.log(`[phase 3] at ${name}: grounded after ${groundedAt.toFixed(1)} s, ${left.toFixed(0)} m short of the landmark, SOG ${toKn(s.sog).toFixed(2)} kn, depth at keel ${s.depthAtKeel.toFixed(2)} m`);
      expect(groundedAt).toBeGreaterThan(0);
      expect(s.grounded).toBe(true);
      expect(toKn(s.sog)).toBeLessThan(0.5);
      // The hull centre never reached ground above the water.
      expect(maxBedAboveWater).toBeLessThan(0);
    }, LONG);
  }

  it('sailing straight at a bank: stops within seconds of touching, with the keel in about its own draft of water', () => {
    // Towards the Kingswear shore just north of RDYC (the bank is about 140 m east).
    const sim = dartSim({ n: 60, e: -150, headingDeg: 90, speedKn: 5, twsKn: 12, twdDeg: 0, tide: tideAt('2026-07-15T12:00:00Z') });
    sim.controller = (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: 90 * DEG }) });
    let touch = -1;
    for (let i = 0; i < 9000 && touch < 0; i++) {
      sim.stepOnce();
      if (sim.snapshot(false).grounded) touch = sim.time;
    }
    expect(touch).toBeGreaterThan(0);
    sim.advance(10);
    const s = sim.snapshot(false);
    expect(s.grounded).toBe(true);
    expect(toKn(s.sog)).toBeLessThan(0.5);
    expect(s.depthAtKeel).toBeGreaterThan(0.5);
    expect(s.depthAtKeel).toBeLessThan(1.2);
    console.log(`[phase 3] bank at 12 kn: touched after ${touch.toFixed(1)} s; 10 s later SOG ${toKn(s.sog).toFixed(2)} kn, depth at keel ${s.depthAtKeel.toFixed(2)} m (draft 0.99 m)`);
  }, LONG);

  it('rising water floats a grounded keel off; falling water grounds it', () => {
    const p = squibParams();
    const state = { n: OFF_RDYC.n, e: OFF_RDYC.e, psi: 0, u: 0.5, v: 0, r: 0, phi: 0, p: 0 };
    const bed = geo.bedElevation(state.n, state.e);
    const dry = groundContact(p, state, { n: 0, e: 0 }, { waterLevel: bed + 0.5, seabed: geo });
    const afloat = groundContact(p, state, { n: 0, e: 0 }, { waterLevel: bed + 3, seabed: geo });
    expect(dry.grounded).toBe(true);
    expect(dry.x).toBeLessThan(0); // opposes the forward motion
    expect(afloat.grounded).toBe(false);
    expect(afloat.x).toBe(0);
  });
});

describe('Channel-following tidal stream (provisional)', () => {
  const stream = { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2.0, riverEbbKn: 0 };
  const mid = { n: (geo.manifest.entrance.a[1] + geo.manifest.entrance.b[1]) / 2, e: (geo.manifest.entrance.a[0] + geo.manifest.entrance.b[0]) / 2 };
  const env = (hw: string) =>
    buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'dart', stream }, tide: tideAt(hw) }, geo).env;

  it('mean speed across the entrance at mid-ebb equals the configured peak; ebb runs seaward, flood up-river', () => {
    const ebb = env('2026-07-15T08:53:00Z'); // ~3.1 h after HW: mid-ebb
    const flood = env('2026-07-15T15:06:00Z'); // ~3.1 h before HW: mid-flood
    const [a, b] = [geo.manifest.entrance.a, geo.manifest.entrance.b];
    let sum = 0;
    let k = 0;
    for (let f = 0.05; f < 0.96; f += 0.05) {
      const c = ebb.current(0, a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f);
      if (Math.hypot(c.n, c.e) > 0) {
        sum += Math.hypot(c.n, c.e);
        k++;
      }
    }
    expect(toKn(sum / k)).toBeGreaterThan(1.7);
    expect(toKn(sum / k)).toBeLessThan(2.3);
    const e1 = ebb.current(0, mid.n, mid.e);
    const f1 = flood.current(0, mid.n, mid.e);
    expect(e1.n).toBeLessThan(0); // seaward (south)
    expect(f1.n).toBeGreaterThan(0);
    expect(e1.n * f1.n + e1.e * f1.e).toBeLessThan(0);
  });

  it('runs faster in the narrows than in the wide reaches, is slack in creeks and zero on land', () => {
    const ebb = env('2026-07-15T08:53:00Z');
    const sp = (n: number, e: number) => toKn(Math.hypot(ebb.current(0, n, e).n, ebb.current(0, n, e).e));
    const offRdyc = sp(OFF_RDYC.n, OFF_RDYC.e);
    const oldMillCreek = sp(1700, -1100);
    const land = sp(0, 300);
    expect(offRdyc).toBeGreaterThan(1.0);
    expect(oldMillCreek).toBeLessThan(0.5 * offRdyc);
    expect(land).toBe(0);
    console.log(`[phase 3] mid-ebb, 2 kn at the entrance: off RDYC ${offRdyc.toFixed(2)} kn, Old Mill Creek ${oldMillCreek.toFixed(2)} kn`);
  });

  it('water level follows the tide in metres above ODN (chart datum 2.62 m below ODN)', () => {
    const e = env('2026-07-15T12:00:00Z');
    expect(e.waterLevel!(0)).toBeCloseTo(4.8 - geo.cdBelowOdn, 6);
    const noTide = buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 0 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }, geo).env;
    expect(noTide.waterLevel!(0)).toBeCloseTo(MEAN_LEVEL_CD - geo.cdBelowOdn, 6);
  });

  it('a run with the Dart data, grounding and the channel stream is reproducible', () => {
    const run = () => {
      const sim = dartSim({ ...OFF_RDYC, headingDeg: 170, twsKn: 12, twdDeg: 270, tide: tideAt('2026-07-15T09:00:00Z'), current: { mode: 'dart', stream } });
      sim.controller = (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: 170 * DEG }) });
      sim.advance(120);
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  }, LONG);

  it('drifting with no wind, the boat moves with the stream over the ground', () => {
    const sim = dartSim({ ...OFF_RDYC, headingDeg: 180, speedKn: 0, twsKn: 0, tide: tideAt('2026-07-15T08:53:00Z'), current: { mode: 'dart', stream } });
    sim.advance(30);
    const s = sim.snapshot(false);
    const c = s.current;
    expect(Math.hypot(c.n, c.e)).toBeGreaterThan(knToMs(1));
    expect(Math.abs(s.sog - Math.hypot(c.n, c.e))).toBeLessThan(0.15);
  }, LONG);
});
