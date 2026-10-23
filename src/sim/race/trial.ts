import { createRng } from '../math/rng';
import type { DartGeo } from '../geo/dart';
import { practiceCourse, type PracticeKind } from '../course/practice';
import type { Course } from '../course/types';
import type { ConditionsSettings } from '../env/conditions';
import type { AiLevel } from '../ai/skipper';
import { createRace, practiceLineLength, type RaceFeatures } from './setup';

/**
 * One seeded AI-only race for the Phase 5 acceptance trials (criterion "AI boats complete a practice course
 * without grounding or collisions"). Conditions are drawn from the seed: true wind 6–16 kn from any direction,
 * moderate or shifty gusts, and a practice course (windward–leeward or triangle) in the Start Bay practice
 * area, one lap. A run is CLEAN when every boat finishes, no boat touches another boat, a mark, a moored boat
 * or a ferry, and no boat touches the bottom.
 */
export interface TrialOptions {
  boats: number;
  level: AiLevel;
  laps: number;
  kinds: PracticeKind[];
  /** Override the practice area centre (local metres). */
  centre?: { n: number; e: number };
  /** Use a fixed course instead of a generated practice course. */
  course?: Course;
  twsRange: [number, number];
  /** Tide and channel stream (river trials). */
  conditions?: Partial<ConditionsSettings>;
}

export const DEFAULT_TRIAL: TrialOptions = {
  boats: 5,
  level: 'good',
  laps: 1,
  kinds: ['windward-leeward', 'triangle'],
  twsRange: [6, 16],
};

export interface TrialResult {
  seed: number;
  course: string;
  twsKn: number;
  twdDeg: number;
  gusts: string;
  clean: boolean;
  finished: number;
  boats: number;
  contacts: { t: number; kind: string; summary: string }[];
  grounded: string[];
  /** Course boundary crossings (tacking lane). */
  boundaryCrossings: number;
  codes: string[];
  startDelays: number[];
  ocs: number;
  generalRecalls: number;
  raceTime: number;
  simTime: number;
}

export function runTrial(seed: number, o: TrialOptions, geo?: DartGeo, features?: RaceFeatures): TrialResult {
  const rng = createRng(seed * 2654435761);
  const tws = Math.round((o.twsRange[0] + (o.twsRange[1] - o.twsRange[0]) * rng.next()) * 10) / 10;
  const twd = Math.round(360 * rng.next());
  const gusts = rng.next() < 0.5 ? 'moderate' : 'shifty';
  const kind = o.kinds[seed % o.kinds.length]!;
  const course = o.course ?? practiceCourse({ kind, centre: o.centre ?? { n: -3500, e: 1200 }, windFromDeg: twd, laps: o.laps, startLineM: practiceLineLength(o.boats) });
  const conditions: ConditionsSettings = {
    startTime: '2026-07-15T13:00:00Z',
    weather: { source: 'manual', twsKn: tws, twdDeg: twd },
    gusts: { preset: gusts, seed },
    current: { mode: 'none' },
    ...o.conditions,
  };
  const { session } = createRace({ conditions, geo, features, course, aiCount: o.boats, level: o.level, seed, committee: { startAt: 330, sequence: 'five-minute', finishWindowS: 600, timeLimitS: 3000 } });
  const grounded = new Set<string>();
  while (!session.finished && session.time < 3600) {
    session.step();
    if (geo && session.fleet.step % 20 === 0) for (const b of session.fleet.boats) if (!grounded.has(b.id) && session.grounded(b.id)) grounded.add(b.id);
  }
  const results = session.results();
  const st = session.status();
  const boundaryCrossings = session.fleet.boats.reduce((a, b) => a + session.judgeOf(b.id).events.filter((e) => e.type === 'boundary').length, 0);
  const startAt = session.committee.startTime;
  return {
    seed,
    course: course.name,
    twsKn: tws,
    twdDeg: twd,
    gusts,
    clean: results.every((r) => r.code === 'FIN') && session.incidents.length === 0 && grounded.size === 0 && boundaryCrossings === 0,
    finished: results.filter((r) => r.code === 'FIN').length,
    boats: o.boats,
    contacts: session.incidents.map((i) => ({ t: Math.round(i.t * 10) / 10, kind: i.kind, summary: i.summary })),
    grounded: [...grounded],
    boundaryCrossings,
    codes: results.map((r) => r.code),
    startDelays: st.filter((x) => x.startTime !== undefined).map((x) => Math.round((x.startTime! - startAt) * 10) / 10),
    ocs: st.filter((x) => x.wasOcs).length,
    generalRecalls: session.committee.log.filter((l) => l.name === 'general-recall').length,
    raceTime: Math.round(session.time - startAt),
    simTime: Math.round(session.time),
  };
}
