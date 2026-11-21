import { LESSONS, type LessonId, type LessonProgress } from './lessons';
import { EXERCISES, type ExerciseId } from './exercises/index';
import type { StoredRun } from './exercises/records';
import type { Bests } from './bests';

/**
 * The Learn map (review #13, package D): one ordered path through what the simulator already teaches: the six
 * basic lessons, the three seamanship lessons, the two exercises, then the challenges (today's challenge, a start
 * drill, a race against the AI, this week's course). Each step says whether it is done, from the progress the app
 * already keeps in this browser (lessons, exercise records, personal bests), and the map suggests the next step: the
 * first not yet done. It removes nothing: every lesson, exercise and challenge is still where it was.
 *
 * Its own record (the steps started from the map) is kept in this browser only, every access wrapped so a private
 * window or blocked storage never breaks it. Nothing is sent anywhere; no accounts, no personal data; no streaks or
 * rewards for coming back (under-18 safeguards).
 */

export type LearnGroup = 'Basics' | 'Seamanship' | 'Exercises' | 'Challenges';

export type LearnAction =
  | { kind: 'lesson'; id: LessonId }
  | { kind: 'exercise'; id: ExerciseId }
  | { kind: 'daily' }
  | { kind: 'drill' }
  | { kind: 'race' }
  | { kind: 'weekly' };

export interface LearnStep {
  /** Stable id (`lesson:steer`, `exercise:tack-recover`, `challenge:daily` …). */
  id: string;
  group: LearnGroup;
  title: string;
  summary: string;
  /** About how long it takes (min, E), where known. */
  minutes?: number;
  /** Done: a lesson finished, an exercise attempt completed, a challenge with a time recorded. */
  done: boolean;
  /** Started from the map (or tried) but not done yet. */
  started: boolean;
  /** A fact about it: a best time, attempts so far. */
  note?: string;
  action: LearnAction;
}

/** What the map reads: the stores the app already keeps, and its own. */
export interface LearnInputs {
  lessons: LessonProgress;
  exerciseRuns: readonly Pick<StoredRun, 'exercise' | 'attempts'>[];
  bests: Bests;
  /** Today's challenge key (src/app/quickRace.ts dailyChallenge). */
  dailyKey: string;
  /** This week's course has a time in this browser. */
  weeklyDone: boolean;
  /** Steps started from the map. */
  started: readonly string[];
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;

export function learnSteps(p: LearnInputs): LearnStep[] {
  const started = new Set(p.started);
  const steps: LearnStep[] = [];
  for (const l of LESSONS) {
    const id = `lesson:${l.id}`;
    const done = !!p.lessons[l.id];
    steps.push({
      id,
      group: l.group === 'basics' ? 'Basics' : 'Seamanship',
      title: l.title,
      summary: l.summary,
      minutes: l.minutes,
      done,
      started: !done && started.has(id),
      note: done ? `Best ${mmss(p.lessons[l.id]!.bestS)}` : undefined,
      action: { kind: 'lesson', id: l.id },
    });
  }
  for (const e of EXERCISES) {
    const id = `exercise:${e.id}`;
    const runs = p.exerciseRuns.filter((r) => r.exercise === e.id);
    const attempts = runs.flatMap((r) => r.attempts);
    const completed = attempts.filter((a) => a.outcome === 'complete');
    const done = completed.length > 0;
    steps.push({
      id,
      group: 'Exercises',
      title: e.title,
      summary: e.summary,
      minutes: e.minutes,
      done,
      started: !done && (started.has(id) || attempts.length > 0),
      note: attempts.length ? `${completed.length} of ${attempts.length} attempt${attempts.length === 1 ? '' : 's'} completed` : undefined,
      action: { kind: 'exercise', id: e.id },
    });
  }
  const daily = p.bests.races[p.dailyKey];
  const otherRace = Object.keys(p.bests.races).some((k) => !k.startsWith('challenge:'));
  const challenge = (id: string, title: string, summary: string, done: boolean, action: LearnAction, note?: string, minutes?: number): LearnStep => ({
    id,
    group: 'Challenges',
    title,
    summary,
    minutes,
    done,
    started: !done && started.has(id),
    note,
    action,
  });
  steps.push(
    challenge('challenge:daily', 'Today’s challenge', 'The same short race for everyone today, against three AI Squibs. A new one tomorrow.', !!daily, { kind: 'daily' }, daily ? `Your time today ${mmss(daily.timeS)}` : undefined, 5),
    challenge('challenge:drill', 'A start drill', 'Time your run at the line: the timer counts down and you cross as the gun goes.', !!p.bests.start, { kind: 'drill' }, p.bests.start ? `Best start ${p.bests.start.delayS.toFixed(1)} s after the gun` : undefined, 2),
    challenge('challenge:race', 'Race against the AI', 'Choose the course, the fleet and the wind in Race.', otherRace, { kind: 'race' }),
    challenge('challenge:weekly', 'This week’s course', 'A short course for the week, with model-sailed targets to beat.', p.weeklyDone, { kind: 'weekly' }, undefined, 8),
  );
  return steps;
}

/** The step to suggest: the first not done; when every step is done, today's challenge (a new one each day). */
export function nextStep(steps: readonly LearnStep[]): LearnStep {
  return steps.find((s) => !s.done) ?? steps.find((s) => s.id === 'challenge:daily') ?? steps[0]!;
}

// -------------------------------------------------------------- its own record, in this browser only

const KEY = 'squib.learnmap.v1';

export function loadStarted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { started?: unknown };
    return Array.isArray(raw.started) ? raw.started.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
  } catch {
    return [];
  }
}

/** Note that a step was started from the map; returns the record (kept for this visit if storage is unavailable). */
export function noteStarted(id: string, have: readonly string[] = loadStarted()): string[] {
  const started = have.includes(id) ? [...have] : [...have, id].slice(-64);
  try {
    localStorage.setItem(KEY, JSON.stringify({ started }));
  } catch {
    // storage unavailable: kept for this visit only
  }
  return started;
}
