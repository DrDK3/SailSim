/**
 * Personal bests, kept in this browser (review UI benchmark G4 and G8: visible progress): the best elapsed time
 * on each course (and on each day's challenge), and the best start (the shortest time from the start signal to
 * crossing the line, after a clean start). From 23 Nov 2026 (design handover item 6) an ordinary race's best is kept
 * per identity (course and its shape, laps, wind band, fleet size, boat, spinnaker, rules, assistance), so a changed
 * condition cannot earn a personal best; earlier times are kept and shown as "other conditions". Nothing is sent
 * anywhere: shared tables would need a service.
 *
 * Like-for-like bests (juniors round §6.2): for the weekly course and the daily challenge only, whose conditions are
 * fixed, so times compare. Each keeps the best independent time and the best assisted time apart (the assist record,
 * src/app/assists.ts), and the last attempts for a small chart of progress. Still kept only in this browser.
 */
import { persist } from './storage';

const KEY = 'squib.bests.v1';

export interface Bests {
  /**
   * By key: the identity of an ordinary race (`race:…`, from 23 Nov 2026: raceIdentityKey), a challenge or weekly key,
   * or an older time by course name and laps only (courseKey), kept and shown as "other conditions".
   */
  races: Record<string, { timeS: number; at: string; label: string }>;
  /** Seconds from the start signal to a clean start, and the speed when crossing (kn; from 23 Nov 2026). */
  start?: { delayS: number; at: string; kn?: number };
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
  // Storage unavailable or full: kept for this visit only, and the app says so (src/app/storage.ts).
  persist(KEY, JSON.stringify(b), 'your best times');
}

/**
 * The key ordinary race bests used until 23 Nov 2026: the course's name and laps only, whatever the conditions. Kept to
 * find those older times, which are shown as "other conditions" and never compared (design handover item 6).
 */
