/**
 * Personal bests, kept in this browser (review UI benchmark G4 and G8: visible progress): the best elapsed time
 * on each course (and on each day's challenge), and the best start (the shortest time from the start signal to
 * crossing the line, after a clean start). Conditions differ from race to race, so a best is a record of what
 * you did, not a like-for-like ranking. Nothing is sent anywhere: shared tables would need a service.
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
