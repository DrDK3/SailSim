import { DEG } from '../math/angles';
import { knToMs } from '../units';
import { composeEnvironment, type Environment, type WeatherInfo } from './environment';
import { DEFAULT_TIDAL_STREAM, NO_CURRENT, dartStream, tidalStream, uniformCurrent, type CurrentModel, type StreamPattern, type TidalStreamSettings } from './current';
import { manualTide, memoTide, parseTideSnapshot, snapshotTide, type TideSource } from './tide';
import { GUST_PRESETS, WindField, uniformBase, type GustSettings } from './wind';
import { gustsFromSnapshot, metOfficeBase, metOfficeInfo, parseMetOfficeSnapshot } from './weather';
import { modelSky, presetSky, SKY_PRESETS, type SkyPreset, type SkySource } from './sky';
import { TerrainWind } from './terrainWind';
import { DepthWeight, STREAM_ANOMALIES } from './streamAnomalies';

/**
 * A complete, serialisable description of the conditions for a run. Scenario files, the app's scenario
 * panel and replays all build their Environment from one of these, so a run can be reproduced exactly.
 */
export interface ConditionsSettings {
  /** Real-world start time of the run (ISO); drives tides. */
  startTime: string;
  weather:
    | { source: 'manual'; twsKn: number; twdDeg: number }
    | { source: 'metoffice'; snapshot: unknown; replay?: boolean };
  /** Preset name or explicit settings; `seed` makes the fluctuations reproducible. */
  gusts: { preset: keyof typeof GUST_PRESETS | 'from-data'; seed: number; overrides?: Partial<GustSettings> };
  current:
    | { mode: 'none' }
    | { mode: 'uniform'; setDeg: number; rateKn: number }
    | { mode: 'tidal'; stream: TidalStreamSettings }
    /** Channel-following pattern over the River Dart (needs the geodata); floodSetDeg is not used. */
    | { mode: 'dart'; stream: TidalStreamSettings };
  tide?:
    | { mode: 'manual'; hwTime: string; hwHeightM: number; lwHeightM: number }
    | { mode: 'snapshot'; snapshot: unknown; useGauge?: boolean };
  /**
   * Cloud, visibility and rain (visual only). 'data' uses the Met Office snapshot's sky fields when it has
   * them, else the 'fair' preset. Default: 'data' with Met Office weather, otherwise the 'clear' preset.
   */
  sky?: { source: 'preset'; preset: SkyPreset } | { source: 'data' };
  /**
   * The land's effect on the wind over the River Dart (shelter, valley steering; src/sim/env/terrainWind.ts).
   * On unless false; it needs the River Dart data.
   */
  landEffects?: boolean;
}

export const DEFAULT_CONDITIONS: ConditionsSettings = {
  startTime: '2026-07-15T13:00:00Z',
  weather: { source: 'manual', twsKn: 10, twdDeg: 225 },
  gusts: { preset: 'steady', seed: 1 },
  current: { mode: 'none' },
};

/** Mean water level (m above chart datum) used with the River Dart data when no tide is set (E). */
export const MEAN_LEVEL_CD = 2.7;

/** What the River Dart data contributes to the conditions (DartGeo implements it). */
export interface ConditionsGeo extends StreamPattern {
  cdBelowOdn: number;
  /** Land and bed (m ODN) and the mapped area: the waves' fetch (src/sim/env/seaState.ts). */
  bedElevation?(n: number, e: number): number;
  inDomain?(n: number, e: number): boolean;
  /** The mapped area's bounds: with the land, the wind's shelter and steering (src/sim/env/terrainWind.ts). */
  domain?: { nMin: number; nMax: number; eMin: number; eMax: number };
}

export interface BuiltConditions {
  env: Environment;
  weather: WeatherInfo;
  tide?: TideSource;
  current: CurrentModel;
  gusts: GustSettings;
  sky: SkySource;
}

