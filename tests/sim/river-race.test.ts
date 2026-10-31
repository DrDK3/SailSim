/**
 * Racing on the river, as the app runs it: the controller with the River Dart data (ground, features, quay walls)
 * and so the river traffic, which the AI must keep clear of. The AI trials (`npm run ai:trials -- --river`) race
 * without the traffic, so this is the only place the AI meets ferries and marina boats headless.
 *
 * Regression (31 Oct 2026): the AI's ferry avoidance paired each vessel now with the vessel at the same index a
 * second later; when a boat arrived or left in that second the lists differed, the AI read a vessel that was not
 * there and the physics step threw, freezing the race.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { townQuays, type DartData, type DartFeatures, type TownGridSpec } from '../../src/app/geoLoader';
import { SimController, type DataSource } from '../../src/app/controller';
import { builtInScenarios } from '../../src/app/scenarioLibrary';
import { quickRaceScenario, DEFAULT_QUICK_RACE, NO_LIVE_TIDE_NOTE } from '../../src/app/quickRace';
import { loadDartGeo } from './helpers';

const dir = new URL('../../public/geo/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as DartFeatures;

function loadTown(): { spec: TownGridSpec; values: Float32Array } {
  let buf: Uint8Array = readFileSync(new URL(manifest.town.file, dir));
  if (isGzip(buf)) buf = gunzipSync(buf);
  const t = manifest.town as TownGridSpec;
  return { spec: t, values: Float32Array.from(new Int16Array(decodeGridPlanes(buf, t.nx, t.ny)), (v) => v * t.scale) };
}

/** The controller as the app has it once the River Dart has loaded (no view: headless). */
function riverController(): SimController {
  const c = new SimController();
  const town = loadTown();
  const data: DartData = { geo: loadDartGeo(), features, town, quays: townQuays(town, features), issues: [] };
  c.dartData = data;
  return c;
}

/** Sail the race for `seconds` (the user's boat on the helm's default), checking every boat is still afloat and moving. */
function sail(c: SimController, seconds: number): void {
  for (let s = 0; s < seconds; s += 10) c.advance(10);
}

describe('racing on the river with its traffic', () => {
  it('the library river race runs through its start and first beat', () => {
    const c = riverController();
    const river = builtInScenarios([], true).find((s) => s.id === 'river-range')!;
    expect(river.scenario).toBeDefined();
    expect(c.startSession(structuredClone(river.scenario!))).toBe(true);
    expect(c.traffic).toBeDefined();
    expect(c.race?.session.fleet.boats.length).toBe(4);
    expect(() => sail(c, 480)).not.toThrow();
    const st = c.getState().race!;
    expect(st.log.some((l) => /started/.test(l.text))).toBe(true);
    // The AI boats got going: each has left its starting slot.
    for (const b of c.race!.session.fleet.boats.filter((x) => x.id !== 'you')) {
      expect(c.race!.session.judgeOf(b.id).phase).not.toBe('pre-start');
    }
  }, 240_000);

  it('a quick race on the river (five AI boats) runs through its start', () => {
    const c = riverController();
    const q = quickRaceScenario({ ...DEFAULT_QUICK_RACE, venue: 'river', competitors: 5, conditions: 'random', seed: 1 }, c.scenario);
    expect(c.startSession(q.scenario)).toBe(true);
    expect(c.race?.session.fleet.boats.length).toBe(6);
    expect(() => sail(c, 420)).not.toThrow();
    expect(c.getState().race!.log.some((l) => /started/.test(l.text))).toBe(true);
  }, 240_000);
});

/**
 * Owner report (31 Oct 2026): on the published site, Quick race → the river → Live now said "Could not start:
 * conditions: a tidal stream needs a tide source". The site publishes the live Met Office wind but, so far, no
 * live tide (docs/LIVE_TIDES.md), and the live race asked for the river's tidal stream with no tide to drive it.
 */
describe('a live quick race on the river', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
  const weather: DataSource = { id: 'live/latest.json', kind: 'live', label: 'Live: Met Office UKV', url: 'live/latest.json', json: fixture('metoffice-snapshot-2026-10-22T0715Z.json') };
  const tide: DataSource = { id: 'live/tide.json', kind: 'live', label: 'Live tide: synthetic test predictions', url: 'live/tide.json', json: fixture('tide-snapshot-SYNTHETIC.json'), gaugeUsable: false };
  const LIVE_RIVER = { ...DEFAULT_QUICK_RACE, venue: 'river' as const, conditions: 'live' as const, competitors: 3 };
  // "Now" within the weather recording, so the live race starts at a time the data covers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T07:15:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('starts with the live wind and no live tide: no tidal stream, and the race says so', () => {
    const c = riverController();
    c.weatherSources = [weather];
    const r = c.startQuickRace(LIVE_RIVER);
    expect(c.getState().scenarioError).toBeUndefined();
    expect(r).toBeDefined();
    expect(r!.note).toBe(NO_LIVE_TIDE_NOTE);
    expect(c.scenario.conditions.weather.source).toBe('metoffice');
    expect(c.scenario.conditions.current).toEqual({ mode: 'none' });
    expect(c.race?.session.fleet.boats.length).toBe(4);
    expect(() => sail(c, 60)).not.toThrow();
  }, 120_000);

  it('with a live tide as well, the river has its tide and channel stream', () => {
    const c = riverController();
    c.weatherSources = [weather];
    c.tideSources = [tide];
    const r = c.startQuickRace(LIVE_RIVER);
    expect(c.getState().scenarioError).toBeUndefined();
    expect(r!.note).toBeUndefined();
    expect(r!.summary).toMatch(/Live tide/);
    expect(c.scenario.conditions.tide).toEqual({ mode: 'snapshot', snapshot: tide.json, useGauge: false });
    expect(c.scenario.conditions.current.mode).toBe('dart');
    expect(() => sail(c, 60)).not.toThrow();
  }, 120_000);
});