export function courseKey(name: string, laps: number): string {
  return `${name} · ${laps} lap${laps === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------ like-with-like ordinary race bests (23 Nov 2026)

/**
 * What makes two ordinary race times comparable (design handover item 6; the owner's choice, 23 Nov 2026: like with
 * like). A personal best is claimed only against times with the same identity; anything else on the same course is
 * shown apart as "other conditions".
 */
export interface RaceIdentity {
  course: string;
  laps: number;
  /** The course's shape, independent of where it is laid: leg lengths (10 m) and the start line (5 m), hashed. */
  geometry: string;
  /** The true wind band at the line when the race began. */
  windBand: string;
  /** Boats in the race, you included. */
  fleet: number;
  /** The user's boat type. */
  boat: string;
  spinnaker: boolean;
  /** The rules version (RULESET) and whether the simplified rule 18 gave penalties. */
  rules: string;
  /** No assists at any time (src/app/assists.ts), or assisted. */
  assistance: 'independent' | 'assisted';
}

/** Wind bands (kn): times in different bands are not compared. */
export const WIND_BANDS = [6, 10, 14, 18] as const;
export function windBand(twsKn: number): string {
  const i = WIND_BANDS.findIndex((b) => twsKn < b);
  if (i === 0) return `under ${WIND_BANDS[0]} kn`;
  if (i < 0) return `${WIND_BANDS.at(-1)} kn and over`;
  return `${WIND_BANDS[i - 1]}–${WIND_BANDS[i]} kn`;
}

/** A short, stable hash of a course's shape (FNV-1a over the rounded leg lengths and line length). */
export function courseGeometry(legLengthsM: readonly number[], lineM: number): string {
  const text = `${legLengthsM.map((d) => Math.round(d / 10) * 10).join(',')}/${Math.round(lineM / 5) * 5}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

export function raceIdentityKey(id: RaceIdentity): string {
  return `race:${id.course}|${id.laps}|${id.geometry}|${id.windBand}|${id.fleet}|${id.boat}|${id.spinnaker ? 'spin' : 'nospin'}|${id.rules}|${id.assistance}`;
}

/** The identity in words: "Short course · 1 lap · 10–14 kn · 4 boats · spinnaker · independent". */
export function raceIdentityLabel(id: RaceIdentity): string {
  return `${courseKey(id.course, id.laps)} · ${id.windBand} · ${id.fleet === 1 ? 'alone' : `${id.fleet} boats`} · ${id.spinnaker ? 'spinnaker' : 'no spinnaker'} · ${id.assistance}`;
}

/**
 * The best time on the same course and laps in other conditions: other identities, and the times kept before
 * 23 Nov 2026 by name and laps only. Shown apart, never compared.
 */
export function otherConditionsBest(b: Bests, id: RaceIdentity): { timeS: number; at: string; label: string } | undefined {
  const own = raceIdentityKey(id);
  const prefix = `race:${id.course}|${id.laps}|`;
  const old = courseKey(id.course, id.laps);
  const others = Object.entries(b.races).filter(([k]) => k !== own && (k === old || k.startsWith(prefix) || keyBase(k) === old));
  return others.length ? others.map(([, v]) => v).sort((x, y) => x.timeS - y.timeS)[0] : undefined;
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

/**
 * A clean start: the best is the shortest delay after the signal; the speed when crossing is kept with it, so a start
 * is judged on its speed as well as its timing (design handover item 6).
 */
export function recordStart(delayS: number, now = new Date(), kn?: number): BestResult {
  const b = loadBests();
  const was = b.start;
  const best = !was || delayS < was.delayS;
  if (best) {
    b.start = { delayS, at: now.toISOString(), ...(kn !== undefined ? { kn: Math.round(kn * 10) / 10 } : {}) };
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

/**
 * The rules a time was sailed under, in the like-for-like keys of the weekly course and today's challenge (fixes of
 * 21 Nov 2026, §3.2), so that times sailed under different rules are never compared. r1: the keys without a suffix,
 * until this release (week 47's course changed mid-week, from the RDYC's C1 to the rounding drill; today's challenge
 * gained the spinnaker on 21 Nov 2026). r2: from this release (rule 18 advisory; the spinnaker on the weekly course
 * from 2026-W48). A time kept under another ruleset stays where it is and is shown as "earlier rules".
 */
export const RULESET = 'r2';
/** A course's key under the current rules: "weekly:2026-W48:r2". */
export const ruleKey = (base: string): string => `${base}:${RULESET}`;
/** A key without its ruleset: "weekly:2026-W48". */
export const keyBase = (key: string): string => key.replace(/:r\d+$/, '');

/** Only these keys have like-for-like bests: the weekly course and the daily challenge, under any ruleset. */
export const isLikeForLikeKey = (key: string): boolean => /^(weekly:\d{4}-W\d{2}(:long)?|challenge:\d{4}-\d{2}-\d{2})(:r\d+)?$/.test(key);

/**
 * The best kept for the same course under earlier rules (the same key with no ruleset or another), shown apart as
 * "earlier rules" and never compared with times under the current ones (§3.2).
 */
export function earlierRulesLikeForLike(key: string): LikeForLike | undefined {
  const base = keyBase(key);
  const all = loadAll();
  const older = Object.keys(all).filter((k) => k !== key && keyBase(k) === base);
  return older.length ? all[older.sort().at(-1)!] : undefined;
}

/** The same for the plain bests (today's challenge's time): the best under earlier rules, if any (§3.2). */
export function earlierRulesRace(b: Bests, key: string): { timeS: number; at: string; label: string } | undefined {
  const base = keyBase(key);
  const older = Object.keys(b.races).filter((k) => k !== key && keyBase(k) === base);
  return older.length ? b.races[older.sort().at(-1)!] : undefined;
}

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
  persist(LFL_KEY, JSON.stringify(all), 'your challenge times');
  return { best, previousS: was?.timeS };
}
