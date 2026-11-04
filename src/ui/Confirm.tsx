import { useRef, type ReactNode } from 'react';
import { useModal } from './useModal';

/** A question that must be answered before going on (restart or leave a race): a modal alert dialog (UX-2). */
export function Confirm({ id, title, children, keep, go, onAnswer, testId }: { id: string; title: string; children: ReactNode; keep: string; go: string; onAnswer: (yes: boolean) => void; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, () => onAnswer(false));
  return (
    <div ref={ref} className="overlay" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`} data-testid={testId}>
      <section className="panel confirm">
        <h3 id={`${id}-title`}>{title}</h3>
        <p id={`${id}-text`}>{children}</p>
        <div className="row left">
          <button className="primary" autoFocus onClick={() => onAnswer(false)}>{keep}</button>
          <button onClick={() => onAnswer(true)}>{go}</button>
        </div>
      </section>
    </div>
  );
}
