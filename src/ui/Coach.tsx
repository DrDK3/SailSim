import { useState } from 'react';
import type { SimController, UiState } from '../app/controller';

const MARK = { good: '✓', ok: '•', work: '!' } as const;
const VERDICT = { good: 'Went well', ok: 'All right', work: 'To work on' } as const;

/**
 * The race coach's card, under the race panel: the briefing before the start (open until the gun, then folded
 * away), and the debrief once you have finished. Training advice from rules of thumb, not an adjudication.
 */
export function CoachCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const c = ui.coach;
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const [all, setAll] = useState(false);
  if (!c || !c.on || !ui.race) return null;
  const preStart = ui.race.phase === 'pre-start';
  const d = c.debrief;
  const expanded = open ?? (preStart || !!d);
  // The briefing's first point, the rest a click away (the card stays small beside the view).
  const shown = all ? c.briefing : c.briefing.slice(0, 1);
  return (
    <section className="panel coach" aria-label="Race coach" data-testid="coach">
      <div className="row coach-head">
        <h3>{d ? 'Debrief' : 'Coach'}</h3>
        <button className="link" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>{expanded ? 'Hide' : d ? 'Show the debrief' : 'Show the briefing'}</button>
        <button className="link" onClick={() => ctl.toggleCoach(false)} title="Turn the coach off (Settings → Race coach turns it back on)">Off</button>
      </div>
      {expanded && !d && (
        <>
          <ul className="coach-list">
            {shown.map((b) => <li key={b}>{b}</li>)}
          </ul>
          {c.briefing.length > 1 && (
            <button className="link coach-more" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? 'Fewer' : `${c.briefing.length - 1} more point${c.briefing.length === 2 ? '' : 's'}`}
            </button>
          )}
        </>
      )}
      {expanded && d && (
        <>
          {d.focus && <p className="coach-focus"><strong>Next time, work on</strong> {d.focus}</p>}
          <ul className="coach-list debrief">
            {d.items.map((it, i) => (
              <li key={i} className={`v-${it.verdict}`}>
                <span className="mark" aria-label={VERDICT[it.verdict]} title={VERDICT[it.verdict]}>{MARK[it.verdict]}</span>
                <span><strong>{it.area}.</strong> {it.text}</span>
              </li>
            ))}
          </ul>
          <p className="fine">Judged against the app's model polar and the coach's rules of thumb (estimates), not measured Squib data.</p>
        </>
      )}
    </section>
  );
}

/** Whether the coach's latest tip is still showing (10 s after it is given). */
export function coachTipShowing(ui: UiState): boolean {
  const c = ui.coach;
  const tip = c?.on ? c.tips[0] : undefined;
  return !!tip && !!c && c.now - tip.t <= 10;
}

/** The coach's latest tip, for a few seconds after it is given. */
export function CoachTip({ ui }: { ui: UiState }) {
  const c = ui.coach;
  const tip = c?.on ? c.tips[0] : undefined;
  if (!tip || !c || !coachTipShowing(ui)) return null;
  return (
    <div className={`coach-tip tone-${tip.tone}`} role="status" aria-live="polite" data-testid="coach-tip">
      <span className="coach-tip-label">Coach</span> {tip.text}
    </div>
  );
}
