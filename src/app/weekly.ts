/// <reference types="vite/client" />
/**
 * The weekly course (juniors round §6.3, layer A: no server). One course per ISO week, the weeks running Monday to
 * Sunday in Europe/London time, chosen from a rotation by the week alone, with conditions seeded by the week alone:
 * everyone sailing in the same week sails the same course in the same wind, so times compare directly.
 *
 * - Boat: the Rondar Squib (the default class boat). Damage: as in every race (contact and grounding can damage).
 * - No tidal stream: the AI that sails the targets knows the stream along its path and a player cannot see it (RA-2),
 *   so the stream is off for everyone (parity).
 * - Sailed alone (no AI boats on the water): the targets are model-sailed ghosts, recordings that do not react.
 * - Assists: allowed, and recorded; times are kept as independent or assisted (src/app/assists.ts).
 * - Optionally the owner may set a season's courses in data/weekly/season.json ({ "weeks": { "2026-W48": "<course>" } },
 *   course = a library course id or "practice:<kind>"); weeks not listed use the rotation. Nothing needs editing weekly.
 */
import type { AppScenario } from './controller';
import { builtInCourses, type LibraryEntry } from './courseLibrary';
import { createRng } from '../sim/math/rng';
import type { PracticeKind } from '../sim/course/practice';
import { DEFAULT_SQUIB_TYPE } from '../sim/boat/squib';

export const WEEK_TZ = 'Europe/London';

/** The calendar date (y, m 1–12, d) in London for an instant. */
export function londonDate(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: WEEK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** ISO 8601 week of a calendar date: its week-numbering year and week (1–53), and the Monday (UTC midnight, ms). */
export function isoWeekOf(y: number, m: number, d: number): { year: number; week: number; mondayMs: number } {
  const date = Date.UTC(y, m - 1, d);
  const dow = (new Date(date).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  const monday = date - dow * 86400e3;
  const thursday = monday + 3 * 86400e3;
  const year = new Date(thursday).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = 1 + Math.floor((thursday - jan1) / (7 * 86400e3));
  return { year, week, mondayMs: monday };
}

export interface WeekId {
  /** "2026-W47" */
  key: string;
  year: number;
  week: number;
  /** Weeks since the Monday 5 Jan 1970 (a stable index for the rotation, across years). */
  index: number;
  /** The Monday's date (yyyy-mm-dd, London). */
  monday: string;
}

export function weekOf(at: Date = new Date()): WeekId {
  const { y, m, d } = londonDate(at);
  const w = isoWeekOf(y, m, d);
  const index = Math.round((w.mondayMs - Date.UTC(1970, 0, 5)) / (7 * 86400e3));
  return { key: `${w.year}-W${String(w.week).padStart(2, '0')}`, year: w.year, week: w.week, index, monday: new Date(w.mondayMs).toISOString().slice(0, 10) };
}

/** The rotation: practice courses in Start Bay and the RDYC courses (pending the club's check), alternately. */
export type WeeklySlot = { kind: 'practice'; practice: PracticeKind; legM?: number } | { kind: 'club'; id: string };

export function rotation(courses: LibraryEntry[] = builtInCourses()): WeeklySlot[] {
  const club = courses.filter((c) => c.group === 'club').map((c) => c.id).sort();
  const practice: WeeklySlot[] = [
    { kind: 'practice', practice: 'windward-leeward', legM: 300 },
    { kind: 'practice', practice: 'triangle', legM: 300 },
    { kind: 'practice', practice: 'windward-leeward', legM: 450 },
    { kind: 'practice', practice: 'rounding-drill' },
  ];
  const out: WeeklySlot[] = [];
  const n = Math.max(club.length, practice.length);
  for (let i = 0; i < n; i++) {
    out.push(practice[i % practice.length]!);
    if (club[i]) out.push({ kind: 'club', id: club[i]! });
  }
  return out;
}

const season = import.meta.glob('../../data/weekly/season.json', { eager: true, import: 'default' }) as Record<string, { weeks?: Record<string, string> }>;

/** The owner's season plan, if one is shipped: week key → course. */
export function seasonPlan(): Record<string, string> {
  return Object.values(season)[0]?.weeks ?? {};
}

function slotFor(week: WeekId, courses: LibraryEntry[], plan: Record<string, string>): WeeklySlot {
  const set = plan[week.key];
  if (set?.startsWith('practice:')) return { kind: 'practice', practice: set.slice(9) as PracticeKind };
  if (set && courses.some((c) => c.id === set)) return { kind: 'club', id: set };
  const r = rotation(courses);
  return r[((week.index % r.length) + r.length) % r.length]!;
}

/** A stable seed from the week key (FNV-1a). */
export function weekSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 99991) + 1;
}

