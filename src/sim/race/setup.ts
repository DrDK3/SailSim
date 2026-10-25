import { buildConditions, type ConditionsSettings } from '../env/conditions';
import type { Environment } from '../env/environment';
import type { DartGeo } from '../geo/dart';
import { DART_PROJECTION } from '../geo/projection';
import { squibParams } from '../boat/squib';
import type { BoatParams } from '../boat/params';
import { buildRestrictions } from '../course/restrictions';
import { DART_LEVELS, validateCourse, type CourseIssue } from '../course/validate';
import type { Course } from '../course/types';
import type { ResolvedCourse } from '../course/course';
import type { FerryRoute } from '../env/ferries';
import type { ControlInput, InitialConditions, Simulation } from '../simulation';
import type { AiLevel } from '../ai/skipper';
import type { CommitteeOptions } from './committee';
import { RaceSession, type EntrySpec } from './session';

/** The parts of the River Dart features the race needs (moored boats, mooring areas, ferries). */
export interface RaceFeatures {
  moorings: { e: number; n: number; l: number; a: string }[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  ferries: (FerryRoute & { name: string; ram: boolean })[];
}

export interface RaceSetup {
  conditions: ConditionsSettings;
  /** An environment already built from `conditions` (the app's), used instead of building a new one. */
  env?: Environment;
  geo?: DartGeo;
  features?: RaceFeatures;
  course: Course;
  aiCount: number;
  level: AiLevel;
  seed: number;
  /** The user's boat (omit for an AI-only race). */
  human?: {
    name?: string;
    controller?: (sim: Simulation) => Partial<ControlInput> | void;
    input?: Partial<ControlInput>;
    /** Where the user's boat starts (or a function of the resolved course); default: the first starting slot. */
    initial?: InitialConditions | ((r: ResolvedCourse) => InitialConditions);
    /** The user's Squib type (default: the Rondar type the AI fleet sails). */
    params?: BoatParams;
  };
  committee: Partial<Omit<CommitteeOptions, 'startAt'>> & { startAt: number };
}

/** Hull colours for AI boats (distinct, readable on water). */
const COLOURS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0x16a085, 0xd35400, 0x34495e, 0xe84393, 0x7f8c8d, 0x2c3e50, 0xa04000, 0x1abc9c, 0x9b59b6, 0x3498db, 0xb7950b, 0x6c3483, 0x117864, 0x922b21];

/** Starting-line length for a practice course with this many boats: 2.5 boat lengths per boat, at least 100 m (E). */
export function practiceLineLength(boats: number): number {
  return Math.max(100, Math.round(2.5 * boats * 5.79));
}

/** Sail numbers for AI boats: invented, labelled "AI" (no real boats or owners). */
export function aiName(i: number): { name: string; sailNumber: string } {
  return { name: `AI ${i + 1}`, sailNumber: `AI${String(i + 1).padStart(2, '0')}` };
}

/**
 * Pre-start positions: rows 60, 95, 130 … m behind the starting line, spread along its length,
 * heading along the line towards the first end at 2 kn. Index 0 is the user's place when there is one.
 */
export function startPositions(r: ResolvedCourse, count: number): InitialConditions[] {
  const [a, b] = r.start;
  const L = Math.hypot(b.n - a.n, b.e - a.e) || 1;
  const u = { n: (b.n - a.n) / L, e: (b.e - a.e) / L };
  let nn = { n: -u.e, e: u.n };
  const first = r.legs[0]!.target;
  const m = { n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 };
  if ((first.n - m.n) * nn.n + (first.e - m.e) * nn.e > 0) nn = { n: -nn.n, e: -nn.e };
  // Slots within the length of the line (not beyond its ends, where the committee boat and pin are).
  const perRow = Math.max(2, Math.min(7, Math.floor((0.85 * L) / 20) + 1, count));
  const span = 0.85 * L;
  const heading = ((Math.atan2(-u.e, -u.n) * 180) / Math.PI + 360) % 360;
  const out: InitialConditions[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const k = i % perRow;
    const along = -span / 2 + (span * (k + 0.5 + (row % 2) * 0.5)) / perRow;
    const back = 60 + 35 * row;
    out.push({ n: m.n + u.n * along + nn.n * back, e: m.e + u.e * along + nn.e * back, headingDeg: heading, speedKn: 2 });
  }
  return out;
}

export interface CreatedRace {
  session: RaceSession;
  warnings: CourseIssue[];
}

/** Validate the course on the River Dart data (when given) and build the race. Throws on an invalid course. */
export function createRace(s: RaceSetup): CreatedRace {
  const geo = s.geo;
  const env = s.env ?? buildConditions(s.conditions, geo).env;
  const restrictions = s.features ? buildRestrictions(s.features) : undefined;
  const params = squibParams();
  const v = validateCourse(s.course, {
    projection: DART_PROJECTION,
    seabed: geo,
    inDomain: geo ? (n, e) => geo.inDomain(n, e) : undefined,
    restrictions,
    draft: params.draft,
    ...DART_LEVELS,
    lowWaterOdn: -(geo?.cdBelowOdn ?? 2.62),
  });
  if (!v.ok || !v.resolved) throw new Error(`course "${s.course.name}" is not valid: ${v.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ')}`);
  const total = s.aiCount + (s.human ? 1 : 0);
  const pos = startPositions(v.resolved, total);
  const entries: EntrySpec[] = [];
  let k = 0;
  if (s.human) {
    const init = s.human.initial;
    entries.push({ id: 'you', name: s.human.name ?? 'You', sailNumber: 'GBR', colour: 0xf5f5f2, kind: 'human', initial: typeof init === 'function' ? init(v.resolved) : init ?? pos[k]! });
    k++;
  }
  for (let i = 0; i < s.aiCount; i++) entries.push({ id: `ai-${i + 1}`, ...aiName(i), colour: COLOURS[i % COLOURS.length]!, kind: 'ai', initial: pos[k++]!, level: s.level });
  const session = new RaceSession({
    env,
    params,
    humanParams: s.human?.params,
    seabed: geo,
    course: s.course,
    resolved: v.resolved,
    committee: s.committee,
    entries,
    humanController: s.human?.controller,
    humanInput: s.human?.input,
    moored: s.features?.moorings.map((m) => ({ n: m.n, e: m.e, l: m.l, area: m.a })),
    ferries: s.features?.ferries,
    mooringAreas: restrictions?.moorings,
    seed: s.seed,
  });
  return { session, warnings: v.issues.filter((i) => i.severity === 'warning') };
}
