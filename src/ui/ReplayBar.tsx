import type { SimController, UiState } from '../app/controller';

const SPEEDS = [1, 2, 4, 8];

/** Shown instead of the sailing controls while a replay plays: progress, verification, speed, take over. */
export function ReplayBar({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const r = ui.replay!;
  const t = ui.snapshot.t;
  const verdict =
    r.state === 'diverged'
      ? `Diverged at ${r.divergedAtS?.toFixed(0)} s: this run no longer matches the recording.`
      : r.state === 'ended'
        ? r.checkpointsMatched === r.checkpointsTotal
          ? `Verified: all ${r.checkpointsTotal} checkpoints matched, bit for bit.`
          : `Ended: ${r.checkpointsMatched} of ${r.checkpointsTotal} checkpoints matched.`
        : `Matching: ${r.checkpointsMatched} of ${r.checkpointsTotal} checkpoints so far${r.verifiedToS ? ` (to ${r.verifiedToS.toFixed(0)} s)` : ''}.`;
  return (
    <section className="panel controls replay-bar" aria-label="Replay" data-testid="replay-bar">
      <div className="race-head">
        <strong>Replay: {r.title}</strong>
        <span className="fine" data-testid="replay-time">
          {t.toFixed(0)} / {r.endS.toFixed(0)} s
        </span>
      </div>
      <progress max={r.endS || 1} value={Math.min(t, r.endS)} aria-label="Replay progress" />
      <p className={r.state === 'diverged' ? 'fine warn-text' : 'fine'} role={r.state === 'diverged' ? 'alert' : 'status'} data-testid="replay-verdict" data-state={r.state}>
        {verdict}
      </p>
      {r.notes.map((n) => (
        <p key={n} className="fine warn-text">{n}</p>
      ))}
      <div className="row left wrap">
        <span className="fine">Speed</span>
        {SPEEDS.map((x) => (
          <button key={x} aria-pressed={ui.timeScale === x} onClick={() => ctl.setTimeScale(x)}>×{x}</button>
        ))}
        <button onClick={() => ctl.togglePause()} disabled={r.finished}>{ui.paused ? 'Resume' : 'Pause'}</button>
        <button className="primary" onClick={() => ctl.takeOver()} title="Stop the replay and sail on from here">Take over</button>
      </div>
    </section>
  );
}
