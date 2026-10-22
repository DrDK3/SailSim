import type { Seabed } from '../geo/dart';
import type { LocalProjection } from '../geo/projection';
import { parseCourse, resolveCourse, type ResolvedCourse } from './course';
import { angleTo, cross, dist, pointInPolygon, polylineDistance, segmentPolylineDistance, segmentTouchesPolygon } from './geometry';
import type { Restrictions } from './restrictions';
import type { LocalPoint } from './types';

export interface CourseIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** What the issue is about, for highlighting in the editor. */
  mark?: string;
  leg?: number;
  line?: 'start' | 'finish' | 'boundary';
}

export interface ValidationContext {
  projection: LocalProjection;
  seabed?: Seabed;
  inDomain?: (n: number, e: number) => boolean;
  restrictions?: Restrictions;
  /** Boat draft (m). */
  draft: number;
  /** Ground above this level (m ODN) is land at any tide (about mean high water springs, E). */
  landLevelOdn: number;
  /** Mid-tide water level (m ODN). */
  meanLevelOdn: number;
  /** Low water springs, approximated by chart datum (m ODN). */
  lowWaterOdn: number;
}

export interface CourseValidation {
  ok: boolean;
  issues: CourseIssue[];
  resolved?: ResolvedCourse;
}

/** Defaults for the River Dart (E): land above +2.3 m ODN (≈ MHWS), mid-tide +0.1 m ODN, low water = CD. */
export const DART_LEVELS = { landLevelOdn: 2.3, meanLevelOdn: 0.1 };

const SAMPLE_M = 4;
const MIN_LINE_M = 20;
const SHORT_LEG_M = 40;

/**
 * Validate a course: structure, references, status and provenance, geometry, water (not land, deep enough) and
 * restrictions (ferry corridors, mooring areas). Errors make a course unusable; warnings are shown to the user.
 */
