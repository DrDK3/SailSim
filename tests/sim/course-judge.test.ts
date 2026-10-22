/**
 * Phase 4: the course judge. Criterion 9 (rounding order and direction on synthetic tracks) and criterion 10
 * (start and finish: repeatable, interpolation error ≤ 1 ms, OCS when any hull reference point is over).
 */
import { describe, expect, it } from 'vitest';
import {
  CourseJudge,
  DART_PROJECTION,
  DEG,
  Simulation,
  autopilotHelm,
  buildConditions,
  hullReferencePoints,
  resolveCourse,
  squibParams,
  startSequence,
  type BoatPose,
  type Course,
  type RaceEvent,
} from '../../src/sim/index';

const DT = 0.01;
const HULL = hullReferencePoints(5.79, 1.867);
type P = [number, number]; // (n, e)

/** Start line e −50…+50 at n = 0 (course side north); A windward to port; B wing to port; finish = start line. */
const TRIANGLE: Course = {
  schema: 'squib-course/1',
  id: 'fixture-triangle',
  name: 'Fixture triangle',
  status: 'simulated',
  provenance: { kind: 'simulated', notes: 'test fixture' },
  marks: [
    { id: 'S1', name: 'Pin', kind: 'pin', position: { n: 0, e: -50 } },
    { id: 'S2', name: 'Committee', kind: 'committee-boat', position: { n: 0, e: 50 } },
    { id: 'A', name: 'A', kind: 'inflatable', position: { n: 600, e: 0 } },
    { id: 'B', name: 'B', kind: 'inflatable', position: { n: 300, e: -400 } },
  ],
  start: { ends: ['S1', 'S2'] },
  legs: [
    { type: 'mark', mark: 'A', rounding: 'port' },
    { type: 'mark', mark: 'B', rounding: 'port' },
  ],
  laps: 1,
  finish: { ends: ['S1', 'S2'] },
};

/** Points along a circle round (n, e) from angle a0 to a1 (math angles in degrees: 0 = east, CCW positive). */
function arc(c: P, r: number, a0: number, a1: number): P[] {
  const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 3));
  return Array.from({ length: k + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / k) * DEG;
    return [c[0] + r * Math.sin(a), c[1] + r * Math.cos(a)] as P;
  });
}

/** Poses at 10 ms intervals moving along the polyline at constant speed, heading along the path. */
function poses(path: P[], speed = 3): BoatPose[] {
  const out: BoatPose[] = [];
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [n0, e0] = path[i]!;
    const [n1, e1] = path[i + 1]!;
    const len = Math.hypot(n1 - n0, e1 - e0);
    const hdg = Math.atan2(e1 - e0, n1 - n0);
    let s = carry;
    while (s < len) {
      out.push({ n: n0 + ((n1 - n0) * s) / len, e: e0 + ((e1 - e0) * s) / len, heading: hdg });
      s += speed * DT;
    }
    carry = s - len;
  }
  return out;
}

function judgeTrack(course: Course, path: P[], signalAt = 5): { events: RaceEvent[]; judge: CourseJudge } {
  const judge = new CourseJudge(resolveCourse(course, DART_PROJECTION), HULL, startSequence(signalAt, 'one-minute'));
  poses(path).forEach((p, i) => judge.update(i * DT, p));
  return { events: judge.events, judge };
}

const types = (ev: RaceEvent[]) => ev.filter((e) => e.type !== 'signal').map((e) => ('label' in e ? `${e.type}:${e.label.split(' ')[0]}` : e.type));

// Building blocks: below the line → over it; round A or B either way; go to the finish.
const START: P[] = [[-40, 0], [10, 0]];
const A: P = [600, 0];
const B: P = [300, -400];
const roundA_ccw: P[] = [[560, 30], ...arc(A, 30, -40, 215)];
const roundA_cw: P[] = [[560, -30], ...arc(A, 30, 220, -35)];
const roundB_ccw: P[] = [[330, -370], ...arc(B, 30, 40, 320)];
const FINISH: P[] = [[30, -20], [-30, -10]];

