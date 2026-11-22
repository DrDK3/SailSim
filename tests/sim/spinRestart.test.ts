/**
 * Fixes of 21 Nov 2026, §2.1: the spinnaker call did not survive a restart. A restart that does not pass its own
 * starting controls carries the previous run's controls over (the sheets and trim), but it used to carry the spinnaker
 * call too (`spin`, and the pole-gybe call count `spinGybe`): after hoisting on a run, Reset (or Apply in Conditions,
 * a quick race, the river card's Restart) started the next run with the crew hoisting again, even on a beat. The
 * calls are now cleared at every such restart; a replay still starts from its own recorded controls.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { SimController, DEFAULT_SCENARIO, type AppScenario } from '../../src/app/controller';
import { decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { townQuays, loadDartData, type DartData, type DartFeatures, type TownGridSpec } from '../../src/app/geoLoader';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
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

/** A run in Start Bay with the spinnaker aboard: wind from 225°, heading 30° (a broad run), steady 10 kn, no stream. */
const RUN: AppScenario = {
  ...structuredClone(DEFAULT_SCENARIO),
  spinnaker: true,
  conditions: { ...structuredClone(DEFAULT_SCENARIO.conditions), weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
  startLocation: 'start-bay-practice',
  startHeadingDeg: 30,
  startSpeedKn: 4,
};

/** Hoisted, and the pole gybed once, on the run: the spinnaker is set. */
function hoisted(): SimController {
  const c = new SimController();
  expect(c.restart(structuredClone(RUN))).toBe(true);
  c.callSpinnaker(true);
  c.advance(15);
  expect(c.sim.spin.phase).toBe('up');
  c.gybePole();
  c.advance(12);
  expect(c.sim.input.spin).toBe(1);
  expect(c.sim.input.spinGybe).toBe(1);
  return c;
}

/** After a restart: no call carried over, and 15 s later the spinnaker is still in its bag. */
function cleared(c: SimController): void {
  expect(c.sim.time).toBe(0);
  expect(c.sim.input.spin ?? 0).toBe(0);
  expect(c.sim.input.spinGybe ?? 0).toBe(0);
  c.advance(15);
  expect(c.sim.spin.phase).toBe('down');
  expect(c.sim.spin.deployed).toBe(0);
}

describe('§2.1: a restart starts with the spinnaker calls cleared', () => {
  it('Reset (R): no hoist at the new start', () => {
    const c = hoisted();
    c.requestReset();
    cleared(c);
  });

  it('Reset keeps the sheets and other trim as before (only the spinnaker calls are cleared)', () => {
    const c = hoisted();
    c.setInput({ autoMain: false, mainSheet: 0.42, flatten: 0.3 });
    c.requestReset();
    expect(c.sim.input).toMatchObject({ autoMain: false, mainSheet: 0.42, flatten: 0.3, helm: 0 });
  });

  it('Apply in Conditions (a restart with the edited scenario): no hoist', () => {
    const c = hoisted();
    // Conditions → Apply calls restart(draft): here a beat, where a carried hoist was worst.
    expect(c.restart({ ...structuredClone(RUN), startHeadingDeg: 180 })).toBe(true);
    cleared(c);
  });

  it('starting a quick race: no hoist at the start of the race', () => {
    const c = hoisted();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 0, conditions: 'as-set' })).toBeDefined();
    expect(c.race).toBeDefined();
    cleared(c);
  });

  it('a replay still starts from its own recorded controls (the call it was recorded with is kept)', () => {
    const c = hoisted();
    // A run recorded from a start where the spinnaker had been called for: its starting controls carry the call.
    c.restart(structuredClone(RUN), { initialInput: { ...c.sim.input, helm: 0 } });
    expect(c.sim.input.spin).toBe(1);
    c.advance(3);
    const rec = c.saveRecording('spin');
    expect(rec.initialInput?.spin).toBe(1);
    const r = new SimController();
    expect(r.startReplay(rec)).toBe(true);
    expect(r.sim.input.spin).toBe(1);
  });
});

describe('§2.1: the river card’s Restart starts with the spinnaker calls cleared', () => {
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

  it('a race under way asks; Restart here starts it again, with no hoist', async () => {
    const c = hoisted();
    // A race with the spinnaker called for, then the river arrives: the card asks, and Restart restarts the race.
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 0, conditions: 'as-set' })).toBeDefined();
    c.advance(6);
    c.callSpinnaker(true);
    c.advance(1);
    vi.mocked(loadDartData).mockResolvedValueOnce({ ...data, issues: [] });
    await c.loadDart();
    expect(c.getState().dart.ask).toBe(true);
    c.riverRestart();
    cleared(c);
    // The River Dart data joins the run (about 1.2 s alone): headroom for a loaded CI runner.
  }, 30_000);
});