export interface WeeklyCourse {
  week: WeekId;
  slot: WeeklySlot;
  /** Name for the course card. */
  name: string;
  /** "pending club check" for the RDYC courses (docs/CLUB_DOCUMENTS.md); undefined for practice courses. */
  status?: string;
  scenario: AppScenario;
  /** The fixed terms, shown on the course card. */
  terms: { boat: string; damage: string; stream: string; assists: string; fleet: string };
  /** The conditions in words. */
  summary: string;
}

const PRACTICE_NAMES: Partial<Record<PracticeKind, string>> = {
  'windward-leeward': 'Windward–leeward',
  triangle: 'Triangle',
  'rounding-drill': 'Rounding drill',
};

/**
 * The week's course and scenario. Conditions from the week's seed: 8–14 kn, moderate or shifty (never the strong
 * gusty days: a juniors' course, E), on a summer Wednesday afternoon, fair sky; a club course gets a wind within 15°
 * of the direction it is set for.
 */
export function weeklyCourse(at: Date = new Date(), courses: LibraryEntry[] = builtInCourses(), plan: Record<string, string> = seasonPlan()): WeeklyCourse {
  const week = weekOf(at);
  const slot = slotFor(week, courses, plan);
  const seed = weekSeed(week.key);
  const rng = createRng(seed * 7919 + 101);
  const twsKn = Math.round((8 + 6 * rng.next()) * 2) / 2;
  const club = slot.kind === 'club' ? courses.find((c) => c.id === slot.id) : undefined;
  const base = club?.course.designWindFromDeg ?? Math.floor(rng.next() * 360);
  const twdDeg = Math.round(((base + (club ? (rng.next() - 0.5) * 30 : 0)) % 360 + 360) % 360);
  const preset = rng.next() < 0.5 ? 'moderate' : 'shifty';
  // The fixed day of the week's conditions: its Wednesday, 14:00 UTC (the light; the tide is fixed by it too).
  const wednesday = new Date(Date.parse(week.monday) + 2 * 86400e3 + 14 * 3600e3);
  const iso = (d: Date) => d.toISOString().slice(0, 16) + ':00Z';
  const hw = new Date(wednesday.getTime() + Math.round((rng.next() - 0.5) * 12.4 * 60) * 60e3);
  const scenario: AppScenario = {
    conditions: {
      startTime: iso(wednesday),
      weather: { source: 'manual', twsKn, twdDeg },
      gusts: { preset, seed },
      tide: { mode: 'manual', hwTime: iso(hw), hwHeightM: 4.6, lwHeightM: 1.2 },
      current: { mode: 'none' },
      sky: { source: 'preset', preset: 'fair' },
    },
    startLocation: club ? 'start-bay' : 'start-bay-practice',
    startHeadingDeg: 0,
    startSpeedKn: 2,
    course: club ? { source: 'library', id: club.id } : { source: 'practice', kind: slot.kind === 'practice' ? slot.practice : 'windward-leeward', ...(slot.kind === 'practice' && slot.legM ? { legM: slot.legM } : {}), laps: 1 },
    race: { sequence: 'one-minute', startInS: 90 },
    fleet: { aiCount: 0, level: 'good', prepFlag: 'P' },
    boat: DEFAULT_SQUIB_TYPE,
  };
  const name = club ? club.course.name.replace(/ \(club course\)$/, '') : `${PRACTICE_NAMES[slot.kind === 'practice' ? slot.practice : 'windward-leeward'] ?? 'Practice'} in Start Bay`;
  return {
    week, slot, name, status: club ? 'pending club check' : undefined, scenario,
    terms: {
      boat: 'Rondar Squib',
      damage: 'on, as in every race',
      stream: 'off (no tidal stream, so the model-sailed targets know no more than you)',
      assists: 'allowed; times kept separately as independent or assisted',
      fleet: 'alone on the water; targets and friends are ghosts (recordings that do not react)',
    },
    summary: `${twsKn} kn from ${twdDeg}°, ${preset} (the same all week)`,
  };
}

/** The best-time key for a week (kept apart from every other best). */
export const weeklyKey = (w: WeekId): string => `weekly:${w.key}`;
