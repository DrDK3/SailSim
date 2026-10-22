import { DEG } from '../math/angles';
import { knToMs } from '../units';
import { composeEnvironment, type Environment, type WeatherInfo } from './environment';
import { DEFAULT_TIDAL_STREAM, NO_CURRENT, dartStream, tidalStream, uniformCurrent, type CurrentModel, type StreamPattern, type TidalStreamSettings } from './current';
import { manualTide, parseTideSnapshot, snapshotTide, type TideSource } from './tide';
import { GUST_PRESETS, WindField, uniformBase, type GustSettings } from './wind';
import { gustsFromSnapshot, metOfficeBase, metOfficeInfo, parseMetOfficeSnapshot } from './weather';

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
    | { mode: 'snapshot'; snapshot: unknown };
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
}

export interface BuiltConditions {
  env: Environment;
  weather: WeatherInfo;
  tide?: TideSource;
  current: CurrentModel;
  gusts: GustSettings;
}

export function buildConditions(c: ConditionsSettings, geo?: ConditionsGeo): BuiltConditions {
  const startEpochMs = Date.parse(c.startTime);
  if (Number.isNaN(startEpochMs)) throw new Error(`conditions: bad start time "${c.startTime}"`);

  let base;
  let weather: WeatherInfo;
  let dataGusts: { gusts: GustSettings; notes: string[] } | undefined;
  if (c.weather.source === 'manual') {
    base = uniformBase(knToMs(c.weather.twsKn), c.weather.twdDeg * DEG);
    weather = {
      kind: 'manual',
      label: `Manual: ${c.weather.twsKn} kn from ${Math.round(c.weather.twdDeg)}°`,
      notes: ['Scenario setting, not measured.'],
    };
  } else {
    const snap = parseMetOfficeSnapshot(c.weather.snapshot);
    base = metOfficeBase(snap);
    dataGusts = gustsFromSnapshot(snap, c.gusts.seed);
    weather = metOfficeInfo(snap, c.weather.replay ? 'replay' : 'model', c.gusts.preset === 'from-data' ? dataGusts.notes : []);
  }
  const preset = c.gusts.preset === 'from-data' ? (dataGusts?.gusts ?? GUST_PRESETS.moderate) : GUST_PRESETS[c.gusts.preset];
  const gusts: GustSettings = { ...preset, ...c.gusts.overrides, seed: c.gusts.seed };
  if (c.gusts.preset !== 'steady') weather.notes = [...weather.notes, 'Gusts and shifts: seeded statistical model (estimated parameters).'];
  const wind = new WindField(base, gusts, { n: 0, e: 0, radius: 2500 });

  let tide: TideSource | undefined;
  if (c.tide?.mode === 'manual') tide = manualTide(Date.parse(c.tide.hwTime), c.tide.hwHeightM, c.tide.lwHeightM);
  else if (c.tide?.mode === 'snapshot') tide = snapshotTide(parseTideSnapshot(c.tide.snapshot));

  let current: CurrentModel = NO_CURRENT;
  if (c.current.mode === 'uniform') current = uniformCurrent(c.current.setDeg, c.current.rateKn);
  else if (c.current.mode === 'tidal') {
    if (!tide) throw new Error('conditions: a tidal stream needs a tide source');
    current = tidalStream(tide, { ...DEFAULT_TIDAL_STREAM, ...c.current.stream });
  } else if (c.current.mode === 'dart') {
    if (!tide) throw new Error('conditions: a tidal stream needs a tide source');
    if (!geo) throw new Error('conditions: the channel-following stream needs the River Dart data');
    current = dartStream(tide, geo, { ...DEFAULT_TIDAL_STREAM, ...c.current.stream });
  }

  const datum = geo ? { cdBelowOdn: geo.cdBelowOdn, meanLevelCd: MEAN_LEVEL_CD } : undefined;
  const env = composeEnvironment({ wind, weather, current, tide, startEpochMs, datum });
  return { env, weather, tide, current, gusts };
}
