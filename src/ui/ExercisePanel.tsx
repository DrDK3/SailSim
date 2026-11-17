import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import type { ExerciseId } from '../app/exercises/index';
import type { AttemptRecord, ReviewChart } from '../app/exercises/engine';

/**
 * An exercise's card (training slice §7–§8): the phase and its goal, the help on show with its level in words
 * (Look / Why / Try: never colour alone), what assistance this attempt has had, and Help, Restart attempt, overlay
 * and End. After each attempt, the review: what was observed, its likely cause and what to try next. At the end,
 * the result with assisted and independent attempts apart. Everything here is rules-based text (no generated prose).
 */
export function ExercisePanel({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const x = ui.exercise!;
  const s = x.state;
  const heading = useRef<HTMLHeadingElement>(null);
  const targets = s.stage === 'attempt' || s.stage === 'intro' ? (s.phase?.targets ?? []) : [];

  // Outline the parts of the screen the phase and its help are about (elements marked data-tutorial="…").
  useEffect(() => {
    const els = targets.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${id}"]`)]);
    els.forEach((el) => el.classList.add('tutorial-target'));
    return () => els.forEach((el) => el.classList.remove('tutorial-target'));
  }, [targets.join(',')]);

  // Announce each new phase, review and result to screen readers by moving focus to its title.
  useEffect(() => heading.current?.focus(), [s.stage, s.attempt, s.phase?.id]);

  const head = (
    <div className="tutorial-head">
      <span className="fine">
        Exercise · {x.info.title}
        {s.stage === 'attempt' && ` · attempt ${s.attempt} of ${s.attempts}`}
        {s.stage === 'review' && ` · attempt ${s.attempt} of ${s.attempts} done`}
      </span>
      <button className="link" onClick={() => ctl.endExercise()} aria-label="End the exercise">
        End
      </button>
    </div>
  );
  const status = (
    <p className="fine exercise-status" data-testid="exercise-status">
      Content: {x.status}. Thresholds provisional (E){x.thresholdsChanged ? ', changed for this browser by an instructor' : ''}.
    </p>
  );

  if (s.stage === 'result' && s.result) {
    const r = s.result;
    return (
      <section className="panel tutorial result exercise" aria-label="Exercise result" data-testid="exercise">
        {head}
        <h3 ref={heading} tabIndex={-1} data-testid="exercise-title">
          ✓ {x.info.title}: done
        </h3>
        <div className="exercise-groups">
          {[r.assisted, r.independent].map((g, i) => (
            <div key={i} className="exercise-group" data-testid={i === 0 ? 'result-assisted' : 'result-independent'}>
              <ul className="lesson-result">
                {g.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {r.observations.length > 0 && (
          <>
            <h4>What we saw</h4>
            <ul className="lesson-result" data-testid="result-observations">
              {r.observations.map((o, i) => (
                <li key={`${o.id}-${i}`}>
                  {o.observation}
                  {o.cause && <span className="fine-inline"> {o.cause}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p data-testid="result-next">
          <strong>Next:</strong> {r.nextAction.replace(/^Next( time)?: /, '')}
        </p>
        {s.extras?.chart && <TrackChart chart={s.extras.chart} />}
        <AttemptTable records={s.records} />
        {r.notes.map((n) => (
          <p key={n} className="fine">
            {n}
          </p>
        ))}
        <p className="fine">{x.saved === false ? 'This browser does not allow saving records: this result is not kept.' : 'Kept in this browser only. Save the records as a file to show an instructor.'}</p>
        <div className="row left wrap">
          <button className="primary" onClick={() => ctl.startExercise(x.info.id as ExerciseId)}>
            Repeat
          </button>
          <button onClick={() => downloadText(ctl.exportExerciseRecords(), 'squib-exercise-records.json')} data-testid="exercise-export">
            Save records (file)
          </button>
          <button onClick={() => ctl.toggleDebrief(true)}>Your sail</button>
          <button onClick={() => ctl.endExercise()}>Sail on freely</button>
        </div>
      </section>
    );
  }

  if (s.stage === 'review') {
    return (
      <section className="panel tutorial exercise" aria-label="Attempt review" data-testid="exercise">
        {head}
        <h3 ref={heading} tabIndex={-1} data-testid="exercise-title">
          Attempt {s.attempt}: how it went
        </h3>
        <ul className="lesson-result" data-testid="exercise-review">
          {(s.review ?? []).map((i, n) => (
            <li key={`${i.id}-${n}`}>
              <strong>{i.observation}</strong>
              {i.cause && <> {i.cause}</>}
              {i.action && <> {i.action}</>}
            </li>
          ))}
        </ul>
        {s.extras?.chart && <TrackChart chart={s.extras.chart} />}
        <p className="fine">{assistLine(s.records[s.attempt - 1])}</p>
        <div className="row left wrap">
          <button className="primary" onClick={() => ctl.exerciseNext()} data-testid="exercise-next">
            {s.attempt < s.attempts ? `Attempt ${s.attempt + 1}` : 'See the result'}
          </button>
          <button onClick={() => ctl.exerciseRestartAttempt()}>Try this attempt again</button>
          <button
            onClick={() => downloadText(JSON.stringify(ctl.saveRecording(`${x.info.title}: attempt ${s.attempt}`)), `squib-exercise-attempt-${s.attempt}.replay.json`)}
            title="This attempt as a replay file (from its start): open it in Library to watch it or race it as a ghost"
            data-testid="exercise-save-replay"
          >
            Save this attempt (replay)
          </button>
        </div>
      </section>
    );
  }

  const ph = s.phase!;
  return (
    <section className="panel tutorial exercise" aria-label="Exercise" data-testid="exercise">
      {head}
      {s.stage === 'attempt' && (
        <div className="tutorial-dots" aria-hidden="true">
          {Array.from({ length: ph.count }, (_, i) => (
            <span key={i} className={i < ph.index ? 'dot past' : i === ph.index ? 'dot now' : 'dot'} />
          ))}
        </div>
      )}
      <h3 ref={heading} tabIndex={-1} data-testid="exercise-title">
        {ph.title}
      </h3>
      {s.stage === 'attempt' && <p className="fine" data-testid="exercise-plan">{s.plan.label}</p>}
      <p>{ph.body}</p>
      {s.readout && (
        <p className="lesson-readout" data-testid="exercise-readout">
          {s.readout}
        </p>
      )}
      {s.extras?.headingHistory && s.extras.headingHistory.length > 1 && <HeadingHistory values={s.extras.headingHistory} />}
      {s.help && (
        <div className={`exercise-help level-${s.help.level}`} role="status" data-testid="exercise-help" data-level={s.help.level}>
          <span className="help-level">
            {s.help.name} <span className="sr-only">(help level {s.help.level} of 3)</span>
          </span>
          <span>{s.help.text}</span>
        </div>
      )}
      {!(s.stage === 'intro' && s.extras?.predictions) && <div className={`tutorial-goal ${s.done ? 'met' : ''}`} role="status" data-testid="exercise-goal">
        {s.done ? (
          '✓ Done: moving on…'
        ) : ph.durationS ? (
          <>
            <span>Warm-up: {Math.round(s.progress * ph.durationS)} of {ph.durationS} s</span>
            <progress max={1} value={s.progress} aria-label="Warm-up time" />
          </>
        ) : ph.holdS ? (
          <>
            <span>Hold it: {Math.round(s.progress * ph.holdS)} of {ph.holdS} s</span>
            <progress max={1} value={s.progress} aria-label="Goal held" />
          </>
        ) : (
          'Waiting for you…'
        )}
      </div>}
      {s.stage === 'attempt' && (
        <p className="fine" data-testid="exercise-assists">
          {s.independentSoFar ? 'On your own so far (no auto-trim, overlay or help).' : `Assisted: ${assistWords(s.assists).join(', ')}.`}
        </p>
      )}
      <div className="row left wrap">
        {s.stage === 'intro' && s.extras?.predictions ? (
          <>
            {s.extras.predictions.map((p) => (
              <button key={p.id} onClick={() => ctl.exercisePredict(p.id)} data-testid={`predict-${p.id}`}>
                {p.label}
              </button>
            ))}
            <button className="link" onClick={() => ctl.exerciseNext()} data-testid="exercise-next">
              Skip and start
            </button>
          </>
        ) : s.stage === 'intro' ? (
          <button className="primary" onClick={() => ctl.exerciseNext()} data-testid="exercise-next">
            Start
          </button>
        ) : (
          <>
            <button onClick={() => ctl.exerciseHelp()} disabled={!s.canAskHelp} data-testid="exercise-help-button">
              Help
            </button>
            <button onClick={() => ctl.exerciseRestartAttempt()} data-testid="exercise-restart">
              Restart attempt
            </button>
            <button onClick={() => ctl.exerciseNext()}>Skip step</button>
          </>
        )}
        <label className="toggle" title="The wind arrows in the 3D view (counts as assistance while shown)">
          <input type="checkbox" checked={x.overlay} onChange={(e) => ctl.setExerciseOverlay(e.target.checked)} data-testid="exercise-overlay" />
          <span>Overlay</span>
        </label>
      </div>
      {status}
    </section>
  );
}

function assistWords(a: AttemptRecord['assists']): string[] {
  const out: string[] = [];
  if (a.autoMain) out.push('auto main');
  if (a.autoJib) out.push('auto jib');
  if (a.overlay) out.push('overlay');
  if (a.liveHelp) out.push('help');
  return out.length ? out : ['none'];
}

function assistLine(r: AttemptRecord | undefined): string {
  if (!r) return '';
  return r.independent ? 'This attempt was independent: no auto-trim, overlay or live help.' : `This attempt was assisted: ${assistWords(r.assists).join(', ')}.`;
}

/** Each attempt's assistance and outcome: the record an instructor sees. */
function AttemptTable({ records }: { records: AttemptRecord[] }) {
  return (
    <table className="exercise-table" data-testid="exercise-attempts">
      <caption className="sr-only">Attempts, their assistance and outcome</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Tack</th>
          <th scope="col">Assistance</th>
          <th scope="col">Help (look / why / try)</th>
          <th scope="col">Outcome</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.n}>
            <td>{r.n}</td>
            <td>{r.plan.tack === 1 ? 'Starboard' : 'Port'}</td>
            <td>{r.independent ? 'Independent' : assistWords(r.assists).join(', ')}</td>
            <td>
              {r.help[1]} / {r.help[2]} / {r.help[3]}
              {r.help.requested ? ` (${r.help.requested} asked)` : ''}
            </td>
            <td>{r.outcome === 'complete' ? 'Complete' : 'Incomplete'}{r.restarts ? ` (${r.restarts} restart${r.restarts > 1 ? 's' : ''})` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The heading over the last minutes (one point a second): a header shows as a step. Text gives the range too. */
function HeadingHistory({ values }: { values: number[] }) {
  // Unwrap through north so a turn past 360° does not jump.
  const un: number[] = [];
  for (const v of values) {
    const prev = un[un.length - 1];
    un.push(prev === undefined ? v : prev + ((((v - prev) % 360) + 540) % 360) - 180);
  }
  const lo = Math.min(...un);
  const hi = Math.max(...un);
  const span = Math.max(20, hi - lo);
  const mid = (hi + lo) / 2;
  const W = 240;
  const H = 44;
  const pts = un.map((v, i) => `${((i / Math.max(1, un.length - 1)) * W).toFixed(1)},${(H / 2 - ((v - mid) / span) * (H - 6)).toFixed(1)}`).join(' ');
  const now = ((Math.round(values[values.length - 1]!) % 360) + 360) % 360;
  return (
    <figure className="heading-history" data-testid="heading-history">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Heading history over the last ${values.length} s: now ${now}°, lowest ${Math.round(lo)}°, highest ${Math.round(hi)}°`}>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <figcaption className="fine">Heading, last {values.length} s: now {now}° (range {Math.round(hi - lo)}°)</figcaption>
    </figure>
  );
}

const TRACK_STYLE: Record<string, { dash?: string; cls: string }> = {
  you: { cls: 'track-you' },
  tack: { dash: '6 4', cls: 'track-model-a' },
  hold: { dash: '2 4', cls: 'track-model-b' },
};

/** The review's map: your track and the model demonstrations', north up, labelled in words (and dash patterns). */
function TrackChart({ chart }: { chart: ReviewChart }) {
  const all = [chart.mark, chart.start, ...chart.tracks.flatMap((t) => t.points)];
  const ns = all.map((p) => p[0]);
  const es = all.map((p) => p[1]);
  const pad = 30;
  const nMin = Math.min(...ns) - pad;
  const nMax = Math.max(...ns) + pad;
  const eMin = Math.min(...es) - pad;
  const eMax = Math.max(...es) + pad;
  const W = 260;
  const scale = W / Math.max(eMax - eMin, nMax - nMin);
  const H = Math.round((nMax - nMin) * scale);
  const xy = (p: [number, number]) => `${((p[1] - eMin) * scale).toFixed(1)},${((nMax - p[0]) * scale).toFixed(1)}`;
  const [mx, my] = xy(chart.mark).split(',').map(Number);
  const [sx, sy] = xy(chart.start).split(',').map(Number);
  return (
    <figure className="track-chart" data-testid="exercise-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Map of the beat: ${chart.tracks.map((t) => `${t.label}${t.timeS !== undefined ? ` ${Math.round(t.timeS)} s` : ''}`).join('; ')}`}>
        {chart.tracks.map((t) => (
          <polyline key={t.id} className={TRACK_STYLE[t.id]?.cls} points={t.points.map(xy).join(' ')} fill="none" strokeWidth={t.id === 'you' ? 2.5 : 1.8} strokeDasharray={TRACK_STYLE[t.id]?.dash} />
        ))}
        <circle cx={mx} cy={my} r={5} className="chart-mark" />
        <text x={mx! + 7} y={my! + 4} className="chart-label">Mark</text>
        <text x={sx! + 6} y={sy! + 4} className="chart-label">Start</text>
      </svg>
      <figcaption>
        <ul className="chart-legend">
          {chart.tracks.map((t) => (
            <li key={t.id}>
              <svg width="26" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="26" y2="4" className={TRACK_STYLE[t.id]?.cls} strokeWidth="2.5" strokeDasharray={TRACK_STYLE[t.id]?.dash} />
              </svg>{' '}
              {t.label}
              {t.timeS !== undefined ? `: ${Math.round(t.timeS)} s` : ': mark not reached'}
            </li>
          ))}
        </ul>
        <span className="fine">{chart.note} North is up.</span>
      </figcaption>
    </figure>
  );
}

function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The exercises on offer, for the lesson list (training slice), and an instructor's tools. */
export function ExerciseList({ ui, onStart, ctl }: { ui: UiState; onStart: (id: ExerciseId) => void; ctl?: SimController }) {
  return (
    <>
    <ol className="lesson-list" data-testid="exercise-list">
      {ui.exercises.map((e, i) => (
        <li key={e.id}>
          <span className="lesson-tick" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
          <span className="lesson-text">
            <strong>{e.title}</strong>
            <span className="fine-inline">
              {' '}
              · {e.level} · about {e.minutes} min{e.runs ? ` · ${e.runs} run${e.runs > 1 ? 's' : ''} kept` : ''}
            </span>
            <span className="lesson-summary">{e.summary}</span>
          </span>
          <button onClick={() => onStart(e.id)} aria-label={`Start exercise: ${e.title}`}>
            Start
          </button>
        </li>
      ))}
    </ol>
    {ctl && <InstructorTools ctl={ctl} />}
    </>
  );
}

/**
 * For an instructor: the thresholds as a file (to change and load back, for this browser only), the learner's
 * records as a file, and a link that opens an exercise directly. Nothing is uploaded anywhere.
 */
function InstructorTools({ ctl }: { ctl: SimController }) {
  const [msg, setMsg] = useState<string>();
  const load = (onText: (t: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => void input.files?.[0]?.text().then(onText);
    input.click();
  };
  return (
    <details className="instructor-tools" data-testid="instructor-tools">
      <summary>For instructors</summary>
      <p className="fine">
        Thresholds are provisional (E). Change them for this browser with a thresholds file; results then say so. Records and links stay on this device unless you send them.
      </p>
      <div className="row left wrap">
        <button onClick={() => downloadText(ctl.exportThresholds(), 'squib-exercise-thresholds.json')}>Save thresholds (file)</button>
        <button onClick={() => load((t) => setMsg(ctl.importThresholds(t)))}>Load thresholds (file)</button>
        <button onClick={() => setMsg(ctl.resetExerciseThresholds())}>Shipped thresholds</button>
        <button onClick={() => downloadText(ctl.exportExerciseRecords(), 'squib-exercise-records.json')}>Save learner records (file)</button>
        <button
          onClick={() =>
            load((t) => {
              const r = ctl.importExerciseRecords(t);
              setMsg(r.error ?? `${r.added} run${r.added === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} already here or not valid` : ''}.`);
            })
          }
        >
          Load learner records (file)
        </button>
      </div>
      <p className="fine">Link to open an exercise directly: add <code>?exercise=tack-recover</code> or <code>?exercise=wind-shift</code> to the address.</p>
      {msg && (
        <p className="fine" role="status">
          {msg}
        </p>
      )}
    </details>
  );
}
