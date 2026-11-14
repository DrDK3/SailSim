import { useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { DEFAULT_QUICK_RACE, QUICK_WIND_KN, SHORT_COURSE_LEG_M, dailyChallenge, type QuickCourse, type QuickRaceOptions } from '../app/quickRace';
import { freshLiveWeather } from '../app/liveNow';
import { allCourses, PRACTICE_KINDS } from '../app/courseLibrary';
import { loadBests } from '../app/bests';
import { mmss } from '../app/lessons';
import type { AiLevel } from '../sim/ai/skipper';
import type { PrepFlag } from '../sim/race/committee';

const KEY = 'squib.quickRace.v1';

/** The saved choice, else the defaults: live conditions now when the site has a forecast covering now. */
function loadOptions(liveNow: boolean): QuickRaceOptions {
  const base: QuickRaceOptions = { ...DEFAULT_QUICK_RACE, conditions: liveNow ? 'live' : DEFAULT_QUICK_RACE.conditions };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = { ...base, ...(JSON.parse(raw) as Partial<QuickRaceOptions>) };
      delete o.challenge;
      return o;
    }
  } catch {
    // Storage unavailable or the saved choice unreadable: the defaults.
  }
  return base;
}

/**
 * Where to race, first and in plain view (owner review, 5 Nov 2026: Start Bay had gone from sight inside a
 * list of courses): open water in Start Bay, the river, an RDYC club course, or a course from the library.
 */
const VENUES: { v: QuickRaceOptions['venue']; label: string; hint: string; needsDart?: boolean }[] = [
  { v: 'start-bay', label: 'Start Bay', hint: 'Open water off Dartmouth: a course laid to the wind, from the five-minute short course up' },
  { v: 'river', label: 'The river', hint: 'The Range, off Dart Marina', needsDart: true },
  { v: 'rdyc', label: 'RDYC course', hint: 'A Royal Dart Yacht Club course in Start Bay for the wind', needsDart: true },
  { v: 'library', label: 'Library', hint: 'A ready-made course, or one of your own' },
];

/**
 * The race set-up (review U4): every race option in one place (the Options panel no longer has its own), with
 * today's challenge and your bests.
 */
