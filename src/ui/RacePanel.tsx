import type { RaceUi, SimController } from '../app/controller';
import type { RaceEvent } from '../sim/course/judge';
import type { Flag } from '../sim/race/committee';

/** Flags as text chips (never colour alone). */
const FLAGS: Record<Flag, { label: string; title: string; cls: string }> = {
  class: { label: 'Class', title: 'Class flag: warning signal made, the sequence is running', cls: 'flag-class' },
  P: { label: 'P', title: 'Flag P: preparatory signal (no special starting penalty)', cls: 'flag-p' },
  U: { label: 'U', title: 'Flag U (rule 30.3): in the triangle (line ends and first mark) during the last minute = disqualified', cls: 'flag-u' },
  black: { label: 'Black', title: 'Black flag (rule 30.4): in the triangle during the last minute = disqualified, also from a restart', cls: 'flag-black' },
  X: { label: 'X', title: 'Flag X (rule 29.1): individual recall, boats over early must return', cls: 'flag-x' },
  'first-substitute': { label: '1st Sub', title: 'First Substitute (rule 29.2): general recall, new start to come', cls: 'flag-fs' },
};

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

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

export function RacePanel({ race, ctl }: { race: RaceUi; ctl: SimController }) {
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
      <div className="race-flags" aria-label="Flags displayed" data-testid="flags">
        {race.flags.length === 0 ? <span className="fine-inline">No flags</span> : race.flags.map((f) => (
          <span key={f} className={`flag ${FLAGS[f].cls}`} title={FLAGS[f].title}>{FLAGS[f].label}</span>
        ))}
        {race.attempt > 1 && <span className="fine-inline">start {race.attempt}</span>}
        {race.position !== undefined && race.phase !== 'pre-start' && (
          <span className="race-pos" data-testid="position">{ordinal(race.position)} of {race.fleetSize}</span>
        )}
      </div>
      {race.disqualified && <div className="race-alert bad" role="alert">{race.disqualified}</div>}
      {race.penaltyOwed > 0 && (
        <div className="race-alert warn" role="alert" data-testid="penalty">
          Penalty owed: {race.penaltyOwed} turn{race.penaltyOwed === 1 ? '' : 's'}. Get clear of other boats, then turn in one direction, each turn with a tack and a gybe (rule 44.2).
        </div>
      )}
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
      {race.fleetSize > 1 && race.log.length > 0 && (
        <ol className="race-events race-log" aria-label="Fleet events">
          {race.log.slice(-4).map((l, i) => (
            <li key={`${l.t}-${i}`} className={`ev ${l.kind === 'incident' ? 'bad' : l.kind === 'penalty' ? 'warn' : 'info'}`}>
              <span className="ev-t">{rel(l.t, t0)}</span> {l.text}
            </li>
          ))}
        </ol>
      )}
      {race.warnings.length > 0 && <p className="fine">{race.warnings.length} course warning{race.warnings.length === 1 ? '' : 's'}: {race.warnings[0]!.message}</p>}
      <div className="row">
        <button onClick={() => ctl.toggleResults()} disabled={!race.results} title={race.results ? 'Results table' : 'Results once you have finished'}>Results</button>
        <button onClick={() => ctl.retire()} disabled={race.phase === 'finished' || race.raceOver}>Retire</button>
      </div>
      <p className="fine">Simplified racing rules: not an authoritative adjudication. AI boats and their sail numbers are invented.</p>
    </section>
  );
}
