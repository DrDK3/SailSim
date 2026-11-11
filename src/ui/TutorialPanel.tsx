import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { mmss } from '../app/lessons';

/**
 * The lessons, with what is done in this browser and a Start button for each: the six basics, then seamanship
 * (open to everyone, suggested once the basics are done).
 */
export function LessonList({ ui, onStart }: { ui: UiState; onStart: (id: UiState['lessons'][number]['id']) => void }) {
  // Progress kept in this browser: the first lesson not yet done is the one to take next (every lesson stays open).
  const next = ui.lessons.find((l) => !l.done)?.id;
  const basicsDone = ui.lessons.filter((l) => l.group === 'basics').every((l) => l.done);
  return (
    <>
      <LessonGroupList lessons={ui.lessons.filter((l) => l.group === 'basics')} next={next} onStart={onStart} testId="lesson-list" />
      <h4 className="lesson-group">Seamanship{basicsDone ? '' : <span className="fine-inline"> · best after the six basics</span>}</h4>
      <LessonGroupList lessons={ui.lessons.filter((l) => l.group === 'seamanship')} next={next} onStart={onStart} testId="lesson-list-seamanship" />
    </>
  );
}

function LessonGroupList({ lessons, next, onStart, testId }: { lessons: UiState['lessons']; next?: string; onStart: (id: UiState['lessons'][number]['id']) => void; testId: string }) {
  return (
    <ol className="lesson-list" data-testid={testId}>
      {lessons.map((l) => (
        <li key={l.id} className={l.done ? 'done' : l.id === next ? 'next' : ''}>
          <span className="lesson-tick" aria-hidden="true">{l.done ? '✓' : l.number}</span>
          <span className="lesson-text">
            <strong>{l.title}</strong>
            <span className="fine-inline"> · about {l.minutes} min{l.done ? ` · done${l.bestS !== undefined ? `, best ${mmss(l.bestS)}` : ''}` : ''}</span>
            <span className="lesson-summary">{l.summary}</span>
          </span>
          <button className={l.id === next ? 'primary' : ''} onClick={() => onStart(l.id)} aria-label={`Start lesson ${l.number}: ${l.title}${l.done ? ' (done)' : l.id === next ? ' (next)' : ''}`}>
            {l.done ? 'Again' : l.id === next ? 'Start next' : 'Start'}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The lesson's card: the step, its goal, progress, and Back / Next / End; at the end, the result card with the
 * next lesson. Highlights what the step is about.
 */
export function TutorialPanel({ ctl, ui, onRace }: { ctl: SimController; ui: UiState; onRace?: () => void }) {
  const t = ui.tutorial!;
  const heading = useRef<HTMLHeadingElement>(null);
  const [list, setList] = useState(false);
  const targets = t.result ? [] : t.step.targets ?? [];

  // Outline the parts of the screen this step is about (elements marked data-tutorial="…").
  useEffect(() => {
    const els = targets.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${id}"]`)]);
    els.forEach((el) => el.classList.add('tutorial-target'));
    return () => els.forEach((el) => el.classList.remove('tutorial-target'));
  }, [t.index, targets.join(',')]);

  // Announce each new step (and the result) to screen readers by moving focus to its title.
  useEffect(() => heading.current?.focus(), [t.index, t.lesson.id, !!t.result, list]);

  const head = (
    <div className="tutorial-head">
      <span className="fine">
        {t.lesson.group === 'seamanship' ? 'Seamanship' : 'Lesson'} {t.lesson.inGroup} of {t.lesson.count} · {t.lesson.title}
        {!t.result && !list && ` · step ${t.index + 1} of ${t.total}`}
      </span>
      <button className="link" onClick={() => ctl.endTutorial()} aria-label="End the lesson">
        End lesson
      </button>
    </div>
  );

  if (list) {
    return (
      <section className="panel tutorial" aria-label="Lessons" data-testid="tutorial">
        {head}
        <h3 ref={heading} tabIndex={-1}>Lessons</h3>
        <LessonList
          ui={ui}
          onStart={(id) => {
            setList(false);
            ctl.startLesson(id);
          }}
        />
        <div className="row left">
          <button onClick={() => setList(false)}>Back to the lesson</button>
        </div>
      </section>
    );
  }

  if (t.result) {
    const r = t.result;
    return (
      <section className="panel tutorial result" aria-label="Lesson result" data-testid="tutorial">
        {head}
        <h3 ref={heading} tabIndex={-1} data-testid="tutorial-title">
          ✓ Lesson {t.lesson.number} complete: {t.lesson.title}
        </h3>
        <ul className="lesson-result" data-testid="lesson-result">
          {r.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {r.best && <li className="best">Your best time for this lesson (kept in this browser).</li>}
        </ul>
        <p>{t.step.body}</p>
        <div className="row left wrap">
          {r.next ? (
            <button className="primary" onClick={() => ctl.startLesson(r.next!.id)} data-testid="lesson-next">
              Next: {r.next.title}
            </button>
          ) : (
            onRace && (
              <button
                className="primary"
                onClick={() => {
                  ctl.endTutorial();
                  onRace();
                }}
                data-testid="lesson-race"
              >
                Race now
              </button>
            )
          )}
          <button onClick={() => ctl.startLesson(t.lesson.id)}>Repeat</button>
          <button onClick={() => ctl.toggleDebrief(true)} data-testid="lesson-debrief">Your sail</button>
          <button onClick={() => setList(true)}>All lessons</button>
          <button onClick={() => ctl.endTutorial()}>Sail on freely</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel tutorial" aria-label="Lesson" data-testid="tutorial">
      {head}
      <div className="tutorial-dots" aria-hidden="true">
        {Array.from({ length: t.total }, (_, i) => (
          <span key={i} className={i < t.index ? 'dot past' : i === t.index ? 'dot now' : 'dot'} />
        ))}
      </div>
      <h3 ref={heading} tabIndex={-1} data-testid="tutorial-title">
        {t.step.title}
      </h3>
      <p>{ui.steering === 'tiller' && t.step.bodyTiller ? t.step.bodyTiller : t.step.body}</p>
      {t.step.hint && <p className="fine">{t.step.hint}</p>}
      {t.readout && (
        <p className="lesson-readout" data-testid="lesson-readout">
          {t.readout}
        </p>
      )}
      {t.step.goal !== undefined && (
        <div className={`tutorial-goal ${t.done ? 'met' : ''}`} role="status" data-testid="tutorial-goal">
          {t.done ? '✓ Done: moving on…' : t.step.holdS ? (
            <>
              <span>Hold it: {Math.round(t.progress * (t.step.holdS ?? 0))} of {t.step.holdS} s</span>
              <progress max={1} value={t.progress} aria-label="Goal held" />
            </>
          ) : (
            'Waiting for you…'
          )}
        </div>
      )}
      <div className="row left wrap">
        <button onClick={() => ctl.tutorialBack()} disabled={t.index === 0}>
          Back
        </button>
        <button className={t.step.goal === undefined || t.done ? 'primary' : ''} onClick={() => ctl.tutorialNext()}>
          {t.step.goal === undefined || t.done ? 'Next' : 'Skip step'}
        </button>
        <button className="link" onClick={() => setList(true)}>
          All lessons
        </button>
      </div>
    </section>
  );
}
