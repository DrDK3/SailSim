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
  if (!c || !c.on || !ui.race) return null;
  const preStart = ui.race.phase === 'pre-start';
  const d = c.debrief;
  const expanded = open ?? (preStart || !!d);
  return (
    <section className="panel coach" aria-label="Race coach" data-testid="coach">
      <div className="row coach-head">
        <h3>{d ? 'Debrief' : 'Coach'}</h3>
        <button className="link" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>{expanded ? 'Hide' : d ? 'Show the debrief' : 'Show the briefing'}</button>
        <button className="link" onClick={() => ctl.toggleCoach(false)} title="Turn the coach off (More → Race coach turns it back on)">Off</button>
      </div>
      {expanded && !d && (
        <ul className="coach-list">
          {c.briefing.map((b) => <li key={b}>{b}</li>)}
        </ul>
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

/** The coach's latest tip, for a few seconds after it is given. */
export function CoachTip({ ui }: { ui: UiState }) {
  const c = ui.coach;
  const tip = c?.on ? c.tips[0] : undefined;
  if (!tip || !c || c.now - tip.t > 10) return null;
  return (
    <div className={`coach-tip tone-${tip.tone}`} role="status" aria-live="polite" data-testid="coach-tip">
      <span className="coach-tip-label">Coach</span> {tip.text}
    </div>
  );
}
