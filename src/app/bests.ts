/**
 * Personal bests, kept in this browser (review UI benchmark G4 and G8: visible progress): the best elapsed time
 * on each course (and on each day's challenge), and the best start (the shortest time from the start signal to
 * crossing the line, after a clean start). Conditions differ from race to race, so a best is a record of what
 * you did, not a like-for-like ranking. Nothing is sent anywhere: shared tables would need a service.
 *
 * Like-for-like bests (juniors round §6.2): for the weekly course and the daily challenge only, whose conditions are
 * fixed, so times compare. Each keeps the best independent time and the best assisted time apart (the assist record,
 * src/app/assists.ts), and the last attempts for a small chart of progress. Still kept only in this browser.
 */

const KEY = 'squib.bests.v1';

export interface Bests {
  /** By course key (course name and laps, or a challenge key). */
  races: Record<string, { timeS: number; at: string; label: string }>;
  /** Seconds from the start signal to a clean start. */
  start?: { delayS: number; at: string };
}

export interface BestResult {
  best: boolean;
  /** The best before this one, if there was one. */
  previousS?: number;
}

export function loadBests(): Bests {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Bests | null;
    if (raw && typeof raw === 'object' && raw.races && typeof raw.races === 'object') return raw;
  } catch {
    // storage unavailable or unreadable: no bests yet
  }
  return { races: {} };
}

function save(b: Bests): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // storage unavailable: kept for this visit only
  }
}

/** The key for a course's best time: its name and laps. */
export function courseKey(name: string, laps: number): string {
  return `${name} · ${laps} lap${laps === 1 ? '' : 's'}`;
}

export function recordRaceTime(key: string, label: string, timeS: number, now = new Date()): BestResult {
  const b = loadBests();
  const was = b.races[key];
  const best = !was || timeS < was.timeS;
  if (best) {
    b.races[key] = { timeS, at: now.toISOString(), label };
    save(b);
  }
  return { best, previousS: was?.timeS };
}

export function recordStart(delayS: number, now = new Date()): BestResult {
  const b = loadBests();
  const was = b.start;
  const best = !was || delayS < was.delayS;
  if (best) {
    b.start = { delayS, at: now.toISOString() };
    save(b);
  }
  return { best, previousS: was?.delayS };
}

// ------------------------------------------------------------ like-for-like bests (juniors round)

const LFL_KEY = 'squib.bests.likeForLike.v1';
/** Attempts kept per course for the progress chart. */
export const HISTORY_MAX = 20;

export interface Attempt {
  at: string;
  timeS: number;
  independent: boolean;
}

export interface LikeForLike {
  label: string;
  independent?: { timeS: number; at: string };
  assisted?: { timeS: number; at: string };
  /** Most recent last. */
  history: Attempt[];
}

/** Only these keys have like-for-like bests: the weekly course and the daily challenge. */
export const isLikeForLikeKey = (key: string): boolean => /^(weekly:\d{4}-W\d{2}|challenge:\d{4}-\d{2}-\d{2})$/.test(key);

function loadAll(): Record<string, LikeForLike> {
  try {
    const raw = JSON.parse(localStorage.getItem(LFL_KEY) ?? 'null') as Record<string, LikeForLike> | null;
    if (raw && typeof raw === 'object') return raw;
  } catch {
    // storage unavailable or unreadable
  }
  return {};
}

export function loadLikeForLike(key: string): LikeForLike | undefined {
  return loadAll()[key];
}

/** Record a finished attempt; returns whether it is a new best in its category (independent or assisted). */
export function recordAttempt(key: string, label: string, timeS: number, independent: boolean, now = new Date()): BestResult {
  if (!isLikeForLikeKey(key) || !(timeS > 0)) return { best: false };
  const all = loadAll();
  const e: LikeForLike = all[key] ?? { label, history: [] };
  const cat = independent ? 'independent' : 'assisted';
  const was = e[cat];
  const best = !was || timeS < was.timeS;
  if (best) e[cat] = { timeS, at: now.toISOString() };
  e.history = [...e.history, { at: now.toISOString(), timeS, independent }].slice(-HISTORY_MAX);
  all[key] = e;
  try {
    localStorage.setItem(LFL_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: kept for this visit only
  }
  return { best, previousS: was?.timeS };
}
