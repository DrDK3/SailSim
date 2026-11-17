import type { AttemptRecord, HelpEvent } from './engine';
import type { ContentStatus } from './config';

/**
 * Learner records for the exercises: kept in this browser only (localStorage, every access wrapped so a blocked or
 * full storage never breaks an exercise), and exported or imported as a file the learner chooses to save or share
 * (for an instructor). No names, no free text, no identifiers: the attempts, the help shown and the build.
 */

export const RECORDS_SCHEMA = 'squib-exercise-records/1';
const KEY = 'squib.exercises.records.v1';
/** The most recent runs kept (older ones drop off). */
export const MAX_RUNS = 30;

export interface StoredRun {
  exercise: string;
  /** When the run ended (ISO time). */
  at: string;
  build: string;
  /** The thresholds in use were not the shipped ones (an instructor's settings). */
  thresholdsChanged: boolean;
  status: ContentStatus;
  attempts: AttemptRecord[];
  help: HelpEvent[];
}

export interface RecordsFile {
  schema: typeof RECORDS_SCHEMA;
  exported: string;
  runs: StoredRun[];
}

export function loadRuns(): StoredRun[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw.filter(isRun) as StoredRun[]) : [];
  } catch {
    return [];
  }
}

/** Keep a finished run; returns false when storage is unavailable (the run is still shown). */
export function saveRun(run: StoredRun): boolean {
  const runs = [...loadRuns(), run].slice(-MAX_RUNS);
  try {
    localStorage.setItem(KEY, JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}

export function exportRuns(runs = loadRuns(), now = new Date()): string {
  const file: RecordsFile = { schema: RECORDS_SCHEMA, exported: now.toISOString(), runs };
  return JSON.stringify(file, null, 1);
}

/** Read a records file; the runs not already kept are added. Anything that is not a valid run is skipped. */
export function importRuns(text: string): { added: number; skipped: number; error?: string } {
  let file: Partial<RecordsFile>;
  try {
    file = JSON.parse(text) as Partial<RecordsFile>;
  } catch {
    return { added: 0, skipped: 0, error: 'Not a JSON file.' };
  }
  if (file.schema !== RECORDS_SCHEMA || !Array.isArray(file.runs)) return { added: 0, skipped: 0, error: 'Not a SailSim exercise records file.' };
  const have = loadRuns();
  const keyOf = (r: StoredRun) => `${r.exercise}|${r.at}`;
  const known = new Set(have.map(keyOf));
  const valid = file.runs.filter(isRun) as StoredRun[];
  const fresh = valid.filter((r) => !known.has(keyOf(r)));
  try {
    localStorage.setItem(KEY, JSON.stringify([...have, ...fresh].slice(-MAX_RUNS)));
  } catch {
    return { added: 0, skipped: file.runs.length, error: 'This browser does not allow saving records.' };
  }
  return { added: fresh.length, skipped: file.runs.length - fresh.length };
}

function isRun(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<StoredRun>;
  return typeof r.exercise === 'string' && typeof r.at === 'string' && typeof r.build === 'string' && Array.isArray(r.attempts) && Array.isArray(r.help);
}
