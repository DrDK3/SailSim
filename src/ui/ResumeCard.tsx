import type { SimController, UiState } from '../app/controller';

/**
 * "Continue where you left off" (src/app/resume.ts): last visit's run, kept in this browser, sailed again quickly to
 * where it was left; or start fresh.
 */
export function ResumeCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  if (ui.catchingUp !== undefined) {
    return (
      <div className="hint-card" role="status" aria-live="polite" data-testid="resume-card">
        <p>
          <strong>Catching up…</strong> sailing your last run again to where you left it ({Math.round(ui.catchingUp * 100)}%).
        </p>
        <progress max={1} value={ui.catchingUp} style={{ width: '100%' }} />
      </div>
    );
  }
  const r = ui.resume;
  if (!r || ui.tutorial || ui.replay) return null;
  return (
    <div className="hint-card" role="dialog" aria-label="Continue where you left off" data-testid="resume-card">
      <p>
        <strong>Continue where you left off?</strong> {r.label} · {r.summary}.{r.note ? ` ${r.note}` : ''}
      </p>
      <div className="row">
        <button className="primary" onClick={() => ctl.continueSession()} data-testid="resume-continue">
          Continue
        </button>
        <button onClick={() => ctl.dismissResume()} data-testid="resume-dismiss">Start fresh</button>
      </div>
    </div>
  );
}
