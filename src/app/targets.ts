/**
 * Model-sailed targets for the weekly course (juniors round §6.3). A scheduled GitHub Action (weekly-targets.yml)
 * sails the week's course headless with the AI at its three levels over several seeds and publishes, next to `live/`
 * on the site, `weekly/<week>.json`: bronze (club), silver (good) and gold (expert) target times and a ghost track of
 * each. They are labelled as model-sailed: not people, and the ghosts are recordings that do not react.
 *
 * If the job has not run (or failed), the app still builds the week's course and conditions itself and says "targets
 * not available this week".
 *
 * Pure helpers: the file's shape, its check, freshness, and the compact ghost track.
 */
import type { FleetPose } from '../render/fleet';

export const TARGETS_SCHEMA = 'squib-weekly-targets/1';
export const MEDALS = ['bronze', 'silver', 'gold'] as const;
export type Medal = (typeof MEDALS)[number];
/** Which AI level sails each target. */
export const MEDAL_LEVEL: Record<Medal, 'club' | 'good' | 'expert'> = { bronze: 'club', silver: 'good', gold: 'expert' };

/**
 * A ghost track: the boat's pose once a second (n, e, heading, heel, main and jib boom angles, luff factors, rudder,
 * speed, crew position, sides), rounded. About 15 numbers a second: a 10-minute course is a few tens of kB.
 */
export interface Track {
  everyS: number;
  /** [t, n, e, heading, heel, boomMain, boomJib, mainLuff, jibLuff, rudder, stw, crewY, mainSide, jibSide, awa, aws] */
  rows: number[][];
}

export interface Target {
  medal: Medal;
  level: 'club' | 'good' | 'expert';
  /** Seconds from the start signal to the finish: the median over the seeds that finished. */
  timeS: number;
  /** Each seed's time (null: did not finish). */
  runs: (number | null)[];
  /** The ghost: the run nearest the median. */
  track: Track;
}

export interface TargetsFile {
  schema: typeof TARGETS_SCHEMA;
  week: string;
  /** Written at (ISO); the app shows its age. */
  generated: string;
  /** The build of the simulation that sailed them. */
  build: string;
  course: string;
  /** The scenario's JSON, so the app can check the targets are for the course it built. */
  scenario: string;
  targets: Target[];
  note: string;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function trackRow(t: number, p: FleetPose): number[] {
  return [Math.round(t * 10) / 10, r3(p.n), r3(p.e), r3(p.heading), r3(p.heel), r3(p.boomMain), r3(p.boomJib), r3(p.mainLuff), r3(p.jibLuff), r3(p.rudder), r3(p.stw ?? 0), r3(p.crewY), p.mainSide, p.jibSide, r3(p.awa), r3(p.aws)];
}

/** The track as ghost poses every 0.1 s (the app's ghost sample rate), drawn between the samples. */
export function trackPoses(tr: Track, stepS = 0.1): FleetPose[] {
  const out: FleetPose[] = [];
  const rows = tr.rows;
  if (!rows.length) return out;
  const end = rows[rows.length - 1]![0]!;
  const angle = (a: number, b: number, f: number) => {
    let d = (b - a) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * f;
  };
  let i = 0;
  for (let t = 0; t <= end + 1e-9; t += stepS) {
    while (i + 1 < rows.length && rows[i + 1]![0]! <= t) i++;
    const a = rows[i]!;
    const b = rows[Math.min(i + 1, rows.length - 1)]!;
    const f = b[0]! > a[0]! ? Math.min(1, Math.max(0, (t - a[0]!) / (b[0]! - a[0]!))) : 0;
    const l = (k: number) => a[k]! + (b[k]! - a[k]!) * f;
    out.push({
      id: 'ghost', n: l(1), e: l(2), heading: angle(a[3]!, b[3]!, f), heel: l(4), boomMain: l(5), boomJib: l(6),
      mainSide: (f < 0.5 ? a[12] : b[12]) as 1 | -1, jibSide: (f < 0.5 ? a[13] : b[13]) as 1 | -1,
      mainLuff: l(7), jibLuff: l(8), mainAwa: angle(a[14] ?? 0, b[14] ?? 0, f), jibAwa: angle(a[14] ?? 0, b[14] ?? 0, f), rudder: l(9), crewY: l(11), crewTo: l(11), sailsDown: false, awa: angle(a[14] ?? 0, b[14] ?? 0, f), aws: l(15), water: 0, stw: l(10),
    });
  }
  return out;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Check a targets file read from the site; throws with a reason. */
export function parseTargets(json: unknown): TargetsFile {
  const t = json as Partial<TargetsFile>;
  if (!t || t.schema !== TARGETS_SCHEMA) throw new Error('not a weekly targets file');
  if (typeof t.week !== 'string' || typeof t.generated !== 'string' || !Array.isArray(t.targets)) throw new Error('weekly targets: missing fields');
  for (const x of t.targets) {
    if (!MEDALS.includes(x.medal) || !isNum(x.timeS) || !x.track || !Array.isArray(x.track.rows)) throw new Error('weekly targets: a bad target');
  }
  return t as TargetsFile;
}

/** What the app can say about the week's targets. */
export type TargetsStatus =
  | { state: 'ok'; file: TargetsFile; ageMin: number }
  | { state: 'unavailable'; reason: string };

/**
 * The targets for this week, if the file is for this week's course and scenario; otherwise "not available" with why.
 * A file from another week or for another scenario (the rotation or the app changed) is not used.
 */
export function targetsStatus(json: unknown, week: string, scenarioJson: string, nowMs = Date.now()): TargetsStatus {
  let f: TargetsFile;
  try {
    f = parseTargets(json);
  } catch (e) {
    return { state: 'unavailable', reason: (e as Error).message };
  }
  if (f.week !== week) return { state: 'unavailable', reason: `the published targets are for ${f.week}` };
  if (f.scenario !== scenarioJson) return { state: 'unavailable', reason: 'the published targets are for a different course or conditions (a newer or older version of the app)' };
  const age = (nowMs - Date.parse(f.generated)) / 60000;
  return { state: 'ok', file: f, ageMin: Math.max(0, Math.round(age)) };
}

/** Median of the finishers (undefined if none). */
export function median(xs: readonly (number | null)[]): number | undefined {
  const s = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}
