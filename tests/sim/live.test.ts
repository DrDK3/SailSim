import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEG } from '../../src/sim/math/angles';
import { timeSteppedBase, uniformBase } from '../../src/sim/env/wind';
import { metOfficeBase, parseMetOfficeSnapshot, snapshotCoverageEnd, type MetOfficeSnapshot } from '../../src/sim/env/weather';
import { describeSky, extinctionPerM, modelSky, presetSky, SKY_PRESETS } from '../../src/sim/env/sky';
import { loadLive, parseLiveIndex, tideFreshness, weatherFreshness, LIVE_INDEX_SCHEMA } from '../../src/sim/env/liveData';
import { buildConditions } from '../../src/sim/env/conditions';
import type { TideSnapshot } from '../../src/sim/env/tide';

const live = (f: string) => JSON.parse(readFileSync(new URL(`../../public/live/${f}`, import.meta.url), 'utf8'));
/** A real squib-weather/2 file written by tools/ingest/weather.py (Met Office UKV run 10:00Z, 23 Oct 2026). */
const V2 = live('metoffice-replay-2026-10-23T1400Z.json') as MetOfficeSnapshot;
const V1 = live('metoffice-replay-2026-10-22T0715Z.json') as MetOfficeSnapshot;
const at = (iso: string) => Date.parse(iso);

describe('time-stepped forecast wind (squib-weather/2)', () => {
  it('interpolates wind vectors linearly in time and holds the end steps', () => {
    const b = timeSteppedBase([
      { t: 0, base: uniformBase(10, 0) },
      { t: 900, base: uniformBase(10, 90 * DEG) },
    ]);
    expect(b.at(0, 0, -50)).toEqual({ speed: 10, fromDir: 0 });
    expect(b.at(0, 0, 2000)).toEqual({ speed: 10, fromDir: 90 * DEG });
    const mid = b.at(0, 0, 450);
    expect(mid.fromDir / DEG).toBeCloseTo(45, 9);
    expect(mid.speed).toBeCloseTo(10 * Math.SQRT1_2, 9); // vector average of perpendicular winds
    expect(() => timeSteppedBase([{ t: 5, base: uniformBase(1, 0) }, { t: 5, base: uniformBase(1, 0) }])).toThrow();
  });

  it('follows the real forecast: each 15-minute step at its valid time, in between in between', () => {
    const snap = parseMetOfficeSnapshot(V2);
    const steps = snap.model.steps!;
    expect(steps.length).toBe(9);
    expect(snapshotCoverageEnd(snap)).toBe(steps[8]!.valid);
    const start = at(steps[0]!.valid);
    const timed = metOfficeBase(snap, start);
    // At each step's time, the same field as a single-step snapshot of that step.
    for (const k of [0, 4, 8]) {
      const single = metOfficeBase({ ...snap, model: { ...snap.model, steps: undefined, grid: { ...snap.model.grid!, ...steps[k]! } } });
      const t = (at(steps[k]!.valid) - start) / 1000;
      for (const [n, e] of [[0, 0], [-1500, 800], [2000, -1000]] as const) {
        const a = timed.at(n, e, t);
        const b = single.at(n, e);
        expect(a.speed).toBeCloseTo(b.speed, 9);
        expect(a.fromDir).toBeCloseTo(b.fromDir, 9);
      }
    }
    // A single-step (squib-weather/1) file still gives a steady field, as before.
    const v1 = metOfficeBase(parseMetOfficeSnapshot(V1), at(V1.model.valid!));
    expect(v1.at(0, 0, 0)).toEqual(v1.at(0, 0, 3600));
  });

  it('rejects malformed steps', () => {
    const bad = structuredClone(V2);
    bad.model.steps![3]!.valid = bad.model.steps![2]!.valid;
    expect(() => parseMetOfficeSnapshot(bad)).toThrow(/not increasing/);
    const bad2 = structuredClone(V2);
    bad2.model.steps![1]!.speed_kn = [[1, 2]];
    expect(() => parseMetOfficeSnapshot(bad2)).toThrow(/wrong shape/);
  });

  it('a run with live weather sees the wind change through the forecast (deterministically)', () => {
    const steps = V2.model.steps!;
    const cond = { startTime: steps[0]!.valid.replace('Z', ':00Z'), weather: { source: 'metoffice' as const, snapshot: V2 }, gusts: { preset: 'steady' as const, seed: 1 }, current: { mode: 'none' as const } };
    const a = buildConditions(cond).env;
    const w0 = a.wind(0, 0, 0);
    for (let i = 0; i < 7200 * 100; i += 1000) a.step!(i / 100, 10); // step the field 2 h in 10 s steps
    const w1 = a.wind(7200, 0, 0);
    expect(Math.hypot(w1.n - w0.n, w1.e - w0.e)).toBeGreaterThan(0); // the forecast changes over two hours
    const b = buildConditions(cond).env;
    for (let i = 0; i < 7200 * 100; i += 1000) b.step!(i / 100, 10);
    expect(b.wind(7200, 0, 0)).toEqual(w1);
  });
});

