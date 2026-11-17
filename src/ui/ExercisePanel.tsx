import { useEffect, useRef } from 'react';
import type { SimController, UiState } from '../app/controller';
import type { ExerciseId } from '../app/exercises/index';
import type { AttemptRecord } from '../app/exercises/engine';

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
              {r.observations.map((o) => (
                <li key={o.id}>
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
          {(s.review ?? []).map((i) => (
            <li key={i.id}>
              <strong>{i.observation}</strong>
              {i.cause && <> {i.cause}</>}
              {i.action && <> {i.action}</>}
            </li>
          ))}
        </ul>
        <p className="fine">{assistLine(s.records[s.attempt - 1])}</p>
        <div className="row left wrap">
          <button className="primary" onClick={() => ctl.exerciseNext()} data-testid="exercise-next">
            {s.attempt < s.attempts ? `Attempt ${s.attempt + 1}` : 'See the result'}
          </button>
          <button onClick={() => ctl.exerciseRestartAttempt()}>Try this attempt again</button>
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
      {s.help && (
        <div className={`exercise-help level-${s.help.level}`} role="status" data-testid="exercise-help" data-level={s.help.level}>
          <span className="help-level">
            {s.help.name} <span className="sr-only">(help level {s.help.level} of 3)</span>
          </span>
          <span>{s.help.text}</span>
        </div>
      )}
      <div className={`tutorial-goal ${s.done ? 'met' : ''}`} role="status" data-testid="exercise-goal">
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
      </div>
      {s.stage === 'attempt' && (
        <p className="fine" data-testid="exercise-assists">
          {s.independentSoFar ? 'On your own so far (no auto-trim, overlay or help).' : `Assisted: ${assistWords(s.assists).join(', ')}.`}
        </p>
      )}
      <div className="row left wrap">
        {s.stage === 'intro' ? (
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

function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The exercises on offer, for the lesson list (training slice). */
export function ExerciseList({ ui, onStart }: { ui: UiState; onStart: (id: ExerciseId) => void }) {
  return (
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
  );
}
