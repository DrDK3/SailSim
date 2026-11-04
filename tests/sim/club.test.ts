import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadDartGeo } from './helpers';
import { CLUB_MARKS, clubMarkLocal, withClubMarks } from '../../src/sim/course/clubMarks';
import { markPosition, parseCourse, placeCommitteeBoats } from '../../src/sim/course/course';
import { DART_PROJECTION } from '../../src/sim/geo/projection';
import { createRace } from '../../src/sim/race/setup';
import { clubCourseForWind } from '../../src/app/quickRace';
import type { LibraryEntry } from '../../src/app/courseLibrary';
import type { Course } from '../../src/sim/course/types';
import type { FeatureMark } from '../../src/sim/course/clubMarks';
import type { RaceFeatures } from '../../src/sim/race/setup';

/**
 * The owner's club documents (3 Nov 2026, docs/CLUB_DOCUMENTS.md): the RDYC marks and courses from the
 * Sailing Programme 2026 Course Appendix, entered as pending-check club courses.
 */
const features: RaceFeatures & { marks: FeatureMark[]; marksNotPlaced: { name: string }[] } = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8'));
const dir = new URL('../../data/courses/club/', import.meta.url);
const courses: Course[] = readdirSync(dir).filter((f) => f.endsWith('.course.json')).map((f) => {
  const p = parseCourse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  if (!p.course) throw new Error(`${f}: ${p.errors.join('; ')}`);
  return p.course;
});
/** Course lengths as the course appendix states them (NM). */
const STATED_NM: Record<string, number> = { b1: 4.3, b5: 5.1, b6: 4.9, c1: 4.2, c2: 4.4, c3: 4.0, c4: 3.7, c8: 3.7 };

describe('the RDYC marks', () => {
  it('Castle Ledge from the club document is where the geodata already had it, from another source', () => {
    const l = clubMarkLocal('L')!;
    const geo = features.marks.find((m) => m.name === 'Castle Ledge')!;
    expect(Math.hypot(l.n - geo.n, l.e - geo.e)).toBeLessThan(2);
  });

  it('are added to the harbour marks, the club marks are no longer "not placed", and marks outside the area are left out', () => {
    const geo = loadDartGeo();
    const f = withClubMarks(features, (n, e) => geo.inDomain(n, e));
    const names = f.marks.map((m) => m.name);
    for (const n of ['Homestone', 'Checkstone', 'Mewstone', 'West Rock', 'RDYC 1', 'RDYC 4']) expect(names).toContain(n);
    expect(names.filter((n) => n === 'Castle Ledge')).toHaveLength(1);
    expect(names).not.toContain('Skerries'); // 8 km south, beyond the simulator's area
    expect(f.marksNotPlaced.map((m) => m.name)).not.toContain('Homestone');
    expect(f.marksNotPlaced.some((m) => /RDYC racing marks/.test(m.name))).toBe(false);
    // Every placed club mark is in water.
    for (const m of f.marks.filter((x) => x.id)) expect(geo.bedElevation(m.n, m.e)).toBeLessThan(-1);
    expect(CLUB_MARKS.find((m) => m.id === 'H')!.light).toBe('Q R');
  });
});

describe('the RDYC courses (pending check)', () => {
  it('are club-document courses awaiting a check, each with its source', () => {
    expect(courses.length).toBe(8);
    for (const c of courses) {
      expect(c.status).toBe('pending-check');
      expect(c.provenance.kind).toBe('club-document');
      expect(c.provenance.document).toMatch(/Sailing Programme 2026/);
      expect(c.provenance.checkedBy).toBeUndefined();
    }
  });

  it('measure what the course appendix says, from the club\'s mark positions (within 0.15 NM)', () => {
    for (const c of courses) {
      const id = c.id.replace('rdyc-2026-', '');
      const pos = (m: string) => markPosition(c.marks.find((x) => x.id === m)!.position, DART_PROJECTION);
      const seq = [c.start.ends[1], ...c.legs.map((l) => (l.type === 'mark' ? l.mark : '')), c.finish.ends[1]].map(pos);
      let m = 0;
      for (let i = 1; i < seq.length; i++) m += Math.hypot(seq[i]!.n - seq[i - 1]!.n, seq[i]!.e - seq[i - 1]!.e);
      expect(Math.abs(m / 1852 - STATED_NM[id]!)).toBeLessThan(0.15);
    }
  });

  it('place the committee boat square to the wind at the outer distance mark, on the deeper side', () => {
    const b1 = courses.find((c) => c.id === 'rdyc-2026-b1')!;
    const deep = (n: number, e: number) => e; // deeper to the east, for the test
    const placed = placeCommitteeBoats(b1, { windFromDeg: 0, lineLengthM: 120, depthAt: deep });
    const cb = markPosition(placed.marks.find((m) => m.id === 'CB')!.position, DART_PROJECTION);
    const l = clubMarkLocal('L')!;
    expect(Math.hypot(cb.n - l.n, cb.e - l.e)).toBeCloseTo(120, 0);
    expect(cb.n - l.n).toBeCloseTo(0, 0); // square to a north wind
    expect(cb.e).toBeGreaterThan(l.e); // the deeper side
  });

  it('every course builds a race on the River Dart data in its design wind, and the boats start', () => {
    const geo = loadDartGeo();
    for (const c of courses) {
      const { session } = createRace({ conditions: { startTime: '2026-07-15T17:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: c.designWindFromDeg! }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } }, geo, features, course: c, aiCount: 3, level: 'good', seed: 2, committee: { startAt: 60, sequence: 'one-minute' } });
      const cb = session.course.pos.get('CB')!;
      expect(geo.bedElevation(cb.n, cb.e)).toBeLessThan(-5);
      while (session.time < 150) session.step();
      expect(session.fleet.boats.every((b) => Number.isFinite(b.sim.state.n))).toBe(true);
    }
  }, 120_000);

  it('the course for the wind: Group B in a breeze, Group C in light airs, the nearest direction', () => {
    const lib: LibraryEntry[] = courses.map((c) => ({ id: c.id, name: c.name, group: 'club', status: c.status, course: c }));
    expect(clubCourseForWind(225, 12, lib)!.id).toBe('rdyc-2026-b1');
    expect(clubCourseForWind(225, 5, lib)!.id).toBe('rdyc-2026-c1');
    expect(clubCourseForWind(90, 12, lib)!.id).toBe('rdyc-2026-c4'); // no B course for an easterly is entered
    expect(clubCourseForWind(10, 12, lib)!.id).toBe('rdyc-2026-b6');
  });
});
