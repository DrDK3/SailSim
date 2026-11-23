/**
 * A progress backup (design handover item 25): one file with the progress a player values, to keep safe or move to
 * another browser, without an account. Not a replay (one run) and not a scenario (a set-up): the lessons done, the
 * exercise records, the best and challenge times, the start best and the Learn map's record.
 *
 * Versioned (`format`, `version`); restoring merges with what this browser already has and never loses it:
 * - lessons: done if done in either; the first completion kept; an earlier-record mark only if no ordinary record;
 * - best times: the faster of the two for each course identity, and the quicker start;
 * - challenge times: the better time in each category, the attempt histories joined (no duplicates, newest kept);
 * - exercise runs: joined, by exercise and time (no duplicates), the most recent MAX_RUNS kept;
 * - the Learn map's started steps: joined.
 * Restoring the same file twice changes nothing the second time. A file that is not a backup, from a newer version, or
 * damaged in any store is refused whole, and nothing is changed; if this browser cannot save part of it, what was
 * written is put back as it was.
 */
import { HISTORY_MAX, type Bests, type LikeForLike } from './bests';
import type { LessonEntry, LessonProgress } from './lessons';
import { MAX_RUNS, isRun, type StoredRun } from './exercises/records';
import { persist } from './storage';

export const BACKUP_FORMAT = 'sailsim-progress';
export const BACKUP_VERSION = 1;

/** The browser keys the backup holds, and what each is called for the player. */
const STORES = {
  lessons: { key: 'squib.lessons.v1', what: 'lesson progress' },
  bests: { key: 'squib.bests.v1', what: 'your best times' },
  challengeTimes: { key: 'squib.bests.likeForLike.v1', what: 'your challenge times' },
  exerciseRuns: { key: 'squib.exercises.records.v1', what: 'your exercise results' },
  learnMap: { key: 'squib.learnmap.v1', what: 'what you have started on the Learn map' },
} as const;
type StoreName = keyof typeof STORES;

export interface ProgressBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  build: string;
  stores: {
    lessons: LessonProgress;
    bests: Bests;
    challengeTimes: Record<string, LikeForLike>;
    exerciseRuns: StoredRun[];
    learnMap: { started: string[] };
  };
}

const read = (key: string): unknown => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
};
/** JSON with the object keys sorted, to compare content regardless of field order. */
const canon = (x: unknown): string =>
  JSON.stringify(x, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// ------------------------------------------------------------ what this browser has (tolerant, as the app reads it)

function current(): ProgressBackup['stores'] {
  const lessons = read(STORES.lessons.key);
  const bests = read(STORES.bests.key);
  const lfl = read(STORES.challengeTimes.key);
  const runs = read(STORES.exerciseRuns.key);
  const map = read(STORES.learnMap.key);
  return {
    lessons: isObj(lessons) ? (lessons as LessonProgress) : {},
    bests: isObj(bests) && isObj(bests.races) ? (bests as unknown as Bests) : { races: {} },
    challengeTimes: isObj(lfl) ? (lfl as Record<string, LikeForLike>) : {},
    exerciseRuns: Array.isArray(runs) ? (runs.filter(isRun) as StoredRun[]) : [],
    learnMap: { started: isObj(map) && Array.isArray(map.started) ? map.started.filter((x): x is string => typeof x === 'string') : [] },
  };
}

/** The backup file's text. */
export function exportProgress(build: string, now = new Date()): string {
  const backup: ProgressBackup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), build, stores: current() };
  return JSON.stringify(backup, null, 1);
}

// ------------------------------------------------------------ checking a file (strict: refuse rather than guess)

function checkLessons(x: unknown): LessonProgress {
  if (!isObj(x)) throw new Error('lessons');
  for (const e of Object.values(x)) if (!isObj(e) || typeof e.at !== 'string' || typeof e.done !== 'boolean') throw new Error('lessons');
  return x as LessonProgress;
}
function checkBests(x: unknown): Bests {
  if (!isObj(x) || !isObj(x.races)) throw new Error('best times');
  for (const r of Object.values(x.races)) if (!isObj(r) || !isNum(r.timeS) || typeof r.at !== 'string' || typeof r.label !== 'string') throw new Error('best times');
  if (x.start !== undefined && (!isObj(x.start) || !isNum(x.start.delayS) || typeof x.start.at !== 'string')) throw new Error('best times');
  return x as unknown as Bests;
}
function checkLfl(x: unknown): Record<string, LikeForLike> {
  if (!isObj(x)) throw new Error('challenge times');
  for (const e of Object.values(x)) {
    if (!isObj(e) || typeof e.label !== 'string' || !Array.isArray(e.history)) throw new Error('challenge times');
    for (const c of [e.independent, e.assisted]) if (c !== undefined && (!isObj(c) || !isNum(c.timeS) || typeof c.at !== 'string')) throw new Error('challenge times');
    for (const a of e.history) if (!isObj(a) || !isNum(a.timeS) || typeof a.at !== 'string' || typeof a.independent !== 'boolean') throw new Error('challenge times');
  }
  return x as unknown as Record<string, LikeForLike>;
}
function checkRuns(x: unknown): StoredRun[] {
  if (!Array.isArray(x) || !x.every(isRun)) throw new Error('exercise results');
  return x as StoredRun[];
}
function checkMap(x: unknown): { started: string[] } {
  if (!isObj(x) || !Array.isArray(x.started) || !x.started.every((s) => typeof s === 'string')) throw new Error('Learn map');
  return { started: x.started as string[] };
}