describe('Criterion 9: rounding order and direction (synthetic tracks)', () => {
  it('correct course: started, A to port, B to port, finished', () => {
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...roundA_ccw, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'rounded:A', 'rounded:B', 'finish']);
    expect(judge.phase).toBe('finished');
  });

  it('wrong side: A rounded clockwise is reported and does not count; B is out of order; the finish is refused', () => {
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...roundA_cw, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'wrong-side:A', 'out-of-order:B', 'finish-incomplete']);
    expect(judge.phase).toBe('racing');
    expect(judge.legIndex).toBe(0);
  });

  it('skipped mark: straight from the start to B (A never rounded, no false wrong-side warning)', () => {
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'out-of-order:B', 'finish-incomplete']);
    expect(judge.legIndex).toBe(0);
  });

  it('wrong order: B then A: A counts, B is still to do, the finish is refused', () => {
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...roundB_ccw, [400, 100], ...roundA_ccw, [100, 200], ...FINISH]);
    expect(types(events)).toEqual(['start', 'out-of-order:B', 'rounded:A', 'finish-incomplete']);
    expect(judge.legIndex).toBe(1);
  });

  it('unwinding loop: round A the wrong way, unwind, then round it correctly: counts', () => {
    // Clockwise round A (wrong), back the same way, then anticlockwise all the way round (right).
    const unwind: P[] = [...roundA_cw, ...arc(A, 30, -35, 220), ...arc(A, 30, 220, 575)];
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...unwind, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'wrong-side:A', 'rounded:A', 'rounded:B', 'finish']);
    expect(judge.phase).toBe('finished');
  });

  it('extra loop: an extra full turn round A is reported but the rounding stands', () => {
    const loop: P[] = [[560, 30], ...arc(A, 30, -40, 215 + 360)];
    const { events, judge } = judgeTrack(TRIANGLE, [...START, ...loop, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'rounded:A', 'extra-loop:A', 'rounded:B', 'finish']);
    expect(judge.phase).toBe('finished');
  });

  it('going back round after a rounding undoes it; rounding again counts', () => {
    const back: P[] = [[560, 30], ...arc(A, 30, -40, 200), ...arc(A, 30, 200, -130), ...arc(A, 30, -130, 215)];
    const { events } = judgeTrack(TRIANGLE, [...START, ...back, ...roundB_ccw, ...FINISH]);
    expect(types(events)).toEqual(['start', 'rounded:A', 'rounding-undone:A', 'rounded:A', 'rounded:B', 'finish']);
  });

  it('gates and boundaries: through the gate from the right side; crossing a boundary is reported', () => {
    const course: Course = {
      ...TRIANGLE,
      id: 'fixture-gate',
      marks: [...TRIANGLE.marks, { id: 'G1', name: 'G1', kind: 'inflatable', position: { n: 300, e: -20 } }, { id: 'G2', name: 'G2', kind: 'inflatable', position: { n: 300, e: 20 } },
        { id: 'L1', name: 'L1', kind: 'virtual', position: { n: 50, e: 60 } }, { id: 'L2', name: 'L2', kind: 'virtual', position: { n: 250, e: 60 } }],
      legs: [{ type: 'mark', mark: 'A', rounding: 'port' }, { type: 'gate', marks: ['G1', 'G2'] }],
      boundaries: [{ ends: ['L1', 'L2'], label: 'Lane east side' }],
    };
    // Up to A crossing the east boundary, round A, down through the gate, finish.
    const path: P[] = [...START, [100, 0], [150, 80], [200, 30], ...roundA_ccw, [320, 0], [280, 0], [100, -10], ...FINISH];
    const { events, judge } = judgeTrack(course, path);
    expect(types(events)).toEqual(['start', 'boundary:Lane', 'boundary:Lane', 'rounded:A', 'gate:Gate', 'finish']);
    expect(judge.phase).toBe('finished');
    // The wrong way through the gate (from below) does not count.
    const wrong: P[] = [...START, ...roundA_ccw, [200, 60], [280, 0], [320, 0], [260, -80], ...FINISH];
    expect(types(judgeTrack(course, wrong).events)).toEqual(['start', 'rounded:A', 'finish-incomplete']);
  });

  it('starboard roundings mirror port roundings', () => {
    const mirror: Course = {
      ...TRIANGLE,
      marks: TRIANGLE.marks.map((m) => ('n' in m.position ? { ...m, position: { n: m.position.n, e: -m.position.e } } : m)),
      legs: [{ type: 'mark', mark: 'A', rounding: 'starboard' }, { type: 'mark', mark: 'B', rounding: 'starboard' }],
    };
    const flip = (p: P[]) => p.map(([n, e]) => [n, -e] as P);
    expect(types(judgeTrack(mirror, flip([...START, ...roundA_ccw, ...roundB_ccw, ...FINISH])).events)).toEqual(['start', 'rounded:A', 'rounded:B', 'finish']);
    expect(types(judgeTrack(mirror, flip([...START, ...roundA_cw, ...roundB_ccw, ...FINISH])).events)).toEqual(['start', 'wrong-side:A', 'out-of-order:B', 'finish-incomplete']);
  });
});

