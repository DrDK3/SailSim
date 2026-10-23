import { DEG, clamp } from '../math/angles';
import { knToMs } from '../units';
import { createLocalProjection, RDYC_ORIGIN } from '../geo/projection';
import { GUST_PRESETS, gridBase, timeSteppedBase, type BaseWind, type GustSettings } from './wind';
import type { WeatherInfo } from './environment';
import type { SkyStep } from './sky';

/**
 * Met Office snapshot as written by research/weather/live_conditions.py (squib-weather/1) and by the scheduled
 * ingest tools/ingest/weather.py (squib-weather/2, which adds 15-minute wind steps and hourly sky fields).
 * Speeds are in knots in this file.
 */
export interface MetOfficeSnapshot {
  schema?: string;
  generated: string;
  requested_time: string;
  model: {
    available: boolean;
    kind?: string;
    source?: string;
    licence?: string;
    run?: string;
    valid?: string;
    points?: Record<string, { lat: number; lon: number; wind_from_deg: number; speed_kn: number; gust_kn: number }>;
    grid?: { lat: number[][]; lon: number[][]; wind_from_deg: number[][]; speed_kn: number[][]; gust_kn: number[][] };
    /** squib-weather/2: the wind grid every 15 minutes (on grid.lat/lon), first step = `valid`. */
    steps?: { valid: string; wind_from_deg: number[][]; speed_kn: number[][]; gust_kn: number[][] }[];
    /** squib-weather/2: hourly sky fields at RDYC and as area means. */
    sky?: SkyStep[];
    horizon?: { from: string; to: string; step_min: number };
  };
  observed?: {
    stations: {
      available: boolean;
      station?: string;
      distance_from_rdyc_km?: number;
      hour_1min_stats?: { speed_mean: number; wind_from_mean_deg: number; direction_std_deg: number };
      speed_units?: string;
    }[];
  };
}

export function parseMetOfficeSnapshot(json: unknown): MetOfficeSnapshot {
  const j = json as MetOfficeSnapshot;
  if (!j || typeof j !== 'object' || !j.model) throw new Error('weather snapshot: missing model section');
  if (!j.model.available) throw new Error('weather snapshot: model data not available in this snapshot');
  const g = j.model.grid;
  if (!g || !Array.isArray(g.lat) || g.lat.length < 2 || !Array.isArray(g.lat[0]) || g.lat[0].length < 2) {
    throw new Error('weather snapshot: grid missing or smaller than 2 x 2');
  }
  for (const k of ['lon', 'wind_from_deg', 'speed_kn', 'gust_kn'] as const) {
    const a = g[k];
    if (!Array.isArray(a) || a.length !== g.lat.length || a.some((row, i) => !Array.isArray(row) || row.length !== g.lat[i]!.length)) {
      throw new Error(`weather snapshot: grid.${k} has the wrong shape`);
    }
  }
  if (typeof j.model.valid !== 'string') throw new Error('weather snapshot: missing valid time');
  const steps = j.model.steps;
  if (steps !== undefined) {
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('weather snapshot: steps must be a non-empty list');
    let prev = -Infinity;
    for (const st of steps) {
      const t = Date.parse(st?.valid);
      if (Number.isNaN(t) || t <= prev) throw new Error('weather snapshot: step times missing or not increasing');
      prev = t;
      for (const k of ['wind_from_deg', 'speed_kn', 'gust_kn'] as const) {
        const a = st[k];
        if (!Array.isArray(a) || a.length !== g.lat.length || a.some((row, i) => !Array.isArray(row) || row.length !== g.lat[i]!.length || row.some((x) => typeof x !== 'number' || !Number.isFinite(x)))) {
          throw new Error(`weather snapshot: step ${st.valid} ${k} has the wrong shape or bad values`);
        }
      }
    }
  }
  if (j.model.sky !== undefined && (!Array.isArray(j.model.sky) || j.model.sky.some((x) => Number.isNaN(Date.parse(x?.valid)) || typeof x.rdyc !== 'object'))) {
    throw new Error('weather snapshot: bad sky steps');
  }
  return j;
}