/** Read a backup file; throws with a reason a person can read. */
export function parseBackup(text: string): ProgressBackup {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('This file is not a SailSim progress backup (it is not readable JSON).');
  }
  if (!isObj(j) || j.format !== BACKUP_FORMAT) {
    const hint = isObj(j) && typeof j.schema === 'string' ? ' It looks like a replay, scenario or exercise records file: open those in Scenarios and replays or the exercise panel.' : '';
    throw new Error(`This file is not a SailSim progress backup.${hint}`);
  }
  if (!isNum(j.version) || j.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of SailSim than this one: update the page (reload it) and try again.');
  if (!isObj(j.stores)) throw new Error('This backup is damaged: it holds no progress.');
  const s = j.stores;
  try {
    return {
      format: BACKUP_FORMAT,
      version: j.version,
      exportedAt: typeof j.exportedAt === 'string' ? j.exportedAt : '',
      build: typeof j.build === 'string' ? j.build : '',
      stores: {
        lessons: checkLessons(s.lessons ?? {}),
        bests: checkBests(s.bests ?? { races: {} }),
        challengeTimes: checkLfl(s.challengeTimes ?? {}),
        exerciseRuns: checkRuns(s.exerciseRuns ?? []),
        learnMap: checkMap(s.learnMap ?? { started: [] }),
      },
    };
  } catch (e) {
    throw new Error(`This backup is damaged (its ${(e as Error).message} could not be read), so nothing was restored.`, { cause: e });
  }
}

// ------------------------------------------------------------ merging (never loses what is here)

function mergeLesson(a: LessonEntry | undefined, b: LessonEntry | undefined): LessonEntry | undefined {
  if (!a || !b) return a ?? b;
  const done = a.done || b.done;
  const at = a.at > b.at ? a.at : b.at;
  const completed = [a.completedAt, b.completedAt].filter((x): x is string => !!x).sort()[0];
  const ordinaryDone = (a.done && !a.legacy) || (b.done && !b.legacy) || !!completed;
  const legacyDone = (a.done && a.legacy) || (b.done && b.legacy);
  const latest = a.at >= b.at ? a : b;
  const bestS = [a.bestS, b.bestS].filter(isNum).sort((x, y) => x - y)[0];
  return {
    done,
    at,
    ...(completed ? { completedAt: completed } : {}),
    ...(done && !ordinaryDone && legacyDone ? { legacy: true as const } : {}),
    ...(bestS !== undefined && !ordinaryDone ? { bestS } : {}),
    ...(!done && latest.skipped ? { skipped: latest.skipped } : {}),
  };
}

