import { useEffect, useRef, useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import type { Attempt } from '../app/bests';
import { ADJECTIVES, CREATURES, nameFrom, nameParts } from '../app/safeNames';
import { MEDALS, type Medal } from '../app/targets';
import { useModal } from './useModal';
import { SHARE_MAX_CHARS } from '../app/shareLink';
import { ClubTableSection, ClubSubmit } from './ClubTable';

/** m:ss.s */
export function clockS(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * Recent attempts on one course, as a small line chart (time against attempt), independent and assisted marked with
 * different shapes as well as colours (no meaning by colour alone). Lower is faster.
 */
export function ProgressChart({ history }: { history: readonly Attempt[] }) {
  if (history.length < 2) return null;
  const w = 220;
  const h = 64;
  const ts = history.map((a) => a.timeS);
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const x = (i: number) => 8 + (i * (w - 16)) / (history.length - 1);
  const y = (t: number) => (hi === lo ? h / 2 : 6 + ((t - lo) * (h - 12)) / (hi - lo));
  return (
    <figure className="progress-chart" data-testid="progress-chart">
      <svg width={w} height={h} role="img" aria-label={`Your last ${history.length} times on this course, from ${clockS(ts[0]!)} to ${clockS(ts[ts.length - 1]!)}; best ${clockS(lo)}`}>
        <polyline fill="none" stroke="currentColor" strokeOpacity={0.5} points={history.map((a, i) => `${x(i)},${y(a.timeS)}`).join(' ')} />
        {history.map((a, i) =>
          a.independent ? (
            <circle key={i} cx={x(i)} cy={y(a.timeS)} r={3.5} fill="var(--accent)" />
          ) : (
            <rect key={i} x={x(i) - 3} y={y(a.timeS) - 3} width={6} height={6} fill="none" stroke="currentColor" />
          ),
        )}
      </svg>
      <figcaption className="fine">Your last {history.length} times (higher on the chart is faster): ● on your own, □ with assists.</figcaption>
    </figure>
  );
}

/** This week's course: the card in the race set-up (layer A works with no server at all). */
export function WeeklyCard({ ctl, ui, onStarted }: { ctl: SimController; ui: UiState; onStarted: () => void }) {
  const s = ui.social;
  const w = s.weekly;
  useEffect(() => {
    void ctl.social.loadTargets();
  }, [ctl, w.week]);
  const t = s.targets;
  const best = w.best;
  return (
    <div className="challenge weekly" data-testid="weekly-card">
      <div>
        <strong>This week’s course</strong> <span className="fine-inline">· {w.week}</span>
        <p className="fine">
          <strong>{w.name}</strong>
          {w.status ? ` (${w.status})` : ''}: {w.summary}. The same course and wind for everyone until Sunday night.
        </p>
        <ul className="fine terms">
          <li>Boat: {w.terms.boat}. Damage: {w.terms.damage}.</li>
          <li>Tidal stream: {w.terms.stream}.</li>
          <li>Assists: {w.terms.assists}.</li>
          <li>{w.terms.fleet[0]!.toUpperCase() + w.terms.fleet.slice(1)}.</li>
        </ul>
        {t.state === 'ok' ? (
          <div className="targets" data-testid="weekly-targets">
            <span className="fine">Model-sailed targets (the simulator’s AI, not people; updated {ageText(t.ageMin)}):</span>
            {MEDALS.map((m) => {
              const x = t.file.targets.find((q) => q.medal === m);
              return x ? (
                <button key={m} onClick={() => ctl.leaveTo('Racing a target', () => ctl.social.raceTarget(m as Medal) && onStarted())} title={`Race the ${x.level} AI’s ghost: a recording, it does not react`}>
                  {m[0]!.toUpperCase() + m.slice(1)} {clockS(x.timeS)}
                </button>
              ) : null;
            })}
          </div>
        ) : (
          <p className="fine" data-testid="weekly-targets-unavailable">{t.state === 'loading' ? 'Looking for this week’s targets…' : `Targets not available this week (${t.reason}). You can still sail the course and set your own best.`}</p>
        )}
        {best && (
          <p className="fine" data-testid="weekly-best">
            Your bests this week: on your own {best.independent ? clockS(best.independent.timeS) : '—'}, with assists {best.assisted ? clockS(best.assisted.timeS) : '—'}.
          </p>
        )}
        {best && <ProgressChart history={best.history} />}
        <ClubTableSection ctl={ctl} ui={ui} />
      </div>
      <button className="primary" onClick={() => ctl.leaveTo('Sailing this week’s course', () => ctl.social.sailWeekly() && onStarted())} data-testid="weekly-start">
        Sail it
      </button>
    </div>
  );
}

const ageText = (min: number) => (min < 60 ? `${min} minutes ago` : min < 48 * 60 ? `${Math.round(min / 60)} hours ago` : `${Math.round(min / 1440)} days ago`);

/** The word-list name: pick each part or roll again. Never free text. */
export function NameChooser({ ctl, name }: { ctl: SimController; name: string }) {
  const p = nameParts(name) ?? { adjective: ADJECTIVES[0], creature: CREATURES[0], number: 1 };
  const set = (a: string, c: string, n: number) => ctl.social.setName(nameFrom(ADJECTIVES.indexOf(a as (typeof ADJECTIVES)[number]), CREATURES.indexOf(c as (typeof CREATURES)[number]), n));
  return (
    <div className="name-chooser row left wrap" data-testid="name-chooser">
      <span className="fine">Your name for challenges:</span>
      <select aria-label="Name: first word" value={p.adjective} onChange={(e) => set(e.target.value, p.creature, p.number)}>
        {ADJECTIVES.map((a) => <option key={a}>{a}</option>)}
      </select>
      <select aria-label="Name: sea creature" value={p.creature} onChange={(e) => set(p.adjective, e.target.value, p.number)}>
        {CREATURES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select aria-label="Name: number" value={p.number} onChange={(e) => set(p.adjective, p.creature, Number(e.target.value))}>
        {Array.from({ length: 99 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
      </select>
      <button onClick={() => ctl.social.rerollName()} data-testid="name-reroll">Roll again</button>
    </div>
  );
}

/** After a finish: the result against a challenge, the like-for-like best, and "Challenge a friend". */
export function SocialResult({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const s = ui.social;
  const f = s.finish;
  const [link, setLink] = useState<string>();
  if (!f && !s.result) return null;
  return (
    <section className="panel social-result" aria-label="Your finish" data-testid="social-result">
      {s.result && (
        <div role="status" data-testid="challenge-result">
          <strong>{s.result.headline}</strong>
          {s.result.detail && <p className="fine">{s.result.detail}</p>}
          <table className="splits">
            <thead>
              <tr><th>Mark</th><th>You</th><th>{s.racing?.name ?? 'Them'}</th><th>On the leg</th></tr>
            </thead>
            <tbody>
              {s.result.legs.map((l) => (
                <tr key={l.label}>
                  <td>{l.label}</td>
                  <td>{l.mine !== undefined ? clockS(l.mine) : '—'}</td>
                  <td>{clockS(l.theirs)}</td>
                  <td>{l.gained === undefined ? '' : l.gained >= 0 ? `you gained ${l.gained.toFixed(1)} s` : `you lost ${(-l.gained).toFixed(1)} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">Their boat was a ghost: a recording of how they sailed, which does not react to you.</p>
        </div>
      )}
      {f && (
        <>
          <p>
            {f.label}: <strong>{clockS(f.timeS)}</strong> ({f.assist.independent ? 'on your own' : `with assists: ${assistList(f.assist.assists)}`})
            {f.best?.best ? ' · a new best!' : f.best?.previousS !== undefined ? ` · your best ${clockS(f.best.previousS)}` : ''}
          </p>
          <NameChooser ctl={ctl} name={s.name} />
          <div className="row left">
            <button
              data-testid="challenge-link"
              onClick={() =>
                void ctl.social.challengeLink(location.href).then((u) => {
                  if (!u) return;
                  setLink(u);
                  if (u.length <= SHARE_MAX_CHARS) void navigator.clipboard?.writeText(u).catch(() => undefined);
                })
              }
            >
              Challenge a friend
            </button>
          </div>
          {link && link.length > SHARE_MAX_CHARS && (
            <p className="fine" role="status" data-testid="challenge-link-too-long">
              This run is too long to fit in a link ({Math.round(link.length / 1000)} thousand characters). Save it instead (Library → Save replay) and send the file: your friend opens it to race it as a ghost.
            </p>
          )}
          {link && link.length <= SHARE_MAX_CHARS && (
            <p className="fine" data-testid="challenge-link-ready">
              Link copied: send it to a friend. It holds your run and your name ({s.name}) and nothing else; opening it uploads nothing. {link.length > 8000 ? 'It is long: some messaging apps may cut it short.' : ''}
            </p>
          )}
          <ClubSubmit ctl={ctl} ui={ui} />
        </>
      )}
    </section>
  );
}

const assistList = (a: UiState['social']['assist']['assists']) =>
  [a.autoMain && 'auto-trim main', a.autoJib && 'auto-trim jib', a.overlay && 'teaching overlay', a.liveHelp && 'live help'].filter(Boolean).join(', ') || 'none';

/** A challenge link was opened: who, where, their time; accept or not. */
export function ChallengeCard({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  return ui.social.invite || ui.social.error ? <ChallengeDialog ctl={ctl} ui={ui} /> : null;
}

function ChallengeDialog({ ctl, ui }: { ctl: SimController; ui: UiState }) {
  const s = ui.social;
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, () => ctl.social.declineChallenge());
  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-label="A challenge" data-testid="challenge-card">
      <section className="panel challenge-card">
        {s.invite ? (
          <>
            <h3>{s.invite.name} challenges you</h3>
            <p>
              <strong>{s.invite.course}</strong>: their time {clockS(s.invite.finishS)} ({s.invite.independent ? 'on their own' : 'with assists'}).
            </p>
            <p className="fine">
              You will sail the same course in the same wind, with their boat as a ghost: a recording of how they sailed, which does not react to you
              and cannot touch you. Nothing is sent anywhere.
            </p>
            <div className="row">
              <button className="primary" onClick={() => ctl.social.acceptChallenge()} data-testid="challenge-accept">Race it</button>
              <button onClick={() => ctl.social.declineChallenge()}>Not now</button>
            </div>
          </>
        ) : (
          <>
            <h3>This challenge link cannot be opened</h3>
            <p>{s.error}</p>
            <button onClick={() => ctl.social.declineChallenge()}>Close</button>
          </>
        )}
      </section>
    </div>
  );
}
