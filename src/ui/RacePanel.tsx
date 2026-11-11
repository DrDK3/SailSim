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

export function RacePanel({ race, ctl, caption }: { race: RaceUi; ctl: SimController; caption?: string }) {
  const st = STATUS[race.courseStatus];
  const start = race.startTime;
  const signalTime = race.events.find((e) => e.type === 'signal' && e.name === 'start')?.t;
  const t0 = signalTime ?? 0;
  return (
    <section className="panel race" aria-label="Race" data-testid="race-panel" data-tutorial="race">
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
      {/* The horn in words (GR-6): every sound signal has a caption while it sounds. */}
      <div className="sound-caption" role="status" aria-live="polite" data-testid="sound-caption">
        {caption && (
          <>
            <span aria-hidden="true">🔊</span> {caption}
          </>
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
              {race.line && <LineReadouts line={race.line} />}
            </>
          ) : race.ocs ? (
            <div className="race-alert bad" role="alert" data-testid="ocs-guide">
              <strong>Over the line at the start (OCS).</strong> Sail back until your hull is completely on the pre-start side of the line, round
              either end, then start.
              {race.ocsGuide && (
                <span className="ocs-dir">
                  <span className="ocs-arrow" aria-hidden="true" style={{ transform: `rotate(${Math.round(race.ocsGuide.relDeg)}deg)` }}>↑</span>
                  Nearer end: {race.ocsGuide.end}, {Math.round(race.ocsGuide.distanceM)} m, {race.ocsGuide.direction}.
                </span>
              )}
              {race.ocsGuide?.recallFlagDown && (
                <span className="ocs-late">
                  Flag X is down (rule 29.1). You can still come back and start, or retire.{' '}
                  <button className="link" onClick={() => ctl.retire()}>Retire</button>
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="race-alert warn">Start signal made {clock(-race.toStart)} ago: cross the line to start</div>
              {race.line && <LineReadouts line={race.line} />}
            </>
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
      {race.drill && <DrillCard drill={race.drill} ctl={ctl} />}
      {race.best && !race.drill?.last && (
        <div className="race-best" data-testid="race-best" role="status">
          {race.best.start && (
            <div>
              Start: {race.best.start.delayS.toFixed(1)} s after the signal
              {race.best.start.best ? (race.best.start.previousS !== undefined ? ` · your best start (was ${race.best.start.previousS.toFixed(1)} s)` : ' · your first start recorded') : ` · best ${race.best.start.previousS?.toFixed(1)} s`}
            </div>
          )}
          {race.best.finish && (
            <div>
              {race.best.finish.best
                ? race.best.finish.previousS !== undefined
                  ? `New personal best for ${race.best.finish.label} (was ${clock(race.best.finish.previousS)})`
                  : `Your first time on ${race.best.finish.label}`
                : `Your best on ${race.best.finish.label}: ${clock(race.best.finish.previousS ?? 0)}`}
            </div>
          )}
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
      {race.warnings.length > 0 && (
        <p className="fine race-warn" title={race.warnings.map((w) => w.message).join('\n')}>
          {race.warnings.length} course warning{race.warnings.length === 1 ? '' : 's'} (hover for details)
        </p>
      )}
      <div className="row">
        <button onClick={() => ctl.toggleResults()} disabled={!race.results} title={race.results ? 'Results table' : 'Results once you have finished'}>Results</button>
        <button onClick={() => ctl.retire()} disabled={race.phase === 'finished' || race.raceOver}>Retire</button>
      </div>
      <p className="fine">Simplified rules, not an authoritative adjudication; AI sail numbers invented.</p>
    </section>
  );
}

const KN = 0.514444;

/**
 * Where you are against the start line (src/app/startLine.ts): the distance, the time to it at your present
 * speed, the time to burn before the gun, and which end the wind favours.
 */
function LineReadouts({ line }: { line: NonNullable<RaceUi['line']> }) {
  const r = line.readout;
  const over = r.distanceM < 0;
  const motion = r.motion === 'holding' ? 'holding position' : r.motion === 'closing' ? `closing at ${(r.closingMs / KN).toFixed(1)} kn` : `opening at ${(-r.closingMs / KN).toFixed(1)} kn`;
  const b = line.bias;
  return (
    <div className="line-readouts" data-testid="line-readouts">
      <div className="line-cells">
        <div>
          <span className="cell-label">To the line</span>
          <span className="line-val" data-testid="line-distance">{over ? `${Math.round(-r.distanceM)} m over` : `${Math.round(r.distanceM)} m`}</span>
        </div>
        <div>
          <span className="cell-label">Time to it</span>
          <span className="line-val">{r.timeToLineS !== undefined && r.timeToLineS < 600 ? `${Math.round(r.timeToLineS)} s` : '—'}</span>
        </div>
        <div>
          <span className="cell-label">To burn</span>
          <span className={`line-val ${r.burnS !== undefined && r.burnS < 0 ? 'late' : ''}`} data-testid="line-burn">
            {r.burnS === undefined || r.timeToLineS === undefined || r.timeToLineS >= 600 ? '—' : r.burnS >= 0 ? `${Math.round(r.burnS)} s` : `${Math.round(-r.burnS)} s late`}
          </span>
        </div>
      </div>
      <div className="fine-inline">
        {r.withinEnds ? '' : 'Beyond the ends (to the nearer end) · '}
        {motion}
      </div>
      {b && (
        <div className="fine-inline" data-testid="line-bias">
          {b.favoured === undefined
            ? 'Line square to the wind'
            : `Favoured: ${line.ends[b.favoured]}, by ${b.lengths >= 0.95 ? `${Math.round(b.lengths)} boat length${Math.round(b.lengths) === 1 ? '' : 's'}` : `${Math.round(b.advantageM)} m`} (${Math.round(b.angleDeg)}°)`}
        </div>
      )}
    </div>
  );
}

/** A start drill: each start scored as it is made, then go again (the same start or a new wind). */
function DrillCard({ drill, ctl }: { drill: NonNullable<RaceUi['drill']>; ctl: SimController }) {
  const last = drill.last;
  return (
    <div className="drill-card" data-testid="drill" role="status">
      <div className="race-row">
        <strong>Start drill · start {drill.attempt}</strong>
        {drill.bestLateS !== undefined && <span className="fine-inline">best this session: {drill.bestLateS.toFixed(1)} s late</span>}
      </div>
      {last ? (
        <>
          <p data-testid="drill-verdict">{last.verdict}</p>
          <table className="drill-table">
            <tbody>
              <tr>
                <th scope="row">Crossed</th>
                <td>{last.ocs ? 'over at the gun (OCS)' : last.lateS === undefined ? 'not yet' : `${last.lateS.toFixed(1)} s after the gun`}</td>
              </tr>
              <tr>
                <th scope="row">At the gun</th>
                <td>
                  {last.atGunM >= 0 ? `${Math.round(last.atGunM)} m behind the line` : `${Math.round(-last.atGunM)} m over`}, {last.atGunKn.toFixed(1)} kn
                </td>
              </tr>
              {last.crossedAt !== undefined && (
                <tr>
                  <th scope="row">Where</th>
                  <td>{Math.round(last.crossedAt * 100)}% along the line{last.favouredThird === undefined ? '' : last.favouredThird ? ', the favoured end' : ', away from the favoured end'}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="row left">
            <button className="primary" onClick={() => ctl.drillAgain(false)} data-testid="drill-again">Same start again</button>
            <button onClick={() => ctl.drillAgain(true)}>New wind</button>
            <button onClick={() => ctl.endDrill()}>Race on</button>
          </div>
        </>
      ) : (
        <p className="fine">Scored once you have started, or half a minute after the gun.</p>
      )}
      {drill.history.length > 1 && (
        <p className="fine" data-testid="drill-history">
          Your starts: {drill.history.map((h) => (h.ocs ? 'OCS' : h.lateS === undefined ? '—' : `${h.lateS.toFixed(1)} s`)).join(' · ')}
        </p>
      )}
    </div>
  );
}