describe('sky (visual only)', () => {
  it('reads the forecast sky and interpolates it hourly', () => {
    const start = at(V2.model.steps![0]!.valid);
    const sky = modelSky(V2.model.sky!, start, 'test');
    const s0 = sky.at(0);
    expect(s0.cloud).toBeGreaterThanOrEqual(0);
    expect(s0.cloud).toBeLessThanOrEqual(1);
    expect(s0.visibilityM).toBeGreaterThan(0);
    const a = sky.at(0);
    const b = sky.at(3600);
    const mid = sky.at(1800);
    expect(mid.cloud).toBeCloseTo((a.cloud + b.cloud) / 2, 9);
    expect(mid.visibilityM).toBeCloseTo(Math.sqrt(a.visibilityM * b.visibilityM), 6);
  });

  it('presets and descriptions', () => {
    expect(presetSky('fog').at(123).visibilityM).toBe(300);
    expect(describeSky(SKY_PRESETS.fog)).toContain('(fog)');
    expect(describeSky(SKY_PRESETS['heavy-rain'])).toContain('heavy rain');
    expect(extinctionPerM(3912)).toBeCloseTo(0.001, 12);
    // Met Office weather defaults to the forecast's sky; a file without sky fields gets the fair preset.
    expect(buildConditions({ startTime: V2.model.valid!.replace('Z', ':00Z'), weather: { source: 'metoffice', snapshot: V2 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }).sky.kind).toBe('model');
    expect(buildConditions({ startTime: '2026-10-22T07:15:00Z', weather: { source: 'metoffice', snapshot: V1, replay: true }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }).sky.label).toContain('Fair');
  });
});

describe('live data: index and freshness', () => {
  it('weather: fresh while the forecast covers now and the job runs, then stale, then expired', () => {
    // V2: generated about 14:05Z, steps 14:00Z .. 16:00Z.
    expect(weatherFreshness(V2, at('2026-10-23T14:30:00Z')).status).toBe('fresh');
    const late = weatherFreshness(V2, at('2026-10-23T15:50:00Z')); // job not updated for 105 min
    expect(late.status).toBe('stale');
    expect(late.message).toContain('not updated');
    const ended = weatherFreshness(V2, at('2026-10-23T16:40:00Z'));
    expect(ended.status).toBe('stale');
    expect(ended.message).toContain('forecast ended at 16:00 UTC');
    expect(weatherFreshness(V2, at('2026-10-23T23:00:00Z')).status).toBe('expired');
  });

  it('tide: the gauge residual is used only while the reading is recent', () => {
    // A synthetic snapshot in the ingest format (not real data).
    const snap: TideSnapshot = {
      kind: 'live',
      generated: '2026-10-23T12:00:00Z',
      predictions: { source: 'synthetic test', events: [
        { time: '2026-10-23T06:00:00Z', type: 'LW', heightCD: 1.0 },
        { time: '2026-10-23T12:12:00Z', type: 'HW', heightCD: 4.5 },
        { time: '2026-10-23T18:25:00Z', type: 'LW', heightCD: 1.1 },
      ] },
      gauge: { source: 'synthetic', station: 'test', cdOffsetM: 2.62, readings: [{ time: '2026-10-23T11:45:00Z', mAOD: 1.9 }] },
    };
    expect(tideFreshness(snap, at('2026-10-23T12:15:00Z'))).toMatchObject({ status: 'fresh', gaugeUsable: true });
    expect(tideFreshness(snap, at('2026-10-23T13:30:00Z'))).toMatchObject({ status: 'stale', gaugeUsable: false });
    expect(tideFreshness(snap, at('2026-10-24T01:00:00Z')).status).toBe('expired');
  });

  it('reads the tide.json the ingest writes (the same example file its Python test checks)', () => {
    const ex = JSON.parse(readFileSync(new URL('../../tools/ingest/fixtures/tide-snapshot.example.json', import.meta.url), 'utf8'));
    const l = loadLive({ path: 'tide.json', kind: 'tide', mode: 'live' }, ex, at('2026-10-23T12:00:00Z'));
    expect(l.kind).toBe('tide');
    expect(l.freshness).toMatchObject({ status: 'fresh', gaugeUsable: true });
    const t = buildConditions({ startTime: '2026-10-23T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 200 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' }, tide: { mode: 'snapshot', snapshot: ex, useGauge: true } }).tide!;
    expect(t.notes.join(' ')).toContain('residual');
    const noGauge = buildConditions({ startTime: '2026-10-23T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 200 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' }, tide: { mode: 'snapshot', snapshot: ex, useGauge: false } }).tide!;
    expect(noGauge.notes.join(' ')).toContain('not applied');
    expect(t.at(at('2026-10-23T12:00:00Z')).height).not.toBe(noGauge.at(at('2026-10-23T12:00:00Z')).height);
  });

  it('the index keeps only safe, known entries', () => {
    const idx = parseLiveIndex({
      schema: LIVE_INDEX_SCHEMA,
      files: [
        { path: 'latest.json', kind: 'weather', mode: 'live' },
        { path: '../secrets.json', kind: 'weather', mode: 'live' },
        { path: 'x.json', kind: 'stock-prices', mode: 'live' },
        { path: 'tide.json', kind: 'tide', mode: 'live' },
      ],
    });
    expect(idx.files.map((f) => f.path)).toEqual(['latest.json', 'tide.json']);
    expect(() => parseLiveIndex({ files: [] })).toThrow(/schema/);
  });

  it('every file listed in the shipped live/index.json loads', () => {
    const idx = parseLiveIndex(live('index.json'));
    expect(idx.files.length).toBeGreaterThanOrEqual(2);
    for (const f of idx.files) {
      const l = loadLive(f, live(f.path), Date.now());
      expect(l.kind).toBe(f.kind);
    }
  });
});
