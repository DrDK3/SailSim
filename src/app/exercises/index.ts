import type { AppScenario } from '../controller';
import type { ControlInput } from '../../sim/simulation';
import type { OverlayPart } from '../lessons';
import type { SteeringMode } from '../steering';
import type { Thresholds } from './config';
import type { AttemptPlan, ExerciseDef } from './engine';
import { TACK_RECOVER_ID, tackRecoverExercise } from './tackRecover';

/** The exercises (training slice §7–§8), with the water each attempt starts on. */
export type ExerciseId = typeof TACK_RECOVER_ID;

export interface ExerciseInfo {
  id: ExerciseId;
  title: string;
  summary: string;
  minutes: number;
  /** "Beginner" or "Tactics". */
  level: string;
}

export interface ExerciseSpec {
  def: ExerciseDef;
  /** The water, wind and start for an attempt (or the warm-up). */
  scenario: (plan: AttemptPlan) => AppScenario;
  /** The controls an attempt starts with. */
  input: (start: AttemptPlan['start']) => ControlInput;
  /** The teaching overlay's parts when the attempt has the overlay on. */
  overlay: OverlayPart[];
}

/** Steady open water off the Dart, as the basic lessons use (src/app/lessons.ts openWater). */
function openWater(twsKn: number, twdDeg: number, seed: number, headingDeg: number): AppScenario {
  return {
    conditions: {
      startTime: '2026-07-15T13:00:00Z',
      weather: { source: 'manual', twsKn, twdDeg },
      gusts: { preset: 'steady', seed },
      current: { mode: 'none' },
      sky: { source: 'preset', preset: 'fair' },
    },
    startLocation: 'start-bay-practice',
    startHeadingDeg: Math.round(headingDeg * 10) / 10,
    startSpeedKn: 3,
  };
}

const inputFor = (start: AttemptPlan['start']): ControlInput => ({ helm: 0, mainSheet: 0.35, jibSheet: 0.35, autoMain: start.autoMain, autoJib: start.autoJib, crewHike: 0.6, autoCrew: start.autoCrew, flatten: 0 });

export const EXERCISES: ExerciseInfo[] = [
  { id: TACK_RECOVER_ID, title: 'Trim, tack and recover', summary: 'Find close-hauled, feel the edge of the wind, tack and get going again: four attempts, with less help each time.', minutes: 8, level: 'Beginner' },
];

export function isExerciseId(x: unknown): x is ExerciseId {
  return EXERCISES.some((e) => e.id === x);
}

export function buildExercise(id: ExerciseId, t: Thresholds, steering: SteeringMode): ExerciseSpec {
  switch (id) {
    case TACK_RECOVER_ID: {
      const th = t.tackRecover;
      return {
        def: tackRecoverExercise(th, steering),
        scenario: (plan) => openWater(th.windKn, th.windFromDeg, th.seed, plan.headingDeg),
        input: inputFor,
        overlay: ['wind'],
      };
    }
  }
}
