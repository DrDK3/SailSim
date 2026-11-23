/**
 * Fixes of 21 Nov 2026, §3.1: feature switches the owner can turn off without changing code (Settings → Advanced, kept in
 * this browser). With each off the simulator behaves as `main` did before the package that added the feature.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FEATURE_FLAGS, FLAG_ORDER, featureOn, flagSetting, plainWords, setFeatureFlag, storedFlag } from '../../src/app/flags';
import { SimController, DEFAULT_SCENARIO, type AppScenario } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { townQuays, loadDartData, type DartData, type DartFeatures, type TownGridSpec } from '../../src/app/geoLoader';
import { loadDartGeo } from './helpers';

vi.mock('../../src/app/geoLoader', async (orig) => ({ ...(await orig<typeof import('../../src/app/geoLoader')>()), loadDartData: vi.fn() }));

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

describe('the switches and their defaults', () => {
  it('six switches; defaults: spinnaker, river, Learn map, race retry on; plain words on at Learn; mark-room penalties off', () => {
    // raceRetry: the design handover's prototype (23 Nov 2026, item 10), on by default so it can be compared off.
    expect(FLAG_ORDER).toEqual(['spinnaker', 'riverHotSwap', 'plainLanguage', 'learnMap', 'markRoomPenalties', 'raceRetry']);
    expect(featureOn('raceRetry')).toBe(true);
    expect(featureOn('spinnaker')).toBe(true);
    expect(featureOn('riverHotSwap')).toBe(true);
    expect(featureOn('learnMap')).toBe(true);
    expect(featureOn('markRoomPenalties')).toBe(false);
    expect(plainWords('learn')).toBe(true);
    expect(plainWords('club')).toBe(false);
    expect(plainWords('expert')).toBe(false);
    for (const f of FLAG_ORDER) expect(FEATURE_FLAGS[f].off.length).toBeGreaterThan(20);
  });

  it('each switches off and back on, and clears to its default', () => {
    for (const f of FLAG_ORDER) {
      setFeatureFlag(f, false);
      expect(storedFlag(f)).toBe(false);
      expect(featureOn(f, 'learn')).toBe(false);
      expect(flagSetting(f)).toBe(false);
      setFeatureFlag(f, true);
      expect(featureOn(f, 'learn')).toBe(true);
      setFeatureFlag(f, undefined);
      expect(storedFlag(f)).toBeUndefined();
    }
    // Plain words switched on still apply only at Learn.
    setFeatureFlag('plainLanguage', true);
    expect(plainWords('club')).toBe(false);
    setFeatureFlag('plainLanguage', false);
    expect(plainWords('learn')).toBe(false);
  });

  it('storage unavailable (a private window): every switch has its default, and setting one does not throw', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(featureOn('spinnaker')).toBe(true);
    expect(featureOn('markRoomPenalties')).toBe(false);
    expect(() => setFeatureFlag('spinnaker', false)).not.toThrow();
  });
});

/** A free sail with the spinnaker aboard (wind from 225°, heading 30°: a run). */
const RUN: AppScenario = {
  ...structuredClone(DEFAULT_SCENARIO),
  spinnaker: true,
  conditions: { ...structuredClone(DEFAULT_SCENARIO.conditions), weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 30,
};

describe('spinnaker: off, nothing carries one (as before package B)', () => {
  it('on (the default): the boat and an AI fleet carry it', () => {
    const c = new SimController();
    c.restart(structuredClone(RUN));
    expect(c.carriesSpinnaker).toBe(true);
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set' })).toBeDefined();
    expect(c.race!.session.fleet.boats.every((b) => !!b.sim.params.spin)).toBe(true);
  });

  it('off: a scenario asking for it, a quick race and free sailing at Club all sail without one; the call does nothing', () => {
    setFeatureFlag('spinnaker', false);
    const c = new SimController();
    c.restart(structuredClone(RUN));
    expect(c.carriesSpinnaker).toBe(false);
    expect(c.sim.params.spin).toBeUndefined();
    c.callSpinnaker(true);
    expect(c.sim.input.spin ?? 0).toBe(0);
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set' })).toBeDefined();
    expect(c.race!.session.fleet.boats.some((b) => !!b.sim.params.spin)).toBe(false);
  });

  it('off: a replay recorded with the spinnaker still sails with it (it re-sails as recorded)', () => {
    const c = new SimController();
    c.restart(structuredClone(RUN));
    c.callSpinnaker(true);
    c.advance(5);
    const rec = c.saveRecording('spin');
    setFeatureFlag('spinnaker', false);
    const r = new SimController();
    expect(r.startReplay(rec)).toBe(true);
    expect(r.carriesSpinnaker).toBe(true);
  });
});

describe('riverHotSwap: off, the river data arriving restarts the run (as before package A)', () => {
  let data: DartData;
  beforeAll(() => {
    const dir = new URL('../../public/geo/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
    const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as DartFeatures;
    let buf: Uint8Array = readFileSync(new URL(manifest.town.file, dir));
    if (isGzip(buf)) buf = gunzipSync(buf);
    const t = manifest.town as TownGridSpec;
    const town = { spec: t, values: Float32Array.from(new Int16Array(decodeGridPlanes(buf, t.nx, t.ny)), (v) => v * t.scale) };
    data = { geo: loadDartGeo(), features, town, quays: townQuays(town, features), issues: [] };
  });
  const sailABit = (c: SimController) => {
    c.press('helmLeft', true);
    c.advance(1);
    c.press('helmLeft', false);
    c.advance(4);
  };

  it('on (the default): a free sail under way is not restarted', async () => {
    const c = new SimController();
    sailABit(c);
    vi.mocked(loadDartData).mockResolvedValueOnce({ ...data, issues: [] });
    await c.loadDart();
    expect(c.sim.time).toBeGreaterThan(4);
    // The River Dart data joins the run (about 1.1 s alone): headroom for a loaded CI runner.
  }, 30_000);

  it('off: the same free sail restarts with the river', async () => {
    setFeatureFlag('riverHotSwap', false);
    const c = new SimController();
    sailABit(c);
    vi.mocked(loadDartData).mockResolvedValueOnce({ ...data, issues: [] });
    await c.loadDart();
    expect(c.sim.time).toBe(0);
    expect(c.sim.seabed).toBe(data.geo);
    expect(c.getState().dart.ask).toBe(false);
  }, 30_000);
});
