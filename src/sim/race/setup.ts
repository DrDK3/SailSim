import { buildConditions, type ConditionsSettings } from '../env/conditions';
import type { Environment } from '../env/environment';
import type { DartGeo } from '../geo/dart';
import { DART_PROJECTION } from '../geo/projection';
import { squibParams } from '../boat/squib';
import type { BoatParams } from '../boat/params';
import type { RiverTraffic } from '../env/traffic';
import { buildRestrictions } from '../course/restrictions';
import { pointInPolygon } from '../course/geometry';
import { DART_LEVELS, validateCourse, type CourseIssue } from '../course/validate';
import type { Course } from '../course/types';
import type { ResolvedCourse } from '../course/course';
import type { FerryRoute } from '../env/ferries';
import { DEFAULT_WATER_LEVEL_ODN, type ControlInput, type InitialConditions, type Simulation } from '../simulation';
import type { AiLevel } from '../ai/skipper';
import type { CommitteeOptions } from './committee';
import { RaceSession, type EntrySpec } from './session';
import { PierGrid, pierPieces, type PierInput } from './piers';
import { structuresInWater } from '../env/structures';

/** The parts of the River Dart features the race needs (moored boats, mooring areas, ferries). */
export interface RaceFeatures {
  moorings: { e: number; n: number; l: number; a: string }[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  ferries: (FerryRoute & { name: string; ram: boolean })[];
  /** Piers, jetties and pontoons (solid to the fleet); absent from older data. */
  piers?: readonly PierInput[];
  /** Building footprints: those standing in the water are solid too (src/sim/env/structures.ts). */
  buildings?: readonly { r: readonly (readonly [number, number])[]; n?: string | null }[];
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
  /** River traffic shared with the picture (default: built here from the features' ferry routes). */
  traffic?: RiverTraffic;
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

/** Whether a starting boat may be put at a point: water deep enough, clear of moorings (and the like). */
export type ClearWater = (n: number, e: number) => boolean;

/**
 * Depth a starting slot needs over the draft (m), the clear run it needs ahead along its heading, how far ahead
 * is looked, and the least spacing between boats placed off the regular slots (m) (E).
 */
export const START_CLEARANCE = { depthMarginM: 1.0, runM: 40, lookM: 80, spacingM: 15, structureM: 12 };

/** How far (m, up to `max`) a boat can go from (n, e) along a unit direction before the water is not clear. */
function clearRun(clear: ClearWater, n: number, e: number, dn: number, de: number, max: number): number {
  for (let d = 10; d <= max; d += 10) if (!clear(n + dn * d, e + de * d)) return d - 10;
  return max;
}

/**
 * Pre-start positions: rows 60, 95, 130 … m behind the starting line, spread along its length, heading along
 * the line towards the first end at 2 kn. Index 0 is the user's place when there is one. With `clear`, only
 * slots in clear water with room ahead are used (further rows behind are tried as needed), and a slot whose
 * way towards the first end runs out heads the other way along the line, or else the clearest way; so no boat
 * starts on the mud or sails straight into a bank (a river line can run from bank to bank).
 */
export function startPositions(r: ResolvedCourse, count: number, clear?: ClearWater): InitialConditions[] {
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
  const toDeg = (dn: number, de: number) => ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
  const heading = toDeg(-u.n, -u.e);
  const slot = (i: number): InitialConditions => {
    const row = Math.floor(i / perRow);
    const k = i % perRow;
    const along = -span / 2 + (span * (k + 0.5 + (row % 2) * 0.5)) / perRow;
    const back = 60 + 35 * row;
    return { n: m.n + u.n * along + nn.n * back, e: m.e + u.e * along + nn.e * back, headingDeg: heading, speedKn: 2 };
  };
  if (!clear) return Array.from({ length: count }, (_, i) => slot(i));
  const { runM, lookM, spacingM } = START_CLEARANCE;
  const out: InitialConditions[] = [];
  const rejected: InitialConditions[] = [];
  /** The slot with a heading that has room ahead (along the line towards the first end if it can), or none. */
  const place = (p: InitialConditions): InitialConditions | undefined => {
    const n0 = p.n!;
    const e0 = p.e!;
    if (!clear(n0, e0)) return undefined;
    if (clearRun(clear, n0, e0, -u.n, -u.e, lookM) >= runM) return p;
    if (clearRun(clear, n0, e0, u.n, u.e, lookM) >= runM) return { ...p, headingDeg: toDeg(u.n, u.e) };
    // Hemmed in along the line: the clearest of eight ways, if that gives room.
    let best = -1;
    let bestDeg = heading;
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const run = clearRun(clear, n0, e0, Math.cos(t), Math.sin(t), lookM);
      if (run > best) {
        best = run;
        bestDeg = (k * 45) % 360;
      }
    }
    return best >= runM ? { ...p, headingDeg: bestDeg } : undefined;
  };
  for (let i = 0; out.length < count && i < perRow * 12; i++) {
    const p = slot(i);
    const ok = place(p);
    if (ok) out.push(ok);
    else rejected.push(p);
  }
  if (out.length < count) {
    // Not enough room within the line's width (a narrow channel at low water): clear spots on a wider grid
    // behind the line, nearest the line first, keeping the boats apart.
    const spots: InitialConditions[] = [];
    for (let back = 60; back <= 480; back += 30) {
      for (let along = -L / 2 - 150; along <= L / 2 + 150; along += 20) spots.push({ n: m.n + u.n * along + nn.n * back, e: m.e + u.e * along + nn.e * back, headingDeg: heading, speedKn: 2 });
    }
    const apart = (p: InitialConditions) => out.every((q) => Math.hypot(q.n! - p.n!, q.e! - p.e!) >= spacingM);
    for (const p of spots) {
      if (out.length >= count) break;
      if (!apart(p)) continue;
      const ok = place(p);
      if (ok) out.push(ok);
    }
  }
  // Still not enough clear water behind this line for the whole fleet: the rest where the slots fall (aground).
  for (const p of rejected) if (out.length < count) out.push(p);
  return out;
}

/**
 * Clear water for starting slots on the River Dart: inside the data, at least the draft plus a margin deep at
 * the start's water level (about mean sea level when the run has no tide), outside the mooring areas, and at
 * least START_CLEARANCE.structureM from any pier, pontoon, quay wall or structure standing in the water.
 */
export function startClearWater(geo: DartGeo, waterLevelOdn: number | undefined, draft: number, moorings?: { ring: { n: number; e: number }[] }[], structures?: readonly PierInput[]): ClearWater {
  const level = waterLevelOdn ?? DEFAULT_WATER_LEVEL_ODN;
  const need = draft + START_CLEARANCE.depthMarginM;
  const grid = structures?.length ? new PierGrid(pierPieces(structures)) : undefined;
  return (n, e) =>
    geo.inDomain(n, e) &&
    geo.depth(n, e, level) >= need &&
    !(moorings ?? []).some((a) => pointInPolygon({ n, e }, a.ring)) &&
    !(grid?.within(n, e, START_CLEARANCE.structureM) ?? false);
}

/** The fixed and floating structures of the River Dart a race meets: piers and pontoons, and buildings in the water. */
export function raceStructures(features: RaceFeatures | undefined, geo: DartGeo | undefined): PierInput[] {
  if (!features) return [];
  const wet = geo && features.buildings ? structuresInWater(features.buildings, (n, e) => geo.bedElevation(n, e)) : [];
  return [...(features.piers ?? []), ...wet];
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
  const structures = raceStructures(s.features, geo);
  const pos = startPositions(v.resolved, total, geo ? startClearWater(geo, env.waterLevel?.(0), params.draft, restrictions?.moorings, structures) : undefined);
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
    traffic: s.traffic,
    piers: structures,
    mooringAreas: restrictions?.moorings,
    seed: s.seed,
  });
  return { session, warnings: v.issues.filter((i) => i.severity === 'warning') };
}
