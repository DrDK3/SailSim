import { useMemo, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { useModal } from './useModal';
import { useTrust } from './trust';
import { loadLessonProgress } from '../app/lessons';
import { loadRuns } from '../app/exercises/records';
import { loadBests } from '../app/bests';
import { SUPPORT_TERMS } from '../app/assists';
import { DEFAULT_QUICK_RACE, dailyChallenge } from '../app/quickRace';
import { learnSteps, loadStarted, nextStep, noteStarted, type LearnGroup, type LearnStep, TICK_MEANING, TICKS_ARE } from '../app/learnMap';

/**
 * The Learn map (review #13, package D): the lessons, the two exercises and the challenges in one order, each marked
 * done, started or not yet, with the next step suggested. Everything it lists can still be reached where it was
 * (Settings → Lessons and the exercises; Race for races, today's challenge and the weekly course). Progress is read
 * from this browser only.
 */
const GROUPS: { group: LearnGroup; intro: string }[] = [
  { group: 'Basics', intro: 'Six short lessons: steering, the wind, trimming, turning, starting, the tide.' },
  { group: 'Seamanship', intro: 'Boat handling you would practise with an instructor on the water.' },
  { group: 'Exercises', intro: 'Longer practice with feedback, attempt by attempt.' },
  { group: 'Challenges', intro: 'Races and drills to put it together.' },
];

export function LearnMapDialog({ ctl, ui, onClose, onOpenRace }: { ctl: SimController; ui: UiState; onClose: () => void; onOpenRace?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  const { instructor } = useTrust();
  const [started, setStarted] = useState(() => loadStarted());
  const runs = useMemo(() => loadRuns(), []);
  const steps = useMemo(
    () =>
      learnSteps({
        lessons: loadLessonProgress(),
        exerciseRuns: runs,
        bests: loadBests(),
        dailyKey: dailyChallenge().key,
        // A best under earlier rules still counts as done (§3.2).
        weeklyDone: !!ui.social.weekly.best || !!ui.social.weekly.earlier,
        started,
      }),
    [runs, ui.social.weekly.best, ui.social.weekly.earlier, started],
  );
  const next = nextStep(steps);
  const doneCount = steps.filter((s) => s.done).length;

  /** The step is the activity under way now: its button goes back to it rather than starting it again (item 8). */
  const running = (s: LearnStep) =>
    (s.action.kind === 'lesson' && ui.tutorial?.lesson.id === s.action.id && !ui.tutorial.result) || (s.action.kind === 'exercise' && ui.exercise?.info.id === s.action.id && ui.exercise.state.stage !== 'result');
  /** What the button does, in words: back to it (resumes), start again (restarts from the beginning), or start. */
  const verb = (s: LearnStep) => (running(s) ? 'Back to it' : s.done ? 'Go again' : s.started ? 'Start again' : 'Start');

  const start = (s: LearnStep) => {
    if (running(s)) {
      onClose();
      return;
    }
    setStarted(noteStarted(s.id, started));
    const a = s.action;
    if (a.kind === 'race') {
      onClose();
      onOpenRace?.();
      return;
    }
    onClose();
    if (a.kind === 'lesson') ctl.leaveTo(`Starting the lesson ${s.title}`, () => ctl.startLesson(a.id));
    else if (a.kind === 'exercise') ctl.leaveTo(`Starting the exercise ${s.title}`, () => ctl.startExercise(a.id));
    else if (a.kind === 'daily') ctl.leaveTo('Starting today’s challenge', () => void ctl.startQuickRace(dailyChallenge().options));
    else if (a.kind === 'drill') ctl.leaveTo('Starting a start drill', () => void ctl.startDrill({ ...DEFAULT_QUICK_RACE }));
    else if (a.kind === 'weekly') ctl.leaveTo('Sailing this week’s course', () => void ctl.social.sailWeekly());
  };

  /** In the instructor view, each exercise's assist record: attempts on the learner's own and with help. */
  const assistLine = (s: LearnStep): string | undefined => {
    if (!instructor || s.action.kind !== 'exercise') return undefined;
    const id = s.action.id;
    const attempts = runs.filter((r) => r.exercise === id).flatMap((r) => r.attempts);
    if (!attempts.length) return undefined;
    const own = attempts.filter((a) => a.independent).length;
    const changed = runs.some((r) => r.exercise === id && r.thresholdsChanged);
    return `Assist record: ${own} of ${attempts.length} ${SUPPORT_TERMS.independent}, ${attempts.length - own} ${SUPPORT_TERMS.assisted}${changed ? '; thresholds changed for this browser' : '; shipped thresholds (provisional, E)'}.`;
  };

  return (
    <div ref={ref} className="overlay hub-overlay" role="dialog" aria-modal="true" aria-labelledby="learn-map-title" onClick={onClose}>
      <section className="panel hub hub-light learn-map" onClick={(e) => e.stopPropagation()} data-testid="learn-map">
        <div className="hub-head">
          <h2 id="learn-map-title">Learn map</h2>
          <button className="hub-close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="fine" data-testid="learn-map-progress">
          {doneCount} of {steps.length} done. Kept in this browser only. {TICKS_ARE}
        </p>
        <div className="learn-next" data-testid="learn-next">
          <p>
            <strong>Next:</strong> {next.title}
            {next.minutes ? ` (about ${next.minutes} min)` : ''}. <span className="lesson-summary">{next.summary}</span>
          </p>
          <button className="primary" onClick={() => start(next)} data-testid="learn-next-start">
            {verb(next)}: {next.title}
          </button>
        </div>
        {GROUPS.map(({ group, intro }) => (
          <section key={group} aria-labelledby={`learn-${group}`}>
            <h3 id={`learn-${group}`} className="learn-group">
              {group}
            </h3>
            <p className="fine">
              {intro} <span data-testid={`learn-tick-${group}`}>{TICK_MEANING[group]}</span>
            </p>
            <ol className="lesson-list">
              {steps
                .filter((s) => s.group === group)
                .map((s) => (
                  <li key={s.id} className={s.done ? 'done' : s.id === next.id ? 'next' : undefined} data-testid={`learn-step-${s.id}`}>
                    <span className="lesson-tick" aria-hidden="true">
                      {s.done ? '✓' : s.id === next.id ? '›' : ''}
                    </span>
                    <span>
                      <strong>{s.title}</strong>{' '}
                      <span className="learn-status">{s.done ? '· done' : s.started ? '· started' : s.id === next.id ? '· next' : ''}</span>
                      <br />
                      <span className="lesson-summary">{s.note ?? s.summary}</span>
                      {assistLine(s) && (
                        <>
                          <br />
                          <span className="lesson-summary trust-note" data-testid="learn-assists">
                            {assistLine(s)}
                          </span>
                        </>
                      )}
                    </span>
                    <button onClick={() => start(s)} aria-label={`${running(s) ? 'Back to it' : s.done ? 'Again' : s.started ? 'Start again' : 'Start'}: ${s.title}`}>
                      {running(s) ? 'Back to it' : s.done ? 'Again' : s.started ? 'Start again' : 'Start'}
                    </button>
                  </li>
                ))}
            </ol>
          </section>
        ))}
        <p className="fine">
          “Back to it” returns to the activity under way; “Start again” starts it from the beginning (lessons and exercises do not resume part-way). The
          lessons and exercises are also in Settings → Lessons; races, today&apos;s challenge and the weekly course in Race. Nothing here replaces them.
        </p>
      </section>
    </div>
  );
}
