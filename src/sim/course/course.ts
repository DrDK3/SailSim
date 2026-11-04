import { DART_PROJECTION, type LocalProjection } from '../geo/projection';
import { midpoint } from './geometry';
import { COURSE_SCHEMA, type Course, type CourseLeg, type LocalPoint, type Rounding } from './types';

/**
 * Structural check of a course document (types, references). Semantic and geographic checks are in
 * validate.ts. Returns the typed course, or the list of problems.
 */
export function parseCourse(json: unknown): { course?: Course; errors: string[] } {
  const errors: string[] = [];
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { errors: ['not a JSON object'] };
  const str = (k: string, required = true) => {
    const v = o[k];
    if (v === undefined && !required) return;
    if (typeof v !== 'string' || !v.trim()) errors.push(`"${k}" must be a non-empty string`);
  };
  if (o.schema !== COURSE_SCHEMA) errors.push(`"schema" must be "${COURSE_SCHEMA}"`);
  str('id');
  str('name');
  str('description', false);
  if (!['simulated', 'pending-check', 'verified'].includes(o.status as string)) errors.push('"status" must be simulated, pending-check or verified');
  const prov = o.provenance as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== 'object' || !['simulated', 'user', 'club-document'].includes(prov.kind as string)) errors.push('"provenance.kind" must be simulated, user or club-document');
  const marks = o.marks as unknown[];
  const ids = new Set<string>();
  if (!Array.isArray(marks) || marks.length === 0) errors.push('"marks" must be a non-empty array');
  else {
    marks.forEach((m, i) => {
      const mk = m as Record<string, unknown>;
      if (typeof mk?.id !== 'string' || !mk.id) return errors.push(`marks[${i}]: missing id`);
      if (ids.has(mk.id)) errors.push(`marks[${i}]: duplicate id "${mk.id}"`);
      ids.add(mk.id);
      if (typeof mk.name !== 'string') errors.push(`mark ${mk.id}: missing name`);
      if (!['inflatable', 'nav-buoy', 'committee-boat', 'pin', 'fixed', 'virtual'].includes(mk.kind as string)) errors.push(`mark ${mk.id}: bad kind "${String(mk.kind)}"`);
      const p = mk.position as Record<string, unknown> | undefined;
      const ll = p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat as number) <= 90 && Math.abs(p.lon as number) <= 180;
      const ne = p && Number.isFinite(p.n) && Number.isFinite(p.e);
      const pl = mk.placement as Record<string, unknown> | undefined;
      if (pl !== undefined) {
        if (mk.kind !== 'committee-boat') errors.push(`mark ${mk.id}: only a committee boat can be placed on the day`);
        if (typeof pl?.odm !== 'string') errors.push(`mark ${mk.id}: placement needs "odm", the outer distance mark`);
        if (pl?.lineLengthM !== undefined && !(Number(pl.lineLengthM) >= 20)) errors.push(`mark ${mk.id}: placement line length must be at least 20 m`);
      } else if (!ll && !ne) errors.push(`mark ${mk.id}: position must be {lat, lon} or {n, e}`);
    });
  }
  const ref = (id: unknown, where: string) => {
    if (typeof id !== 'string' || !ids.has(id)) errors.push(`${where}: unknown mark "${String(id)}"`);
  };
  const line = (l: unknown, where: string) => {
    const ends = (l as { ends?: unknown[] } | undefined)?.ends;
    if (!Array.isArray(ends) || ends.length !== 2) return errors.push(`${where}: "ends" must name two marks`);
    ref(ends[0], where);
    ref(ends[1], where);
    if (ends[0] === ends[1]) errors.push(`${where}: both ends are the same mark`);
  };
  line(o.start, 'start');
  line(o.finish, 'finish');
  const legs = o.legs as unknown[];
  if (!Array.isArray(legs) || legs.length === 0) errors.push('"legs" must be a non-empty array');
  else {
    legs.forEach((l, i) => {
      const lg = l as Record<string, unknown>;
      if (lg?.type === 'mark') {
        ref(lg.mark, `legs[${i}]`);
        if (lg.rounding !== 'port' && lg.rounding !== 'starboard') errors.push(`legs[${i}]: rounding must be port or starboard`);
      } else if (lg?.type === 'gate') {
        const m = lg.marks as unknown[];
        if (!Array.isArray(m) || m.length !== 2) errors.push(`legs[${i}]: a gate needs two marks`);
        else {
          ref(m[0], `legs[${i}]`);
          ref(m[1], `legs[${i}]`);
          if (m[0] === m[1]) errors.push(`legs[${i}]: gate marks must differ`);
        }
      } else errors.push(`legs[${i}]: type must be "mark" or "gate"`);
    });
  }
  if (!Number.isInteger(o.laps) || (o.laps as number) < 1 || (o.laps as number) > 20) errors.push('"laps" must be an integer from 1 to 20');
  if (o.boundaries !== undefined) {
    if (!Array.isArray(o.boundaries)) errors.push('"boundaries" must be an array');
    else o.boundaries.forEach((b, i) => line(b, `boundaries[${i}]`));
  }
  if (o.designWindFromDeg !== undefined && !Number.isFinite(o.designWindFromDeg)) errors.push('"designWindFromDeg" must be a number');
  if (Array.isArray(marks)) {
    for (const m of marks as Record<string, unknown>[]) {
      const pl = m?.placement as { odm?: unknown } | undefined;
      if (pl && typeof pl.odm === 'string' && !ids.has(pl.odm)) errors.push(`mark ${String(m.id)}: placement ODM "${pl.odm}" is not a mark of the course`);
      if (pl && pl.odm === m.id) errors.push(`mark ${String(m.id)}: a committee boat cannot be her own ODM`);
    }
  }
  if (errors.length) return { errors };
  // A committee boat placed on the day lies, until a race places her, as she would for the design wind.
  const course = o as unknown as Course;
  // (Only when she has no position yet: a race's own placement, re-parsed by the validator, is kept.)
  return { course: course.marks.some((m) => m.placement && !m.position) ? placeCommitteeBoats(course, { windFromDeg: course.designWindFromDeg ?? 0, onlyMissing: true }) : course, errors };
}

