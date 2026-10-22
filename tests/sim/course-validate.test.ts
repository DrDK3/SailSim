/**
 * Phase 4: course validation (schema, status and provenance, geometry, land and depth on the River Dart data,
 * ferry and mooring restrictions) and the simulated practice courses.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DART_LEVELS,
  DART_PROJECTION,
  PRACTICE_KINDS,
  buildRestrictions,
  parseCourse,
  practiceCourse,
  validateCourse,
  type Course,
  type ValidationContext,
} from '../../src/sim/index';
import { loadDartGeo } from './helpers';

const geo = loadDartGeo();
const features = JSON.parse(readFileSync('public/geo/features.json', 'utf8'));
const ctx: ValidationContext = {
  projection: DART_PROJECTION, seabed: geo, inDomain: (n, e) => geo.inDomain(n, e), restrictions: buildRestrictions(features),
  draft: 0.99, ...DART_LEVELS, lowWaterOdn: -geo.cdBelowOdn,
};
const river = JSON.parse(readFileSync('data/courses/simulated/river-range-sausage.course.json', 'utf8')) as Course;
const codes = (c: unknown, sev?: 'error' | 'warning') => validateCourse(c, ctx).issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
const withMarks = (c: Course, moves: Record<string, { n: number; e: number }>): Course => ({
  ...c, marks: c.marks.map((m) => (moves[m.id] ? { ...m, position: moves[m.id]! } : m)),
});

describe('practice courses (simulated)', () => {
  it('every kind is valid in Start Bay whatever the wind direction', () => {
    for (const k of PRACTICE_KINDS) {
      for (let wind = 0; wind < 360; wind += 45) {
        const c = practiceCourse({ kind: k.kind, centre: { n: -3500, e: 1200 }, windFromDeg: wind });
        const v = validateCourse(c, ctx);
        expect(v.issues.filter((i) => i.severity === 'error'), `${k.kind} wind ${wind}`).toEqual([]);
        expect(c.status).toBe('simulated');
        expect(c.name).toContain('(simulated)');
      }
    }
  });

  it('the windward mark is upwind of the start, and roundings match the turns', () => {
    const c = practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: 0 }, windFromDeg: 90, legM: 500 });
    const w = c.marks.find((m) => m.id === 'W')!.position as { n: number; e: number };
    expect(w.e).toBeCloseTo(500, 0); // wind from the east: windward mark 500 m east
    expect(Math.abs(w.n)).toBeLessThan(0.2);
    const slalom = practiceCourse({ kind: 'gybing-slalom', centre: { n: 0, e: 0 }, windFromDeg: 0 });
    const sides = slalom.legs.map((l) => (l.type === 'mark' ? l.rounding : 'gate'));
    expect(sides).toEqual(['port', 'starboard', 'port', 'starboard', 'port'].map((s, i) => (sides[0] === 'port' ? s : i % 2 ? 'port' : 'starboard')));
    expect(new Set(sides).size).toBe(2);
  });

  it('a practice course laid where there is no room is rejected (crosses land)', () => {
    // Centred off RDYC with the wind across the river: the windward mark would be on Kingswear.
    expect(codes(practiceCourse({ kind: 'windward-leeward', centre: { n: 0, e: -150 }, windFromDeg: 90 }), 'error')).toContain('mark-on-land');
  });
});

describe('course validator', () => {
  it('accepts the simulated river course with no issues', () => {
    expect(validateCourse(river, ctx)).toMatchObject({ ok: true, issues: [] });
  });

  it('rejects broken documents with a list of problems', () => {
    expect(parseCourse({}).errors.length).toBeGreaterThan(3);
    const bad = { ...river, marks: [...river.marks, river.marks[0]], legs: [{ type: 'mark', mark: 'X', rounding: 'left' }] };
    const e = parseCourse(bad).errors.join(' | ');
    expect(e).toContain('duplicate id "S1"');
    expect(e).toContain('unknown mark "X"');
    expect(e).toContain('rounding must be port or starboard');
  });

  it('rejects marks on land and in water too shallow for a Squib', () => {
    expect(codes(withMarks(river, { T: { n: 0, e: 0 } }), 'error')).toContain('mark-on-land'); // RDYC clubhouse
    expect(codes(withMarks(river, { T: { n: 1380, e: -470 } }), 'error')).toContain('mark-shallow'); // mud on the west bank
  });

  it('rejects legs and lines that cross land', () => {
    // From the Range to Start Bay in a straight line: across Kingswear.
    const c = withMarks(river, { T: { n: -1800, e: 1300 } });
    expect(codes(c, 'error')).toContain('leg-land');
  });

  it('enforces the ferry and mooring restrictions', () => {
    // Start line across the Lower Ferry track off RDYC; a mark in Kingswear Trots; a leg across the Higher Ferry.
    const lower = withMarks(river, { S1: { n: 70, e: -200 }, S2: { n: 70, e: -110 }, B: { n: 300, e: -180 } });
    expect(codes(lower, 'error')).toContain('line-ferry');
    const trots = withMarks(river, { B: { n: 900, e: 60 } });
    expect(codes(trots, 'error')).toContain('mark-moorings');
    const across = withMarks(river, { B: { n: 700, e: -120 } });
    expect(codes(across, 'warning')).toContain('leg-ferry');
  });

  it('enforces the status rules for club courses', () => {
    const club = (status: Course['status'], prov: Course['provenance']) => codes({ ...river, status, provenance: prov }, 'error');
    expect(club('verified', { kind: 'club-document', document: 'RDYC SIs 2026, Appendix B' })).toContain('provenance'); // no checker
    expect(club('verified', { kind: 'club-document', document: 'RDYC SIs 2026, Appendix B', checkedBy: 'A. Checker', checkedOn: '2027-03-01' })).toEqual([]);
    expect(club('pending-check', { kind: 'club-document', document: 'RDYC SIs 2026, Appendix B' })).toEqual([]);
    expect(club('pending-check', { kind: 'club-document' })).toContain('provenance'); // no document named
    expect(club('simulated', { kind: 'club-document', document: 'x' })).toContain('status');
    expect(club('verified', { kind: 'simulated' })).toContain('status');
  });

  it('warns when a rounding side contradicts the turn (boats would pass the mark, not round it)', () => {
    const c: Course = { ...river, laps: 1, legs: [{ type: 'mark', mark: 'T', rounding: 'port' }, { type: 'mark', mark: 'B', rounding: 'port' }] };
    const right = withMarks(c, { B: { n: 1500, e: -250 } }); // T then B to the south-east: B is a right turn
    expect(codes(right, 'warning')).toContain('rounding-side');
  });
});