export function buildConditions(c: ConditionsSettings, geo?: ConditionsGeo): BuiltConditions {
  const startEpochMs = Date.parse(c.startTime);
  if (Number.isNaN(startEpochMs)) throw new Error(`conditions: bad start time "${c.startTime}"`);

  let base;
  let weather: WeatherInfo;
  let dataGusts: { gusts: GustSettings; notes: string[] } | undefined;
  let sky: SkySource | undefined;
  const skyChoice = c.sky ?? (c.weather.source === 'metoffice' ? { source: 'data' as const } : { source: 'preset' as const, preset: 'clear' as const });
  if (skyChoice.source === 'preset') {
    if (!(skyChoice.preset in SKY_PRESETS)) throw new Error(`conditions: unknown sky preset "${skyChoice.preset}"`);
    sky = presetSky(skyChoice.preset);
  }
  if (c.weather.source === 'manual') {
    base = uniformBase(knToMs(c.weather.twsKn), c.weather.twdDeg * DEG);
    weather = {
      kind: 'manual',
      label: `Manual: ${c.weather.twsKn} kn from ${Math.round(c.weather.twdDeg)}°`,
      notes: ['Scenario setting, not measured.'],
    };
  } else {
    const snap = parseMetOfficeSnapshot(c.weather.snapshot);
    base = metOfficeBase(snap, startEpochMs);
    if (!sky && snap.model.sky?.length) sky = modelSky(snap.model.sky, startEpochMs, `Sky: Met Office UKV forecast (${c.weather.replay ? 'replay' : 'live'})`);
    dataGusts = gustsFromSnapshot(snap, c.gusts.seed);
    weather = metOfficeInfo(snap, c.weather.replay ? 'replay' : 'model', c.gusts.preset === 'from-data' ? dataGusts.notes : []);
  }
  const preset = c.gusts.preset === 'from-data' ? (dataGusts?.gusts ?? GUST_PRESETS.moderate) : GUST_PRESETS[c.gusts.preset];
  const gusts: GustSettings = { ...preset, ...c.gusts.overrides, seed: c.gusts.seed };
  if (c.gusts.preset !== 'steady') weather.notes = [...weather.notes, 'Gusts and shifts: seeded statistical model (estimated parameters).'];
  const wind = new WindField(base, gusts, { n: 0, e: 0, radius: 2500 });

  let tide: TideSource | undefined;
  if (c.tide?.mode === 'manual') tide = manualTide(Date.parse(c.tide.hwTime), c.tide.hwHeightM, c.tide.lwHeightM);
  else if (c.tide?.mode === 'snapshot') tide = snapshotTide(parseTideSnapshot(c.tide.snapshot), { useGauge: c.tide.useGauge });

  if (tide) tide = memoTide(tide);
  let current: CurrentModel = NO_CURRENT;
  if (c.current.mode === 'uniform') current = uniformCurrent(c.current.setDeg, c.current.rateKn);
  else if (c.current.mode === 'tidal') {
    if (!tide) throw new Error('conditions: a tidal stream needs a tide source');
    current = tidalStream(tide, { ...DEFAULT_TIDAL_STREAM, ...c.current.stream });
  } else if (c.current.mode === 'dart') {
    if (!tide) throw new Error('conditions: a tidal stream needs a tide source');
    if (!geo) throw new Error('conditions: the channel-following stream needs the River Dart data');
    // Local departures (src/sim/env/streamAnomalies.ts): deep water faster, Start Bay's coastal stream, northerlies.
    const ent = STREAM_ANOMALIES.entrance;
    current = dartStream(tide, geo, { ...DEFAULT_TIDAL_STREAM, ...c.current.stream }, {
      depthWeight: geo.bedElevation && geo.domain ? new DepthWeight(geo.bedElevation.bind(geo), geo.domain) : undefined,
      offshore: true,
      windAt: (ms) => {
        const b = base.at(ent.n, ent.e, (ms - startEpochMs) / 1000);
        return { fromDir: b.fromDir, speed: b.speed };
      },
    });
  }

  sky ??= presetSky('fair');
  const datum = geo ? { cdBelowOdn: geo.cdBelowOdn, meanLevelCd: MEAN_LEVEL_CD } : undefined;
  const terrain = geo?.bedElevation && geo.inDomain ? { bedElevation: geo.bedElevation.bind(geo), inDomain: geo.inDomain.bind(geo) } : undefined;
  // The land shapes the wind (shelter, valley steering) where the River Dart data covers it; a run can opt out.
  const terrainWind = geo?.bedElevation && geo.domain && c.landEffects !== false
    ? new TerrainWind({ bedElevation: geo.bedElevation.bind(geo), domain: geo.domain, axis: (n, e) => geo.streamPattern(n, e).tidal })
    : undefined;
  if (terrainWind) weather.notes = [...weather.notes, 'Shaped by the land: shelter in the lee of the hills and the valley turning the wind along the river (estimated, docs/PHYSICS.md).'];
  const env = composeEnvironment({ wind, weather, current, tide, startEpochMs, datum, sky, terrain, terrainWind });
  return { env, weather, tide, current, gusts, sky };
}