export function validateCourse(json: unknown, ctx: ValidationContext): CourseValidation {
  const parsed = parseCourse(json);
  if (!parsed.course) return { ok: false, issues: parsed.errors.map((m) => ({ severity: 'error', code: 'schema', message: m })) };
  const course = parsed.course;
  const issues: CourseIssue[] = [];
  const err = (code: string, message: string, at: Partial<CourseIssue> = {}) => issues.push({ severity: 'error', code, message, ...at });
  const warn = (code: string, message: string, at: Partial<CourseIssue> = {}) => issues.push({ severity: 'warning', code, message, ...at });

  // ---- status and provenance
  const p = course.provenance;
  if (course.status === 'simulated' && p.kind === 'club-document') err('status', 'A course entered from a club document cannot be "simulated": use pending-check or verified.');
  if (course.status !== 'simulated' && p.kind !== 'club-document') err('status', `Status "${course.status}" is only for courses entered from a club document.`);
  if (p.kind === 'club-document' && !p.document) err('provenance', 'A club course must name its source document (title, edition, date).');
  if (course.status === 'verified' && (!p.checkedBy || !p.checkedOn)) err('provenance', 'A verified course needs the name of the checker and the date of the check.');

  const r = resolveCourse(course, ctx.projection);
  const name = (id: string) => course.marks.find((m) => m.id === id)?.name ?? id;

  // ---- geometry
  const lineCheck = (ends: [LocalPoint, LocalPoint], which: 'start' | 'finish') => {
    const len = dist(ends[0], ends[1]);
    if (len < MIN_LINE_M) err('line-short', `The ${which} line is ${len.toFixed(0)} m long (minimum ${MIN_LINE_M} m).`, { line: which });
  };
  lineCheck(r.start, 'start');
  lineCheck(r.finish, 'finish');
  const first = r.legs[0]!;
  if (Math.abs(cross(r.start[0], r.start[1], first.target)) / Math.max(dist(r.start[0], r.start[1]), 1e-9) < 5) {
    err('start-direction', 'The first mark is on (or within 5 m of) the line through the start: the course side is undefined.', { line: 'start' });
  }
  const last = r.legs[r.legs.length - 1]!;
  if (Math.abs(cross(r.finish[0], r.finish[1], last.target)) / Math.max(dist(r.finish[0], r.finish[1]), 1e-9) < 5) {
    err('finish-direction', 'The last mark is on (or within 5 m of) the line through the finish: the finishing direction is undefined.', { line: 'finish' });
  }
  // Legs in one lap (the geometry repeats).
  const lapLegs = r.legs.filter((l) => l.lap === 1);
  const segments: { a: LocalPoint; b: LocalPoint; leg: number; label: string }[] = [];
  segments.push({ a: { n: (r.start[0].n + r.start[1].n) / 2, e: (r.start[0].e + r.start[1].e) / 2 }, b: first.target, leg: 0, label: `start to ${first.label}` });
  for (let i = 1; i < lapLegs.length; i++) segments.push({ a: lapLegs[i - 1]!.target, b: lapLegs[i]!.target, leg: i, label: `${lapLegs[i - 1]!.label} to ${lapLegs[i]!.label}` });
  if (course.laps > 1) segments.push({ a: lapLegs[lapLegs.length - 1]!.target, b: lapLegs[0]!.target, leg: 0, label: `${lapLegs[lapLegs.length - 1]!.label} to ${lapLegs[0]!.label} (next lap)` });
  segments.push({ a: last.target, b: { n: (r.finish[0].n + r.finish[1].n) / 2, e: (r.finish[0].e + r.finish[1].e) / 2 }, leg: r.legs.length, label: `${last.label} to the finish` });
  for (const s of segments) {
    const len = dist(s.a, s.b);
    if (len < 1) err('leg-zero', `Leg ${s.label} has no length (the same point twice).`, { leg: s.leg });
    else if (len < SHORT_LEG_M) warn('leg-short', `Leg ${s.label} is only ${len.toFixed(0)} m.`, { leg: s.leg });
  }
  // A mark left to port is normally a left turn (and to starboard a right turn). Otherwise boats pass the mark
  // without going round it: legal, but often a mistake in entering the course.
  for (const l of lapLegs) {
    if (l.leg.type !== 'mark') continue;
    const alpha = (((angleTo(l.target, l.next) - angleTo(l.target, l.prev)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const doublesBack = alpha < 0.1 || alpha > 2 * Math.PI - 0.1; // windward–leeward: either side is a rounding
    const turnsLeft = alpha > Math.PI;
    if (!doublesBack && (l.rounding === 'port') !== turnsLeft && Math.abs(alpha - Math.PI) > 0.1) {
      warn('rounding-side', `${l.label}: the course turns ${turnsLeft ? 'left' : 'right'} there, so boats pass the mark rather than round it. Check the rounding side.`, { leg: l.index });
    }
  }
  course.legs.forEach((l, i) => {
    if (l.type === 'gate') {
      const w = dist(r.pos.get(l.marks[0])!, r.pos.get(l.marks[1])!);
      if (w < 15) warn('gate-narrow', `Gate ${name(l.marks[0])}–${name(l.marks[1])} is only ${w.toFixed(0)} m wide.`, { leg: i });
    }
  });

  // ---- water: marks, legs and lines must be in water deep enough for the boat
  if (ctx.seabed) {
    const sb = ctx.seabed;
    const outside = (q: LocalPoint) => ctx.inDomain && !ctx.inDomain(q.n, q.e);
    for (const m of course.marks) {
      const q = r.pos.get(m.id)!;
      if (outside(q)) {
        warn('outside-data', `Mark ${m.name} is outside the River Dart data: land and depth not checked.`, { mark: m.id });
        continue;
      }
      const bed = sb.bedElevation(q.n, q.e);
      if (bed > ctx.landLevelOdn) err('mark-on-land', `Mark ${m.name} is on land.`, { mark: m.id });
      else if (ctx.meanLevelOdn - bed < ctx.draft) err('mark-shallow', `Mark ${m.name} is in ${(ctx.meanLevelOdn - bed).toFixed(1)} m at mid-tide: too shallow for a Squib (draft ${ctx.draft} m).`, { mark: m.id });
      else if (ctx.lowWaterOdn - bed < ctx.draft + 0.3) warn('mark-dries', `Mark ${m.name} has ${(ctx.lowWaterOdn - bed).toFixed(1)} m at low water springs (chart datum): too shallow near low water.`, { mark: m.id });
    }
    const sample = (a: LocalPoint, b: LocalPoint, f: (q: LocalPoint) => boolean) => {
      const n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_M));
      for (let k = 0; k <= n; k++) {
        const q = { n: a.n + ((b.n - a.n) * k) / n, e: a.e + ((b.e - a.e) * k) / n };
        if (!outside(q) && f(q)) return true;
      }
      return false;
    };
    const land = (q: LocalPoint) => sb.bedElevation(q.n, q.e) > ctx.landLevelOdn;
    const shallow = (q: LocalPoint) => ctx.meanLevelOdn - sb.bedElevation(q.n, q.e) < ctx.draft;
    for (const s of segments) {
      if (sample(s.a, s.b, land)) err('leg-land', `Leg ${s.label} crosses land.`, { leg: s.leg });
      else if (sample(s.a, s.b, shallow)) warn('leg-shallow', `Leg ${s.label} crosses water shallower than the draft at mid-tide.`, { leg: s.leg });
    }
    const lines: [string, LocalPoint, LocalPoint, 'start' | 'finish' | 'boundary'][] = [
      ['start line', r.start[0], r.start[1], 'start'],
      ['finish line', r.finish[0], r.finish[1], 'finish'],
      ...r.boundaries.map((b) => [b.label, b.a, b.b, 'boundary'] as [string, LocalPoint, LocalPoint, 'boundary']),
    ];
    for (const [label, a, b, which] of lines) {
      if (sample(a, b, land)) err('line-land', `The ${label} crosses land.`, { line: which });
      else if (which !== 'boundary' && sample(a, b, shallow)) warn('line-shallow', `Part of the ${label} is shallower than the draft at mid-tide.`, { line: which });
    }
  }

  // ---- restrictions
  const rs = ctx.restrictions;
  if (rs) {
    for (const f of rs.ferries) {
      for (const m of course.marks) {
        const q = r.pos.get(m.id)!;
        const d = polylineDistance(q, f.route);
        if (d < f.halfWidth) err('mark-ferry', `Mark ${m.name} is ${d.toFixed(0)} m from the ${f.name} track (keep marks at least ${f.halfWidth} m away).`, { mark: m.id });
      }
      for (const [label, a, b, which] of [['start line', r.start[0], r.start[1], 'start'], ['finish line', r.finish[0], r.finish[1], 'finish']] as const) {
        if (segmentPolylineDistance(a, b, f.route) < f.halfWidth) err('line-ferry', `The ${label} is within ${f.halfWidth} m of the ${f.name} track.`, { line: which });
      }
      for (const s of segments) {
        if (segmentPolylineDistance(s.a, s.b, f.route) < 1) {
          warn('leg-ferry', `Leg ${s.label} crosses the ${f.name} track${f.ram ? ' (the ferry is restricted in her ability to manoeuvre: keep clear)' : ''}.`, { leg: s.leg });
        }
      }
    }
    for (const a of rs.moorings) {
      for (const m of course.marks) {
        if (pointInPolygon(r.pos.get(m.id)!, a.ring)) err('mark-moorings', `Mark ${m.name} is inside ${a.name}.`, { mark: m.id });
      }
      for (const [label, p0, p1, which] of [['start line', r.start[0], r.start[1], 'start'], ['finish line', r.finish[0], r.finish[1], 'finish']] as const) {
        if (segmentTouchesPolygon(p0, p1, a.ring)) err('line-moorings', `The ${label} runs through ${a.name}.`, { line: which });
      }
      for (const s of segments) if (segmentTouchesPolygon(s.a, s.b, a.ring)) warn('leg-moorings', `Leg ${s.label} passes through ${a.name}.`, { leg: s.leg });
    }
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues, resolved: r };
}
