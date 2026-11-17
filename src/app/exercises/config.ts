import file from '../../../data/exercises/thresholds.json' with { type: 'json' };

/**
 * The exercises' thresholds (data/exercises/thresholds.json): every value is the simulator's provisional choice (E),
 * awaiting an instructor's review; none is any body's syllabus. An instructor can change them for this browser
 * (exported and imported as a file), so a club can try stricter or easier settings without a new build.
 */

/** Where an exercise's content stands: all of it is a draft until an instructor has reviewed it. */
export type ContentStatus = 'draft' | 'instructor-reviewed' | 'empirically-validated';
export const CONTENT_STATUS: ContentStatus = file.status as ContentStatus;
export const CONTENT_STATUS_NOTE: string = file.statusNote;

type Entry = { value: number; unit: string; tag: string; source: string };
type Values<T> = { [K in keyof T]: number };

export type TackRecoverThresholds = Values<typeof file.tackRecover>;
export type WindShiftThresholds = Values<typeof file.windShift>;
export interface Thresholds {
  tackRecover: TackRecoverThresholds;
  windShift: WindShiftThresholds;
}

const values = <T extends Record<string, Entry>>(o: T): Values<T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.value])) as Values<T>;

/** The thresholds as shipped. */
export const DEFAULT_THRESHOLDS: Thresholds = { tackRecover: values(file.tackRecover), windShift: values(file.windShift) };

/** Each threshold's unit, tag and source, for the instructor's view and the report. */
export const THRESHOLD_SOURCES = { tackRecover: file.tackRecover, windShift: file.windShift } as const;

const KEY = 'squib.exercises.thresholds.v1';

/**
 * Overrides kept in this browser (an instructor's settings), merged over the defaults. Unknown keys and values that
 * are not finite numbers are ignored, so a bad file cannot break an exercise.
 */
export function loadThresholds(): Thresholds {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return mergeThresholds(raw);
  } catch {
    return structuredClone(DEFAULT_THRESHOLDS);
  }
}

export function mergeThresholds(raw: unknown): Thresholds {
  const out = structuredClone(DEFAULT_THRESHOLDS);
  if (!raw || typeof raw !== 'object') return out;
  for (const group of ['tackRecover', 'windShift'] as const) {
    const g = (raw as Record<string, unknown>)[group];
    if (!g || typeof g !== 'object') continue;
    const target = out[group] as Record<string, number>;
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) if (k in target && typeof v === 'number' && Number.isFinite(v)) target[k] = v;
  }
  return out;
}

/** Keep an instructor's thresholds in this browser; returns false when storage is unavailable. */
export function saveThresholds(t: Partial<Record<keyof Thresholds, Record<string, number>>>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

/** Back to the shipped thresholds. */
export function resetThresholds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: nothing was kept
  }
}

/** The thresholds in use differ from the shipped ones (shown on the result card, so results are not compared blindly). */
export function thresholdsChanged(t: Thresholds): boolean {
  return JSON.stringify(t) !== JSON.stringify(DEFAULT_THRESHOLDS);
}