export function QuickRacePanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [o, setO] = useState<QuickRaceOptions>(() => loadOptions(!!freshLiveWeather(ui.weatherSources)));
  const [message, setMessage] = useState<string>();
  const set = (patch: Partial<QuickRaceOptions>) => setO({ ...o, ...patch });
  const live = ui.weatherSources.some((w) => w.kind === 'live');
  const liveTide = ui.tideSources.some((t) => t.kind === 'live');
  const river = ui.dart.status === 'loaded';
  const challenge = dailyChallenge();
  const bests = loadBests();
  const todayBest = bests.races[challenge.key];
  const practice = o.venue === 'start-bay' && o.course !== 'short' ? PRACTICE_KINDS.find((k) => k.kind === o.course) : undefined;
  const library = allCourses();

  const start = (opts: QuickRaceOptions, remember = true, drill = false) => {
    if (remember) {
      try {
        localStorage.setItem(KEY, JSON.stringify(opts));
      } catch {
        // Not remembered: storage is unavailable.
      }
    }
    ctl.leaveTo('Starting a new race', () => {
      const r = drill ? ctl.startDrill(opts) : ctl.startQuickRace(opts);
      if (!r) setMessage(`Could not start: ${ctl.getState().scenarioError ?? 'invalid settings'}`);
      else {
        setMessage(r.note ? `${r.summary}. ${r.note}` : `${r.summary}.`);
        onClose();
      }
    });
  };
  const startNew = (reroll: boolean) => {
    const opts = reroll ? { ...o, seed: 1 + Math.floor(Math.random() * 9998) } : o;
    if (reroll) setO(opts);
    start(opts);
  };

  return (
    <section className="panel quick-race" aria-label="Race set-up">
      <div className="race-head">
        <h3>Race</h3>
        <button onClick={onClose} aria-label="Close the race set-up">Close</button>
      </div>

      <div className="challenge" data-testid="daily-challenge">
        <div>
          <strong>Today’s challenge</strong> <span className="fine-inline">· {challenge.day}</span>
          <p className="fine">Three AI boats on the short course in a moderate breeze: the same race for everyone today.{todayBest ? ` Your best today: ${mmss(todayBest.timeS)}.` : ''}</p>
        </div>
        <button className="primary" onClick={() => start(challenge.options, false)} data-testid="challenge-start">Sail it</button>
      </div>

      <label className="field">
        <span>Competitors</span>
        <span className="qr-count">
          <input type="range" min={0} max={20} step={1} value={o.competitors} aria-label="Number of AI competitors" onChange={(e) => set({ competitors: Number(e.target.value) })} />
          <output aria-live="polite">{o.competitors === 0 ? 'none (sail the course alone)' : `${o.competitors} AI boat${o.competitors === 1 ? '' : 's'}`}</output>
        </span>
      </label>
      <label className="field select-field">
        <span>Their level</span>
        <select value={o.level} onChange={(e) => set({ level: e.target.value as AiLevel })} disabled={o.competitors === 0}>
          <option value="club">Club</option>
          <option value="good">Good</option>
          <option value="expert">Expert</option>
        </select>
      </label>
      <div className="field venue-field">
        <span id="race-where">Where</span>
        <div className="segmented" role="radiogroup" aria-labelledby="race-where" data-testid="race-venue">
          {VENUES.map((x) => (
            <button
              key={x.v}
              role="radio"
              aria-checked={o.venue === x.v}
              disabled={!!x.needsDart && !river}
              title={x.needsDart && !river ? `${x.hint} (needs the River Dart data)` : x.hint}
              onClick={() => setO({ ...o, venue: x.v, laps: undefined, legM: undefined, libraryId: x.v === 'library' ? o.libraryId ?? library[0]?.id : o.libraryId })}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {o.venue === 'start-bay' && (
        <label className="field select-field">
          <span>Course</span>
          <select aria-label="Course" value={o.course} onChange={(e) => setO({ ...o, course: e.target.value as QuickCourse, laps: undefined, legM: undefined })} data-testid="race-course">
            <option value="short">Short course: one beat and one run, about 5 minutes</option>
            {PRACTICE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
        </label>
      )}
      {o.venue === 'library' && (
        <label className="field select-field">
          <span>Course</span>
          <select aria-label="Course" value={o.libraryId ?? library[0]?.id ?? ''} onChange={(e) => setO({ ...o, libraryId: e.target.value, laps: undefined })} data-testid="race-course">
            {library.map((c) => (
              <option key={`${c.group}-${c.id}`} value={c.id}>{c.group === 'user' ? 'Mine: ' : ''}{c.name}</option>
            ))}
          </select>
        </label>
      )}
      {o.venue === 'start-bay' && (
        <p className="fine">
          {o.course === 'short'
            ? `A ${SHORT_COURSE_LEG_M} m windward–leeward, one lap. AI Squibs take about 5 minutes in a moderate breeze, longer in light air (model output).`
            : `${practice?.description ?? ''} Laid at the start position, relative to the wind there. Simulated: not an RDYC course.`}
        </p>
      )}
      <label className="field select-field">
        <span>Conditions</span>
        <select value={o.conditions} onChange={(e) => set({ conditions: e.target.value as QuickRaceOptions['conditions'] })}>
          <option value="random">Random</option>
          <option value="live" disabled={!live}>Live now (Met Office){live ? '' : ': not available here'}</option>
          <option value="as-set">As set in Scenario</option>
        </select>
      </label>
      {o.conditions === 'random' && (
        <label className="field select-field">
          <span>Wind</span>
          <select value={o.wind} onChange={(e) => set({ wind: e.target.value as QuickRaceOptions['wind'] })}>
            {(Object.keys(QUICK_WIND_KN) as QuickRaceOptions['wind'][]).map((k) => (
              <option key={k} value={k}>{k === 'any' ? 'Any' : k[0]!.toUpperCase() + k.slice(1)} ({QUICK_WIND_KN[k][0]}–{QUICK_WIND_KN[k][1]} kn)</option>
            ))}
          </select>
        </label>
      )}
      {o.venue === 'river' && o.conditions !== 'as-set' && (
        <label className="check">
          <input type="checkbox" checked={!!o.stream} onChange={(e) => set({ stream: e.target.checked })} data-testid="quick-race-stream" />
          Illustrative tidal stream (not real timing: it goes slack at high and low water, which the Dart does not)
        </label>
      )}
      <label className="field select-field">
        <span>Start sequence</span>
        <select value={o.sequence} onChange={(e) => set({ sequence: e.target.value as QuickRaceOptions['sequence'] })}>
          <option value="one-minute">1 minute</option>
          <option value="three-minute">3 minutes</option>
          <option value="five-minute">5 minutes (warning, preparatory, one-minute)</option>
        </select>
      </label>
      <details className="more-options">
        <summary>More options: laps, leg length, start time, preparatory flag</summary>
        <label className="field">
          <span>Laps</span>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={o.venue === 'start-bay' && o.course === 'short' ? 1 : o.laps ?? ''}
            placeholder="course's own"
            disabled={o.venue === 'start-bay' && o.course === 'short'}
            onChange={(e) => set({ laps: e.target.value === '' ? undefined : Number(e.target.value) })}
            aria-label="Laps"
          />
        </label>
        {o.venue === 'start-bay' && (
          <label className="field">
            <span>Leg length</span>
            <input
              type="number"
              min={80}
              max={1500}
              step={20}
              value={o.legM ?? (o.course === 'short' ? SHORT_COURSE_LEG_M : practice?.legM ?? '')}
              onChange={(e) => set({ legM: e.target.value === '' ? undefined : Number(e.target.value) })}
              aria-label="Leg length (m)"
            />
            <span className="unit">m</span>
          </label>
        )}
        <label className="field">
          <span>Start signal after</span>
          <input
            type="number"
            min={20}
            max={600}
            step={10}
            value={o.startInS ?? ''}
            placeholder={`${{ 'one-minute': 60, 'three-minute': 180, 'five-minute': 300 }[o.sequence] + 30}`}
            onChange={(e) => set({ startInS: e.target.value === '' ? undefined : Number(e.target.value) })}
            aria-label="Start signal after (s)"
          />
          <span className="unit">s</span>
        </label>
        <label className="field select-field">
          <span>Preparatory flag</span>
          <select aria-label="Preparatory flag" value={o.prepFlag ?? 'P'} onChange={(e) => set({ prepFlag: e.target.value as PrepFlag })}>
            <option value="P">P (no starting penalty)</option>
            <option value="U">U (rule 30.3)</option>
            <option value="black">Black flag (rule 30.4)</option>
          </select>
        </label>
      </details>
      <div className="row left wrap">
        <button className="primary" onClick={() => startNew(o.conditions === 'random')} data-testid="quick-race-start">Start race</button>
        {o.conditions === 'random' && <button onClick={() => startNew(false)} title={`Sail the same random conditions again (seed ${o.seed})`}>Same conditions again</button>}
        <button
          onClick={() => start(o, true, true)}
          title="The start of this race, again and again: each start scored (how late you crossed, where on the line, your speed at the gun), with the time and distance to the line and the line's bias shown before the gun"
          data-testid="drill-start"
        >
          Practise the start
        </button>
      </div>
      {(Object.keys(bests.races).length > 0 || bests.start) && (
        <details className="bests" data-testid="bests">
          <summary>Your bests (kept in this browser)</summary>
          <ul>
            {bests.start && <li>Best start: {bests.start.delayS.toFixed(1)} s after the signal</li>}
            {Object.entries(bests.races)
              .sort((a, b) => b[1].at.localeCompare(a[1].at))
              .slice(0, 8)
              .map(([k, r]) => (
                <li key={k}>{r.label}: {mmss(r.timeS)}</li>
              ))}
          </ul>
          <p className="fine">Conditions differ from race to race. Nothing is sent anywhere: a shared table would need a server.</p>
        </details>
      )}
      <p className="fine">
        {o.conditions === 'random'
          ? 'Random conditions are training ranges (wind, gusts, a season afternoon, sky and tide phase), not a record of the Dart.'
          : o.conditions === 'live'
            ? `Live: the latest Met Office model wind for the area${liveTide ? ' and the Dartmouth tide' : ''}, from the site’s scheduled job.${!liveTide && o.venue === 'river' && o.stream ? ' No live tide is published yet, so the river has no tidal stream.' : ''}`
            : 'Uses the wind, tide, sky, boat and start time set in Options.'}{' '}
        {o.venue === 'rdyc' && 'RDYC courses were entered from the club’s 2026 sailing instructions and await a check by a club member; the club gives approximate mark positions, and where the committee boat anchors is the simulator’s choice. '}
        AI Squibs sail with the same physics and controls as you and follow a simplified subset of the racing rules (not an authoritative rules adjudication). Their sail numbers are invented. Starting sequence per rule 26; recalls per rule 29.
      </p>
      {message && <p className="fine" role="status">{message}</p>}
    </section>
  );
}