/**
 * Place the committee boats a club course leaves to the race officer (`placement`): on a line square to the
 * wind through the outer distance mark, `lineLengthM` away (the placement's, else `o.lineLengthM`, else
 * 150 m), on whichever side has the deeper water (`depthAt`, m), else the side to the right looking downwind.
 * THE SIMULATOR'S CHOICE (E): the sailing instructions leave where the boat anchors to the race officer.
 */
export function placeCommitteeBoats(course: Course, o: { windFromDeg: number; lineLengthM?: number; depthAt?: (n: number, e: number) => number; onlyMissing?: boolean }, proj: LocalProjection = DART_PROJECTION): Course {
  if (!course.marks.some((m) => m.placement)) return course;
  const marks = course.marks.map((m) => {
    if (!m.placement || (o.onlyMissing && m.position)) return m;
    const odm = course.marks.find((x) => x.id === m.placement!.odm);
    if (!odm || odm.placement) return m;
    const p = markPosition(odm.position, proj);
    const L = m.placement.lineLengthM ?? o.lineLengthM ?? 150;
    const w = (o.windFromDeg * Math.PI) / 180;
    const cands = [w - Math.PI / 2, w + Math.PI / 2].map((a) => ({ n: p.n + L * Math.cos(a), e: p.e + L * Math.sin(a) }));
    const best = o.depthAt ? (o.depthAt(cands[1]!.n, cands[1]!.e) > o.depthAt(cands[0]!.n, cands[0]!.e) ? cands[1]! : cands[0]!) : cands[0]!;
    return { ...m, position: { n: Math.round(best.n * 10) / 10, e: Math.round(best.e * 10) / 10 } };
  });
  return { ...course, marks };
}

/** One leg of the expanded course (all laps), with the geometry the judge needs. */
export interface ResolvedLeg {
  index: number;
  lap: number;
  leg: CourseLeg;
  /** Mark legs: the mark; gate legs: the two gate marks. */
  points: LocalPoint[];
  rounding?: Rounding;
  /** Where the leg goes: the mark, or the middle of the gate. */
  target: LocalPoint;
  /** Previous and next reference points (marks, gate middles, start or finish line middles). */
  prev: LocalPoint;
  next: LocalPoint;
  label: string;
}

export interface ResolvedCourse {
  course: Course;
  pos: Map<string, LocalPoint>;
  start: [LocalPoint, LocalPoint];
  finish: [LocalPoint, LocalPoint];
  boundaries: { a: LocalPoint; b: LocalPoint; label: string }[];
  legs: ResolvedLeg[];
}

export function markPosition(p: Course['marks'][number]['position'], proj: LocalProjection): LocalPoint {
  return 'n' in p ? { n: p.n, e: p.e } : proj.toLocal(p.lat, p.lon);
}

const SIDE = { port: 'to port', starboard: 'to starboard' } as const;

export function resolveCourse(course: Course, proj: LocalProjection): ResolvedCourse {
  const pos = new Map(course.marks.map((m) => [m.id, markPosition(m.position, proj)]));
  const names = new Map(course.marks.map((m) => [m.id, m.name]));
  const P = (id: string) => {
    const p = pos.get(id);
    if (!p) throw new Error(`unknown mark ${id}`);
    return p;
  };
  const start: [LocalPoint, LocalPoint] = [P(course.start.ends[0]), P(course.start.ends[1])];
  const finish: [LocalPoint, LocalPoint] = [P(course.finish.ends[0]), P(course.finish.ends[1])];
  const raw: Omit<ResolvedLeg, 'prev' | 'next'>[] = [];
  for (let lap = 1; lap <= course.laps; lap++) {
    for (const leg of course.legs) {
      if (leg.type === 'mark') {
        const p = P(leg.mark);
        raw.push({ index: raw.length, lap, leg, points: [p], rounding: leg.rounding, target: p, label: `${names.get(leg.mark)} ${SIDE[leg.rounding]}` });
      } else {
        const a = P(leg.marks[0]);
        const b = P(leg.marks[1]);
        raw.push({ index: raw.length, lap, leg, points: [a, b], target: midpoint(a, b), label: `Gate ${names.get(leg.marks[0])}–${names.get(leg.marks[1])}` });
      }
    }
  }
  const startMid = midpoint(...start);
  const finishMid = midpoint(...finish);
  const legs: ResolvedLeg[] = raw.map((l, i) => ({
    ...l,
    prev: i === 0 ? startMid : raw[i - 1]!.target,
    next: i === raw.length - 1 ? finishMid : raw[i + 1]!.target,
  }));
  const boundaries = (course.boundaries ?? []).map((b, i) => ({ a: P(b.ends[0]), b: P(b.ends[1]), label: b.label ?? `Boundary ${i + 1}` }));
  return { course, pos, start, finish, boundaries, legs };
}
