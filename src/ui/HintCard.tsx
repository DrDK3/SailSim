import type { SimController, UiState } from '../app/controller';

/**
 * A hint when you are stuck (src/app/hints.ts): what is happening, what to do, and "Show me", which sails the boat out
 * of it for a few seconds. Each kind shows once in this browser; Settings turns hints off.
 */
export function HintCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const h = ui.hint;
  if (!h || !ui.prefs.hints) return null;
  return (
    <div className="hint-card" role="status" aria-live="polite" data-testid="hint-card">
      <p>
        <strong>{h.title}.</strong> {h.text}
      </p>
      <div className="row">
        {h.showMe && (
          <button className="primary" onClick={() => ctl.hintShowMe()} data-testid="hint-show-me">
            {h.showMe.label}
          </button>
        )}
        <button onClick={() => ctl.dismissHint()} data-testid="hint-dismiss">Got it</button>
        <button className="link" onClick={() => ctl.setPrefs({ hints: false })} title="Settings turns them back on">No more hints</button>
      </div>
    </div>
  );
}
