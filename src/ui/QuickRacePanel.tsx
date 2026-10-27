import { useState } from 'react';
import type { SimController, UiState } from '../app/controller';
import { DEFAULT_QUICK_RACE, QUICK_WIND_KN, type QuickRaceOptions } from '../app/quickRace';
import type { AiLevel } from '../sim/ai/skipper';

const KEY = 'squib.quickRace.v1';

function loadOptions(): QuickRaceOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_QUICK_RACE, ...(JSON.parse(raw) as Partial<QuickRaceOptions>) };
  } catch {
    // Storage unavailable or the saved choice unreadable: the defaults.
  }
  return { ...DEFAULT_QUICK_RACE };
}

/** Race in one step: how many boats, how good, where, and in what conditions. */
export function QuickRacePanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [o, setO] = useState<QuickRaceOptions>(loadOptions);
  const [message, setMessage] = useState<string>();
  const set = (patch: Partial<QuickRaceOptions>) => setO({ ...o, ...patch });
  const live = ui.weatherSources.some((w) => w.kind === 'live');
  const river = ui.dart.status === 'loaded';

  const start = (reroll: boolean) => {
    const opts = reroll ? { ...o, seed: 1 + Math.floor(Math.random() * 9998) } : o;
    if (reroll) setO(opts);
    try {
      localStorage.setItem(KEY, JSON.stringify(opts));
    } catch {
      // Not remembered: storage is unavailable.
    }
    const r = ctl.startQuickRace(opts);
    if (!r) setMessage(`Could not start: ${ctl.getState().scenarioError ?? 'invalid settings'}`);
    else {
      setMessage(r.note ? `${r.summary}. ${r.note}` : `${r.summary}.`);
      onClose();
    }
  };

  return (
    <section className="panel quick-race" aria-label="Quick race">
      <div className="race-head">
        <h3>Quick race</h3>
        <button onClick={onClose} aria-label="Close quick race">Close</button>
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
      <label className="field select-field">
        <span>Where</span>
        <select value={o.venue} onChange={(e) => set({ venue: e.target.value as QuickRaceOptions['venue'] })}>
          <option value="start-bay">Start Bay (open water, any wind)</option>
          <option value="river" disabled={!river}>The river: the Range, off Dart Marina{river ? '' : ' (needs the River Dart data)'}</option>
        </select>
      </label>
      {o.venue === 'start-bay' && (
        <label className="field select-field">
          <span>Course</span>
          <select value={o.course} onChange={(e) => set({ course: e.target.value as QuickRaceOptions['course'] })}>
            <option value="windward-leeward">Windward–leeward, 2 laps</option>
            <option value="triangle">Triangle, 2 laps</option>
          </select>
        </label>
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
      <label className="field select-field">
        <span>Start sequence</span>
        <select value={o.sequence} onChange={(e) => set({ sequence: e.target.value as QuickRaceOptions['sequence'] })}>
          <option value="one-minute">1 minute</option>
          <option value="three-minute">3 minutes</option>
          <option value="five-minute">5 minutes</option>
        </select>
      </label>
      <div className="row left wrap">
        <button className="primary" onClick={() => start(o.conditions === 'random')} data-testid="quick-race-start">Start race</button>
        {o.conditions === 'random' && <button onClick={() => start(false)} title={`Sail the same random conditions again (seed ${o.seed})`}>Same conditions again</button>}
      </div>
      <p className="fine">
        {o.conditions === 'random'
          ? 'Random conditions are training ranges (wind, gusts, a season afternoon, sky and tide phase), not a record of the Dart.'
          : o.conditions === 'live'
            ? 'Live: the latest Met Office model wind for the area, from the site’s scheduled job.'
            : 'Uses the wind, tide and sky set in the Scenario panel.'}{' '}
        AI boats and the judging are simplified (not an authoritative rules adjudication).
      </p>
      {message && <p className="fine" role="status">{message}</p>}
    </section>
  );
}
