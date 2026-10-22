import { DEG } from '../math/angles';
import { angleTo } from './geometry';
import { COURSE_SCHEMA, type Course, type CourseLeg, type CourseMark, type LocalPoint } from './types';

/**
 * SIMULATED practice courses, laid relative to the wind about a chosen start point (the middle of the start
 * line). These are invented for practice and always carry status "simulated"; they are not RDYC courses.
 */
export type PracticeKind = 'windward-leeward' | 'triangle' | 'tacking-lane' | 'gybing-slalom' | 'rounding-drill';

export const PRACTICE_KINDS: { kind: PracticeKind; label: string; description: string; legM: number }[] = [
  { kind: 'windward-leeward', label: 'Windward–leeward', description: 'Beat to a windward mark (to port), run back through a leeward gate; 2 laps.', legM: 600 },
  { kind: 'triangle', label: 'Triangle', description: 'Windward, wing and leeward marks, all to port: beat, two reaches, run; 2 laps.', legM: 600 },
  { kind: 'tacking-lane', label: 'Tacking lane', description: 'Beat inside a 60 m lane (boundaries must not be crossed) to a windward mark, then back.', legM: 500 },
  { kind: 'gybing-slalom', label: 'Gybing slalom', description: 'Start at the top, run down through five marks left alternately to port and starboard.', legM: 350 },
  { kind: 'rounding-drill', label: 'Mark-rounding drill', description: 'Short windward–leeward sausage (120 m), 4 laps: eight roundings.', legM: 120 },
];

export interface PracticeOptions {
  kind: PracticeKind;
  /** Middle of the start line (local metres). */
  centre: LocalPoint;
  windFromDeg: number;
  /** Main leg length (m); defaults per kind. */
  legM?: number;
  laps?: number;
  startLineM?: number;
}

