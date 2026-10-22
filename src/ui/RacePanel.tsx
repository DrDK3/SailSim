import type { RaceUi } from '../app/controller';
import type { RaceEvent } from '../sim/course/judge';

const STATUS: Record<RaceUi['courseStatus'], { label: string; cls: string }> = {
  simulated: { label: 'Simulated course', cls: 'warn' },
  'pending-check': { label: 'Club course: pending check', cls: 'warn' },
  verified: { label: 'Club course: verified', cls: 'good' },
};

function clock(s: number): string {
  const sign = s < 0 ? '−' : '';
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  return `${sign}${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

/** Event time relative to the start signal, to the hundredth of a second. */
function rel(t: number, start: number): string {
  const d = t - start;
  const a = Math.abs(d);
  const m = Math.floor(a / 60);
  return `${d < 0 ? '−' : '+'}${m}:${(a - m * 60).toFixed(2).padStart(5, '0')}`;
}

function describe(e: RaceEvent): { text: string; tone: 'good' | 'warn' | 'bad' | 'info' } {
  switch (e.type) {
    case 'signal': return { text: `${e.name === 'start' ? 'Start signal' : `${e.name[0]!.toUpperCase()}${e.name.slice(1)} signal`}`, tone: 'info' };
    case 'ocs': return { text: 'Over the line at the start (OCS): return to the pre-start side', tone: 'bad' };
    case 'ocs-cleared': return { text: 'Back behind the line: you may start', tone: 'warn' };
    case 'start': return { text: 'Started', tone: 'good' };
    case 'rounded': return { text: `Rounded ${e.label}`, tone: 'good' };
    case 'gate': return { text: `Through ${e.label}`, tone: 'good' };
    case 'wrong-side': return { text: `Wrong way round ${e.label}: unwind and go round correctly`, tone: 'bad' };
    case 'extra-loop': return { text: `Extra turn round ${e.label} (allowed)`, tone: 'info' };
    case 'rounding-undone': return { text: `Went back round ${e.label}: rounding undone`, tone: 'bad' };
    case 'out-of-order': return { text: `Passed ${e.label} out of order: does not count yet`, tone: 'warn' };
    case 'boundary': return { text: `Crossed the ${e.label}`, tone: 'bad' };
    case 'finish-incomplete': return { text: `Crossed the finish with ${e.remaining} leg${e.remaining === 1 ? '' : 's'} still to sail`, tone: 'bad' };
    case 'finish': return { text: 'Finished', tone: 'good' };
  }
}

export function RacePanel({ race }: { race: RaceUi }) {
  const st = STATUS[race.courseStatus];
  const start = race.startTime;
  const signalTime = race.events.find((e) => e.type === 'signal' && e.name === 'start')?.t;
  const t0 = signalTime ?? 0;
  return (
    <section className="panel race" aria-label="Race" data-testid="race-panel">
      <div className="race-head">
        <strong>{race.courseName}</strong>
        <span className={`status ${st.cls}`}>{st.label}</span>
      </div>
      {race.phase === 'pre-start' && (
        <div className="race-main">
          {race.toStart > 0 ? (
            <>
              <div className="cell-label">Start in</div>
              <div className="race-big" data-testid="countdown">{clock(race.toStart)}</div>
              {race.nextSignal && race.nextSignal !== 'start' && <div className="fine-inline">next: {race.nextSignal} signal</div>}
            </>
          ) : race.ocs ? (
            <div className="race-alert bad" role="alert">OCS: return completely to the pre-start side, then start</div>
          ) : (
            <div className="race-alert warn">Start signal made {clock(-race.toStart)} ago: cross the line to start</div>
          )}
        </div>
      )}
      {race.phase === 'racing' && (
        <div className="race-main">
          <div className="race-row">
            <span className="cell-label">Leg {Math.min(race.legIndex + 1, race.legCount)}/{race.legCount} · Lap {race.lap}/{race.laps}</span>
            <span className="race-elapsed" title="Time since the start signal">{start !== undefined ? clock(-race.toStart) : ''}</span>
          </div>
          <div className="race-next" data-testid="next-mark">Next: {race.nextLabel}</div>
          {race.nextDistance !== undefined && (
            <div className="fine-inline">{race.nextDistance.toFixed(0)} m, bearing {Math.round(race.nextBearingDeg ?? 0).toString().padStart(3, '0')}°</div>
          )}
        </div>
      )}
      {race.phase === 'finished' && race.finishTime !== undefined && (
        <div className="race-main">
          <div className="cell-label">Finished</div>
          <div className="race-big" data-testid="finish-time">{clock(race.finishTime - t0)}</div>
          <div className="fine-inline">from the start signal</div>
        </div>
      )}
      <ol className="race-events" aria-label="Race events">
        {race.events.filter((e) => e.type !== 'signal' || e.name === 'start').slice(-6).map((e, i) => {
          const d = describe(e);
          const when = 'time' in e ? e.time : e.t;
          return (
            <li key={`${e.t}-${i}`} className={`ev ${d.tone}`}>
              <span className="ev-t">{rel(when, t0)}</span> {d.text}
            </li>
          );
        })}
      </ol>
      {race.warnings.length > 0 && <p className="fine">{race.warnings.length} course warning{race.warnings.length === 1 ? '' : 's'}: {race.warnings[0]!.message}</p>}
      <p className="fine">Simplified racing rules: not an authoritative adjudication.</p>
    </section>
  );
}
