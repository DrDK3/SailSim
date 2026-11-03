import type { ConditionsSettings } from '../sim/env/conditions';
import type { DataSource } from './controller';

/**
 * Conditions as they are now on the Dart (owner review, 1 Nov 2026: "the sim needs to deliver real time weather
 * and lighting"): the latest Met Office forecast published by the site's scheduled job (wind, gusts from its
 * spread, and its sky: cloud, visibility, rain), from this minute, so the sun stands where it really does (and
 * it is dark after sunset). With a live tide too, the water level follows it. Needs the deployed site's live
 * data (docs/DEPLOYMENT.md); without it the app keeps the conditions as set.
 */

/** The river's tidal stream (E), as the random quick race and the river scenarios have it. */
export const RIVER_STREAM = { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 };

/** This minute, as a scenario start time (ISO, UTC). */
export function nowStartTime(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 16) + ':00Z';
}

/**
 * Live conditions for a session that starts now. `stream`: the river's channel-following stream, which needs a
 * tide to drive it; without a live tide there is none (and the water stays at about mean sea level).
 */
export function liveNowConditions(weather: DataSource, opts: { tide?: DataSource; stream?: boolean; seed?: number; nowMs?: number } = {}): ConditionsSettings {
  const { tide, stream = false, seed = 1, nowMs } = opts;
  return {
    startTime: nowStartTime(nowMs),
    weather: { source: 'metoffice', snapshot: weather.json, replay: false },
    gusts: { preset: 'from-data', seed },
    sky: { source: 'data' },
    ...(tide ? { tide: { mode: 'snapshot' as const, snapshot: tide.json, useGauge: tide.gaugeUsable === true } } : {}),
    current: stream && tide ? { mode: 'dart', stream: { ...RIVER_STREAM } } : { mode: 'none' },
  };
}

/** The live forecast to use now: a live (not replay) source whose forecast covers now, if there is one. */
export function freshLiveWeather(sources: readonly DataSource[]): DataSource | undefined {
  return sources.find((s) => s.kind === 'live' && s.freshness?.status !== 'stale' && s.freshness?.status !== 'expired');
}