/** Turn direction at each mark: port if the course turns left there, starboard if right. */
export function roundingFromTurn(prev: LocalPoint, mark: LocalPoint, next: LocalPoint): 'port' | 'starboard' {
  const a = (((angleTo(mark, next) - angleTo(mark, prev)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
  return a > Math.PI ? 'port' : 'starboard';
}

export function practiceCourse(o: PracticeOptions): Course {
  const def = PRACTICE_KINDS.find((k) => k.kind === o.kind)!;
  const leg = o.legM ?? def.legM;
  const w = o.windFromDeg * DEG;
  // u: upwind unit vector; c: to starboard when facing upwind.
  const u = { n: Math.cos(w), e: Math.sin(w) };
  const c = { n: -Math.sin(w), e: Math.cos(w) };
  const P = (up: number, right: number): { n: number; e: number } => ({
    n: Math.round((o.centre.n + u.n * up + c.n * right) * 10) / 10,
    e: Math.round((o.centre.e + u.e * up + c.e * right) * 10) / 10,
  });
  const lineM = o.startLineM ?? 80;
  const marks: CourseMark[] = [];
  const mark = (id: string, name: string, kind: CourseMark['kind'], p: { n: number; e: number }) => {
    marks.push({ id, name, kind, position: p, source: 'generated (simulated practice course)' });
    return id;
  };
  let legs: CourseLeg[] = [];
  let laps = o.laps ?? 2;
  let finish: [string, string];
  let boundaries: Course['boundaries'];
  // Start line across the wind: pin at the port end (left looking upwind), committee boat at the starboard end.
  // (The gybing slalom starts at the top of its run instead.)
  let start: [string, string] =
    o.kind === 'gybing-slalom' ? ['RC', 'PIN'] : [mark('PIN', 'Pin end', 'pin', P(0, -lineM / 2)), mark('RC', 'Committee boat', 'committee-boat', P(0, lineM / 2))];
  finish = start;

  switch (o.kind) {
    case 'windward-leeward': {
      mark('W', 'Windward', 'inflatable', P(leg, 0));
      mark('G1', 'Leeward gate (left)', 'inflatable', P(0.12 * leg, -20));
      mark('G2', 'Leeward gate (right)', 'inflatable', P(0.12 * leg, 20));
      legs = [{ type: 'mark', mark: 'W', rounding: 'port' }, { type: 'gate', marks: ['G1', 'G2'] }];
      break;
    }
    case 'triangle': {
      mark('W', 'Windward', 'inflatable', P(leg, 0));
      mark('R', 'Wing', 'inflatable', P(0.5 * leg, -0.5 * leg));
      mark('L', 'Leeward', 'inflatable', P(0.12 * leg, 0.15 * leg));
      legs = [{ type: 'mark', mark: 'W', rounding: 'port' }, { type: 'mark', mark: 'R', rounding: 'port' }, { type: 'mark', mark: 'L', rounding: 'port' }];
      break;
    }
    case 'tacking-lane': {
      laps = o.laps ?? 1;
      mark('W', 'Windward', 'inflatable', P(leg, 0));
      mark('LL1', 'Lane left (bottom)', 'virtual', P(0.1 * leg, -30));
      mark('LL2', 'Lane left (top)', 'virtual', P(0.9 * leg, -30));
      mark('LR1', 'Lane right (bottom)', 'virtual', P(0.1 * leg, 30));
      mark('LR2', 'Lane right (top)', 'virtual', P(0.9 * leg, 30));
      legs = [{ type: 'mark', mark: 'W', rounding: 'port' }];
      boundaries = [{ ends: ['LL1', 'LL2'], label: 'Lane left side' }, { ends: ['LR1', 'LR2'], label: 'Lane right side' }];
      break;
    }
    case 'gybing-slalom': {
      laps = o.laps ?? 1;
      // Start at the top of the run (line crossed downwind), marks alternately left and right of the axis.
      start = [mark('RC', 'Committee boat', 'committee-boat', P(0, -lineM / 2)), mark('PIN', 'Pin end', 'pin', P(0, lineM / 2))];
      const n = 5;
      const spacing = leg / (n + 1);
      const ids: string[] = [];
      for (let k = 1; k <= n; k++) ids.push(mark(`S${k}`, `Slalom ${k}`, 'inflatable', P(-k * spacing, (k % 2 ? 1 : -1) * 25)));
      finish = [mark('F1', 'Finish (left)', 'pin', P(-leg, -lineM / 2)), mark('F2', 'Finish (right)', 'committee-boat', P(-leg, lineM / 2))];
      const pts = [P(0, 0), ...ids.map((id) => marks.find((m) => m.id === id)!.position as LocalPoint), P(-leg, 0)];
      legs = ids.map((id, i) => ({ type: 'mark', mark: id, rounding: roundingFromTurn(pts[i]!, pts[i + 1]!, pts[i + 2]!) }));
      break;
    }
    case 'rounding-drill': {
      laps = o.laps ?? 4;
      mark('W', 'Top', 'inflatable', P(leg, 0));
      mark('L', 'Bottom', 'inflatable', P(0.35 * leg, 0));
      legs = [{ type: 'mark', mark: 'W', rounding: 'port' }, { type: 'mark', mark: 'L', rounding: 'port' }];
      break;
    }
  }
  return {
    schema: COURSE_SCHEMA,
    id: `practice-${o.kind}`,
    name: `${def.label} (simulated)`,
    description: def.description,
    status: 'simulated',
    provenance: {
      kind: 'simulated',
      notes: `Generated practice course: ${def.label}; wind from ${Math.round(o.windFromDeg)}°, leg ${Math.round(leg)} m, start line ${lineM} m, centre n ${o.centre.n.toFixed(0)} e ${o.centre.e.toFixed(0)}. Not an RDYC course.`,
    },
    marks,
    start: { ends: start },
    legs,
    laps,
    finish: { ends: finish },
    boundaries,
    designWindFromDeg: Math.round(o.windFromDeg),
  };
}
