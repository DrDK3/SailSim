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

/** Ghost racing (src/app/ghost.ts): learning the recording's path, then a small reminder that a ghost is out there. */
export function GhostStatus({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  if (ui.ghostLoading !== undefined) {
    return (
      <div className="hint-card" role="status" aria-live="polite" data-testid="ghost-loading">
        <p>
          <strong>Learning the ghost’s course…</strong> sailing the recording through quickly ({Math.round(ui.ghostLoading * 100)}%).
        </p>
        <progress max={1} value={ui.ghostLoading} style={{ width: '100%' }} />
      </div>
    );
  }
  if (ui.shareError) {
    return (
      <div className="hint-card" role="alert" data-testid="share-error">
        <p>
          <strong>The shared run could not be opened.</strong> {ui.shareError}
        </p>
        <div className="row">
          <button onClick={() => ctl.dismissShareError()}>Close</button>
        </div>
      </div>
    );
  }
  return null;
}

/** A small reminder that a ghost is out there, with a way to stop it. */
export function GhostChip({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  if (!ui.ghost || ui.ghostLoading !== undefined) return null;
  return (
    <div className="ghost-chip panel" data-testid="ghost-chip">
      <span>Ghost: {ui.ghost.title}</span>
      <button className="link" onClick={() => ctl.endGhost()}>Stop the ghost</button>
    </div>
  );
}

/**
 * The River Dart data arrived during a run that is not restarted without asking (review #9): a lesson, an exercise, a
 * race, or a free sail where the boat is not in clear water on the river. Restart here, or keep sailing in open water.
 */
export function RiverCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  if (!ui.dart.ask) return null;
  const what = ui.tutorial ? 'this lesson' : ui.exercise ? 'this exercise' : ui.race ? 'this race' : 'this sail';
  return (
    <div className="hint-card" role="dialog" aria-label="The river is ready" data-testid="river-card">
      <p>
        <strong>The river is ready. Restart here?</strong> The River Dart’s depths, tidal stream and harbour have loaded. Restart {what} with them, or keep sailing in open water: the river joins at your next start.
      </p>
      <div className="row">
        <button className="primary" onClick={() => ctl.riverRestart()} data-testid="river-restart">
          Restart
        </button>
        <button onClick={() => ctl.riverKeep()} data-testid="river-keep">Keep sailing</button>
      </div>
    </div>
  );
}