describe('Criterion 10: start and finish', () => {
  const LINE: Course = {
    ...TRIANGLE,
    id: 'fixture-line',
    marks: [...TRIANGLE.marks, { id: 'F1', name: 'F1', kind: 'pin', position: { n: 300, e: -50 } }, { id: 'F2', name: 'F2', kind: 'committee-boat', position: { n: 300, e: 50 } },
      { id: 'G1', name: 'G1', kind: 'inflatable', position: { n: 150, e: -60 } }, { id: 'G2', name: 'G2', kind: 'inflatable', position: { n: 150, e: 60 } }],
    legs: [{ type: 'gate', marks: ['G1', 'G2'] }],
    finish: { ends: ['F1', 'F2'] },
  };

  // Long lines so that every test track, whatever its angle, crosses within the line ends.
  const WIDE: Course = {
    ...LINE,
    id: 'fixture-wide',
    marks: LINE.marks.map((m) => (['S1', 'F1', 'G1'].includes(m.id) && 'n' in m.position ? { ...m, position: { n: m.position.n, e: -400 } } : ['S2', 'F2', 'G2'].includes(m.id) && 'n' in m.position ? { ...m, position: { n: m.position.n, e: 400 } } : m)),
  };

  it('interpolated crossing times match analytic straight-line crossings within 1 ms (100 cases)', () => {
    let worst = 0;
    for (let k = 0; k < 100; k++) {
      // Straight lines at different speeds, angles and offsets; the bow crosses first.
      const speed = 1 + (k % 7) * 0.6;
      const hdg = (-40 + (k * 17) % 80) * DEG;
      const e0 = -30 + (k * 13) % 60;
      const n0 = -20 - (k % 5);
      const judge = new CourseJudge(resolveCourse(WIDE, DART_PROJECTION), HULL, startSequence(1, 'one-minute'));
      const vn = speed * Math.cos(hdg);
      const ve = speed * Math.sin(hdg);
      // Analytic time for each hull point to reach n = 0 (start) and n = 300 (finish); earliest wins.
      const tCross = (line: number) => Math.min(...HULL.map((h) => (line - (n0 + h.x * Math.cos(hdg) - h.y * Math.sin(hdg))) / vn));
      for (let i = 0; i * DT < tCross(300) + 1; i++) {
        const t = i * DT;
        judge.update(t, { n: n0 + vn * t, e: e0 + ve * t, heading: hdg });
      }
      expect(judge.phase).toBe('finished');
      worst = Math.max(worst, Math.abs(judge.startTime! - tCross(0)), Math.abs(judge.finishTime! - tCross(300)));
    }
    console.log(`[criterion 10] worst interpolation error over 100 straight-line crossings: ${(worst * 1000).toExponential(2)} ms`);
    expect(worst).toBeLessThan(0.001);
  });

  it('crossing on a tight turn (curved track) is still within 1 ms', () => {
    // Circle of radius 15 m about (n 0, e 30), turning at 0.2 rad/s; the bow crosses n = 0 mid-turn.
    const R = 15;
    const w = 0.2;
    const pose = (t: number): BoatPose => {
      const a = -Math.PI / 2 - 0.6 + w * t; // position angle on the circle (math sense)
      // Velocity along the circle (anticlockwise): (dn, de) ∝ (cos a, −sin a); compass heading atan2(de, dn).
      return { n: R * Math.sin(a), e: 30 + R * Math.cos(a), heading: Math.atan2(-Math.sin(a), Math.cos(a)) };
    };
    const bowN = (t: number) => pose(t).n + (5.79 / 2) * Math.cos(pose(t).heading);
    let lo = 3;
    let hi = 12;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (bowN(mid) < 0) lo = mid;
      else hi = mid;
    }
    const judge = new CourseJudge(resolveCourse(WIDE, DART_PROJECTION), HULL, startSequence(0.5, 'one-minute'));
    for (let i = 0; i < 1300; i++) judge.update(i * DT, pose(i * DT));
    expect(judge.startTime).toBeDefined();
    console.log(`[criterion 10] curved crossing: interpolation error ${(Math.abs(judge.startTime! - lo) * 1000).toExponential(2)} ms`);
    expect(Math.abs(judge.startTime! - lo)).toBeLessThan(0.001);
  });

  it('OCS: any hull reference point on the course side of the line (or its extension) at the signal', () => {
    const half = 5.79 / 2;
    const beam = 1.867 / 2;
    const at = (pose: BoatPose) => {
      const judge = new CourseJudge(resolveCourse(LINE, DART_PROJECTION), HULL, startSequence(0, 'one-minute'));
      judge.update(0, pose);
      return judge.ocs;
    };
    expect(at({ n: -half + 0.05, e: 0, heading: 0 })).toBe(true); // bow 5 cm over
    expect(at({ n: -half - 0.01, e: 0, heading: 0 })).toBe(false); // bow 1 cm behind
    expect(at({ n: -half + 0.045, e: 0, heading: Math.PI })).toBe(true); // stern over (pointing away)
    expect(at({ n: -beam + 0.03, e: 0, heading: Math.PI / 2 })).toBe(true); // beam-on: port side over
    expect(at({ n: -beam - 0.03, e: 0, heading: Math.PI / 2 })).toBe(false);
    expect(at({ n: -half + 0.05, e: 80, heading: 0 })).toBe(true); // beyond the pin: over the extension
  });

  it('an OCS boat must return entirely to the pre-start side before her start counts', () => {
    const half = 5.79 / 2;
    // Over at the signal, sails on (no start), comes back below the line, then crosses again.
    const path: P[] = [[-half + 1, 0], [20, 0], [20, 20], [-10, 20], [-10, 0], [40, 0], [149, 0], [151, 0], [320, 0]];
    const judge = new CourseJudge(resolveCourse(LINE, DART_PROJECTION), HULL, startSequence(0, 'one-minute'));
    poses(path, 3).forEach((p, i) => judge.update(i * DT, p));
    expect(types(judge.events)).toEqual(['ocs', 'ocs-cleared', 'start', 'gate:Gate', 'finish']);
    expect(judge.startTime!).toBeGreaterThan(10);
  });

  it('100 repeated simulated runs give bit-identical start and finish times', () => {
    const course = resolveCourse(LINE, DART_PROJECTION);
    const run = () => {
      const built = buildConditions({ startTime: '2026-07-15T12:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 90 }, gusts: { preset: 'moderate', seed: 4 }, current: { mode: 'none' } });
      const sim = new Simulation({
        params: squibParams(), env: built.env, initial: { n: -60, e: 0, headingDeg: 0, speedKn: 3 }, input: { autoMain: true, autoJib: true },
        controller: (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: 0 }) }),
      });
      const judge = new CourseJudge(course, HULL, startSequence(10, 'one-minute'));
      judge.update(0, { n: sim.state.n, e: sim.state.e, heading: sim.state.psi });
      while (judge.phase !== 'finished' && sim.time < 200) {
        sim.stepOnce();
        judge.update(sim.time, { n: sim.state.n, e: sim.state.e, heading: sim.state.psi });
      }
      return [judge.startTime!, judge.finishTime!] as const;
    };
    const first = run();
    expect(first[0]).toBeGreaterThan(10);
    expect(first[1]).toBeGreaterThan(first[0]);
    for (let i = 1; i < 100; i++) {
      const r = run();
      expect(r[0]).toBe(first[0]); // bitwise equality (toBe = Object.is)
      expect(r[1]).toBe(first[1]);
    }
    console.log(`[criterion 10] 100 runs: start ${first[0].toFixed(4)} s, finish ${first[1].toFixed(4)} s, identical in every run`);
  }, 120_000);
});