/** End of the period the snapshot's forecast covers (ISO): the last step, or the single valid time. */
export function snapshotCoverageEnd(snap: MetOfficeSnapshot): string {
  return snap.model.steps?.[snap.model.steps.length - 1]?.valid ?? snap.model.valid!;
}

/**
 * The UKV grid as a spatially varying base wind in local coordinates about RDYC. With 15-minute steps
 * (squib-weather/2) and the run's start time, the wind also follows the forecast through time.
 */
export function metOfficeBase(snap: MetOfficeSnapshot, startEpochMs?: number): BaseWind {
  const g = snap.model.grid!;
  const proj = createLocalProjection(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
  const local = g.lat.map((row, i) => row.map((lat, j) => proj.toLocal(lat, g.lon[i]![j]!)));
  const field = (dir: number[][], kn: number[][]): BaseWind =>
    gridBase(local.map((row, i) => row.map((p, j) => ({ n: p.n, e: p.e, speed: knToMs(kn[i]![j]!), fromDir: dir[i]![j]! * DEG }))));
  const steps = snap.model.steps;
  if (!steps || steps.length < 2 || startEpochMs === undefined) return field(g.wind_from_deg, g.speed_kn);
  return timeSteppedBase(steps.map((st) => ({ t: (Date.parse(st.valid) - startEpochMs) / 1000, base: field(st.wind_from_deg, st.speed_kn) })));
}

/**
 * Fluctuation settings derived from the snapshot (HEURISTIC, tag E): speed variability and puff strength
 * from the model's gust/mean ratio near RDYC, direction variability from the nearest observing station's
 * 1-minute direction scatter (regional, not on the Dart).
 */
export function gustsFromSnapshot(snap: MetOfficeSnapshot, seed: number): { gusts: GustSettings; notes: string[] } {
  const base = GUST_PRESETS.moderate;
  const pt = snap.model.points?.['rdyc_kingswear'];
  const notes: string[] = [];
  let speedSdFrac = base.speedSdFrac;
  let puffStrengthFrac = base.puffStrengthFrac;
  if (pt && pt.speed_kn > 0.5) {
    const gf = pt.gust_kn / pt.speed_kn;
    speedSdFrac = clamp((gf - 1) / 3.5, 0.02, 0.2);
    puffStrengthFrac = clamp((gf - 1) * 0.7, 0.05, 0.5);
    notes.push(`Gustiness from UKV gust/mean ratio ${gf.toFixed(2)} at the RDYC grid point (heuristic; the 2 km cell includes land).`);
  }
  let shiftSdDeg = base.shiftSdDeg;
  const st = snap.observed?.stations.find((s) => s.available && s.hour_1min_stats);
  if (st?.hour_1min_stats) {
    shiftSdDeg = clamp(st.hour_1min_stats.direction_std_deg, 2, 15);
    notes.push(`Shift amplitude from ${st.station} 1-minute direction scatter (${shiftSdDeg.toFixed(1)}°), ${st.distance_from_rdyc_km} km away.`);
  }
  return { gusts: { ...base, seed, speedSdFrac, puffStrengthFrac, shiftSdDeg }, notes };
}

export function metOfficeInfo(snap: MetOfficeSnapshot, kind: 'model' | 'replay', extraNotes: string[]): WeatherInfo {
  return {
    kind,
    label: `${kind === 'replay' ? 'Replay of ' : ''}Met Office UKV 2 km, valid ${snap.model.valid} (run ${snap.model.run})`,
    validTime: snap.model.valid,
    attribution: 'British Crown copyright, the Met Office, CC BY-SA 4.0',
    notes: [
      'Forecast model output, not a measurement. The 2 km grid cannot resolve valley funnelling or wind shadows.',
      snap.model.steps && snap.model.steps.length > 1
        ? `The wind follows the forecast's ${snap.model.steps.length} 15-minute steps to ${snapshotCoverageEnd(snap)}, interpolated in time; after that the last step holds.`
        : 'A single forecast time: the mean wind does not change during the run.',
      ...extraNotes,
    ],
  };
}

/** Minutes between the data's valid time and `nowMs`. */
export function dataAgeMinutes(validIso: string | undefined, nowMs: number): number | undefined {
  if (!validIso) return undefined;
  const t = Date.parse(validIso);
  return Number.isNaN(t) ? undefined : (nowMs - t) / 60000;
}
