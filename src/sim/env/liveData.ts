/**
 * Live and replay data files served next to the app (public/live/, written by the scheduled ingest), and the
 * rules for how old they may be. Pure functions: the app's loader and the tests both use them.
 *
 * live/index.json lists the files that exist, so the app never asks the server for a file that is not
 * there (on static hosting that is a 404 in the console) and can judge freshness before downloading.
 */
import { parseMetOfficeSnapshot, snapshotCoverageEnd, type MetOfficeSnapshot } from './weather';
import { parseTideSnapshot, type TideSnapshot } from './tide';

export const LIVE_INDEX_SCHEMA = 'squib-live-index/1';

export interface LiveIndexEntry {
  /** Path relative to live/. */
  path: string;
  kind: 'weather' | 'tide';
  /** 'live' files are rewritten by the scheduled job; 'replay' files are fixed recordings. */
  mode: 'live' | 'replay';
  /** When the job wrote the file (ISO). */
  generated?: string;
  /** Short description for the UI. */
  label?: string;
}

export interface LiveIndex {
  schema: string;
  generated?: string;
  files: LiveIndexEntry[];
}

export function parseLiveIndex(json: unknown): LiveIndex {
  const j = json as Partial<LiveIndex>;
  if (!j || typeof j !== 'object' || j.schema !== LIVE_INDEX_SCHEMA) throw new Error(`live index: expected schema ${LIVE_INDEX_SCHEMA}`);
  if (!Array.isArray(j.files)) throw new Error('live index: files must be a list');
  const files = j.files.filter(
    (f): f is LiveIndexEntry =>
      !!f && typeof f.path === 'string' && /^[\w.-]+\.json$/.test(f.path) && (f.kind === 'weather' || f.kind === 'tide') && (f.mode === 'live' || f.mode === 'replay'),
  );
  return { schema: j.schema, generated: j.generated, files };
}

/**
 * Freshness thresholds (E: chosen for sailing sessions of about an hour; docs/DEPLOYMENT.md).
 *  - Weather: the forecast must cover now (to its last 15-minute step, plus 15 min of grace) and the job
 *    must have run within WEATHER_JOB_LATE_MIN; past the end it is "stale" for STALE_LIMIT_H, then "expired".
 *  - Tide: gauge readings older than GAUGE_STALE_MIN are not used for the surge residual; predictions
 *    must cover now.
 */
export const WEATHER_GRACE_MIN = 15;
export const WEATHER_JOB_LATE_MIN = 90;
export const STALE_LIMIT_H = 6;
export const GAUGE_STALE_MIN = 60;

export type FreshnessStatus = 'fresh' | 'stale' | 'expired';

export interface Freshness {
  status: FreshnessStatus;
  /** Minutes since the data's reference time (weather: the end of the forecast; tide: the last gauge reading). */
  ageMin: number;
  message: string;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(11, 16)} UTC`;
}

function ago(min: number): string {
  if (min < 90) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
  return `${Math.round(min / 1440)} days`;
}

/** Is a live weather snapshot usable as "live" at `nowMs`? */
export function weatherFreshness(snap: MetOfficeSnapshot, nowMs: number): Freshness {
  const end = snapshotCoverageEnd(snap);
  const pastEndMin = (nowMs - Date.parse(end)) / 60000;
  const jobAgeMin = (nowMs - Date.parse(snap.generated)) / 60000;
  if (pastEndMin <= WEATHER_GRACE_MIN && !(jobAgeMin > WEATHER_JOB_LATE_MIN)) {
    return { status: 'fresh', ageMin: Math.max(0, jobAgeMin), message: `Forecast covers now (to ${hhmm(end)}); updated ${ago(Math.max(0, jobAgeMin))} ago.` };
  }
  if (pastEndMin <= STALE_LIMIT_H * 60) {
    const why = pastEndMin > WEATHER_GRACE_MIN ? `the forecast ended at ${hhmm(end)}, ${ago(pastEndMin)} ago` : `not updated for ${ago(jobAgeMin)}`;
    return { status: 'stale', ageMin: Math.max(pastEndMin, jobAgeMin), message: `Stale: ${why}. The live feed may have stopped.` };
  }
  return { status: 'expired', ageMin: pastEndMin, message: `Expired: the forecast ended ${ago(pastEndMin)} ago. Offered only as a recording.` };
}

/** Is a live tide snapshot usable at `nowMs`, and is its gauge reading recent enough for the residual? */
export function tideFreshness(snap: TideSnapshot, nowMs: number): Freshness & { gaugeUsable: boolean } {
  const ev = snap.predictions.events.map((e) => Date.parse(e.time));
  const covers = nowMs >= Math.min(...ev) && nowMs <= Math.max(...ev);
  const last = snap.gauge?.readings[snap.gauge.readings.length - 1];
  const gaugeAge = last ? (nowMs - Date.parse(last.time)) / 60000 : Infinity;
  const gaugeUsable = gaugeAge <= GAUGE_STALE_MIN;
  if (!covers) {
    const endMin = (nowMs - Math.max(...ev)) / 60000;
    return { status: 'expired', ageMin: endMin, gaugeUsable: false, message: 'Expired: the predictions do not cover now. Offered only as a recording.' };
  }
  if (!last) return { status: 'fresh', ageMin: 0, gaugeUsable: false, message: 'Predictions cover now; no gauge reading in the file.' };
  if (gaugeUsable) return { status: 'fresh', ageMin: gaugeAge, gaugeUsable, message: `Gauge reading ${ago(gaugeAge)} old; predictions cover now.` };
  return {
    status: 'stale',
    ageMin: gaugeAge,
    gaugeUsable,
    message: `Gauge reading ${ago(gaugeAge)} old: the measured surge is not applied; predictions only.`,
  };
}

/** A data file the app found, checked and parsed. */
export type LoadedLive =
  | { kind: 'weather'; entry: LiveIndexEntry; snapshot: MetOfficeSnapshot; freshness?: Freshness }
  | { kind: 'tide'; entry: LiveIndexEntry; snapshot: TideSnapshot; freshness?: Freshness & { gaugeUsable: boolean } };

/** Parse one listed file; live files get a freshness verdict. Throws with a reason when unusable. */
export function loadLive(entry: LiveIndexEntry, json: unknown, nowMs: number): LoadedLive {
  if (entry.kind === 'weather') {
    const snapshot = parseMetOfficeSnapshot(json);
    return { kind: 'weather', entry, snapshot, freshness: entry.mode === 'live' ? weatherFreshness(snapshot, nowMs) : undefined };
  }
  const snapshot = parseTideSnapshot(json);
  return { kind: 'tide', entry, snapshot, freshness: entry.mode === 'live' ? tideFreshness(snapshot, nowMs) : undefined };
}
