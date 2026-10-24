import { useEffect, useRef } from 'react';
import type { SimController, UiState } from '../app/controller';

/** The tutorial's card: the step, its goal, progress, and Back / Next / End. Highlights what the step is about. */
export function TutorialPanel({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const t = ui.tutorial!;
  const heading = useRef<HTMLHeadingElement>(null);
  const targets = t.step.targets ?? [];

  // Outline the parts of the screen this step is about (elements marked data-tutorial="…").
  useEffect(() => {
    const els = targets.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${id}"]`)]);
    els.forEach((el) => el.classList.add('tutorial-target'));
    return () => els.forEach((el) => el.classList.remove('tutorial-target'));
  }, [t.index, targets.join(',')]);

  // Announce each new step to screen readers by moving focus to its title.
  useEffect(() => heading.current?.focus(), [t.index]);

  const last = t.index === t.total - 1;
  return (
    <section className="panel tutorial" aria-label="Tutorial" data-testid="tutorial">
      <div className="tutorial-head">
        <span className="fine">
          Tutorial · step {t.index + 1} of {t.total}
        </span>
        <button className="link" onClick={() => ctl.endTutorial()} aria-label="End the tutorial">
          End tutorial
        </button>
      </div>
      <div className="tutorial-dots" aria-hidden="true">
        {Array.from({ length: t.total }, (_, i) => (
          <span key={i} className={i < t.index ? 'dot past' : i === t.index ? 'dot now' : 'dot'} />
        ))}
      </div>
      <h3 ref={heading} tabIndex={-1} data-testid="tutorial-title">
        {t.step.title}
      </h3>
      <p>{t.step.body}</p>
      {t.step.hint && <p className="fine">{t.step.hint}</p>}
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
      <div className="row left">
        <button onClick={() => ctl.tutorialBack()} disabled={t.index === 0}>
          Back
        </button>
        {last ? (
          <button className="primary" onClick={() => ctl.endTutorial()}>
            Finish
          </button>
        ) : (
          <button className={t.step.goal === undefined || t.done ? 'primary' : ''} onClick={() => ctl.tutorialNext()}>
            {t.step.goal === undefined || t.done ? 'Next' : 'Skip step'}
          </button>
        )}
      </div>
    </section>
  );
}
