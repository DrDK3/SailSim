import type { UiState } from '../app/controller';

/** What the user is doing now, from the session's own state (nothing here is stored separately). */
export type ActivityKind = 'free' | 'race' | 'course' | 'tutorial' | 'replay';

export interface Activity {
  kind: ActivityKind;
  /** A word or two: "Free sailing", "Race", "Course", "Tutorial", "Replay". */
  label: string;
  /** A short qualifier: the fleet and phase, the lesson step, the replay's title. */
  detail?: string;
}

const PHASE = { 'pre-start': 'starting', racing: 'racing', finished: 'finished' } as const;

/** The current activity: a replay first (it drives everything), then the tutorial, a course (with or without a fleet), else free sailing. */
export function activityOf(ui: Pick<UiState, 'replay' | 'tutorial' | 'race'>): Activity {
  if (ui.replay) return { kind: 'replay', label: 'Replay', detail: ui.replay.title };
  if (ui.tutorial) return { kind: 'tutorial', label: 'Tutorial', detail: `step ${ui.tutorial.index + 1} of ${ui.tutorial.total}` };
  const r = ui.race;
  if (r) {
    const phase = r.raceOver ? 'over' : PHASE[r.phase];
    if (r.fleetSize > 1) return { kind: 'race', label: 'Race', detail: `${r.fleetSize - 1} AI · ${phase}` };
    return { kind: 'course', label: 'Course', detail: `${r.courseName} · ${phase}` };
  }
  return { kind: 'free', label: 'Free sailing' };
}