function merge(here: ProgressBackup['stores'], file: ProgressBackup['stores']): ProgressBackup['stores'] {
  const lessons: LessonProgress = {};
  for (const id of new Set([...Object.keys(here.lessons), ...Object.keys(file.lessons)]) as Set<keyof LessonProgress>) {
    const m = mergeLesson(here.lessons[id], file.lessons[id]);
    if (m) lessons[id] = m;
  }
  const races: Bests['races'] = { ...here.bests.races };
  for (const [k, r] of Object.entries(file.bests.races)) if (!races[k] || r.timeS < races[k]!.timeS) races[k] = r;
  const start = [here.bests.start, file.bests.start].filter((x): x is NonNullable<Bests['start']> => !!x).sort((x, y) => x.delayS - y.delayS)[0];
  const challengeTimes: Record<string, LikeForLike> = { ...here.challengeTimes };
  for (const [k, e] of Object.entries(file.challengeTimes)) {
    const h = challengeTimes[k];
    if (!h) {
      challengeTimes[k] = e;
      continue;
    }
    const better = (x?: { timeS: number; at: string }, y?: { timeS: number; at: string }) => (!x ? y : !y ? x : y.timeS < x.timeS ? y : x);
    const seen = new Set<string>();
    const history = [...h.history, ...e.history]
      .filter((a) => {
        const key = `${a.at}|${a.timeS}|${a.independent}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((x, y) => x.at.localeCompare(y.at))
      .slice(-HISTORY_MAX);
    const independent = better(h.independent, e.independent);
    const assisted = better(h.assisted, e.assisted);
    challengeTimes[k] = { label: h.label, ...(independent ? { independent } : {}), ...(assisted ? { assisted } : {}), history };
  }
  const runKey = (r: StoredRun) => `${r.exercise}|${r.at}`;
  const known = new Set(here.exerciseRuns.map(runKey));
  const exerciseRuns = [...here.exerciseRuns, ...file.exerciseRuns.filter((r) => !known.has(runKey(r)))].sort((x, y) => x.at.localeCompare(y.at)).slice(-MAX_RUNS);
  const started = [...new Set([...here.learnMap.started, ...file.learnMap.started])].slice(-64);
  return { lessons, bests: { races, ...(start ? { start } : {}) }, challengeTimes, exerciseRuns, learnMap: { started } };
}

export interface RestoreResult {
  ok: boolean;
  /** What changed, in words, store by store (nothing listed: it was all here already). */
  changes: string[];
  error?: string;
}

/**
 * Restore a backup into this browser, merged with what is here (see the module comment). All or nothing: a refused file
 * changes nothing, and a save that fails part-way puts back what it had written.
 */
export function restoreProgress(text: string): RestoreResult {
  let file: ProgressBackup;
  try {
    file = parseBackup(text);
  } catch (e) {
    return { ok: false, changes: [], error: (e as Error).message };
  }
  const here = current();
  const merged = merge(here, file.stores);
  const changes = describe(here, merged);
  const before = new Map<string, string | null>();
  const written: string[] = [];
  for (const name of Object.keys(STORES) as StoreName[]) {
    const { key, what } = STORES[name];
    const next = JSON.stringify(merged[name]);
    // Unchanged in content (whatever the order of its fields): left as it is, so a repeated restore writes nothing.
    if (canon(merged[name]) === canon(here[name])) continue;
    try {
      before.set(key, typeof localStorage === 'undefined' ? null : localStorage.getItem(key));
    } catch {
      before.set(key, null);
    }
    if (!persist(key, next, what)) {
      // Put back what was written, so the browser holds exactly what it held before.
      for (const k of written) {
        const old = before.get(k);
        try {
          if (old === null || old === undefined) localStorage.removeItem(k);
          else localStorage.setItem(k, old);
        } catch {
          // storage refusing writes: nothing was changed in the first place
        }
      }
      return { ok: false, changes: [], error: `This browser could not save ${what}, so nothing was restored (what was here is unchanged).` };
    }
    written.push(key);
  }
  return { ok: true, changes };
}

function describe(a: ProgressBackup['stores'], b: ProgressBackup['stores']): string[] {
  const out: string[] = [];
  const doneA = Object.values(a.lessons).filter((e) => e?.done).length;
  const doneB = Object.values(b.lessons).filter((e) => e?.done).length;
  if (doneB > doneA) out.push(`${doneB - doneA} more lesson${doneB - doneA === 1 ? '' : 's'} done (${doneB} in all)`);
  const improved = Object.entries(b.bests.races).filter(([k, r]) => !a.bests.races[k] || r.timeS < a.bests.races[k]!.timeS).length;
  if (improved) out.push(`${improved} best time${improved === 1 ? '' : 's'} added or improved`);
  if (b.bests.start && (!a.bests.start || b.bests.start.delayS < a.bests.start.delayS)) out.push('a quicker best start');
  const histA = Object.values(a.challengeTimes).reduce((n, e) => n + e.history.length, 0);
  const histB = Object.values(b.challengeTimes).reduce((n, e) => n + e.history.length, 0);
  if (histB > histA || Object.keys(b.challengeTimes).length > Object.keys(a.challengeTimes).length) out.push(`challenge times: ${Object.keys(b.challengeTimes).length} course${Object.keys(b.challengeTimes).length === 1 ? '' : 's'}, ${histB} attempts kept`);
  if (b.exerciseRuns.length > a.exerciseRuns.length) out.push(`${b.exerciseRuns.length - a.exerciseRuns.length} exercise run${b.exerciseRuns.length - a.exerciseRuns.length === 1 ? '' : 's'} added`);
  if (b.learnMap.started.length > a.learnMap.started.length) out.push('the Learn map’s started steps');
  return out;
}
