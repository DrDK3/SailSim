import { useState } from 'react';
import type { AppScenario, SimController, UiState } from '../app/controller';
import type { ConditionsSettings } from '../sim/env/conditions';
import { DEFAULT_TIDAL_STREAM } from '../sim/env/current';
import { dataAgeMinutes } from '../sim/env/weather';

function Num({ label, value, min, max, step, onChange, unit, disabled }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="unit">{unit}</span>
    </label>
  );
}

/** ISO UTC string <-> <input type="datetime-local"> value, treating the input as UTC. */
const isoToLocalInput = (iso: string) => iso.slice(0, 16);
const localInputToIso = (v: string) => `${v}:00Z`;

function TimeField({ label, iso, onChange }: { label: string; iso: string; onChange: (iso: string) => void }) {
  return (
    <label className="field time">
      <span>{label}</span>
      <input type="datetime-local" value={isoToLocalInput(iso)} onChange={(e) => e.target.value && onChange(localInputToIso(e.target.value))} />
      <span className="unit">UTC</span>
    </label>
  );
}

function ageText(validIso: string | undefined): string {
  const age = dataAgeMinutes(validIso, Date.now());
  if (age === undefined) return '';
  if (age < 0) return 'valid in the future';
  if (age < 90) return `${Math.round(age)} min old`;
  if (age < 48 * 60) return `${(age / 60).toFixed(1)} h old`;
  return `${Math.round(age / 1440)} days old`;
}

export function ScenarioPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [draft, setDraft] = useState<AppScenario>(() => structuredClone(ui.scenario));
  const c = draft.conditions;
  const setC = (patch: Partial<ConditionsSettings>) => setDraft({ ...draft, conditions: { ...c, ...patch } });
  const w = c.weather;
  const sourceId = w.source === 'manual' ? 'manual' : (ui.weatherSources.find((s) => s.json === w.snapshot)?.id ?? 'manual');
  const tideMode = c.tide?.mode ?? 'none';
  const manual = c.tide?.mode === 'manual' ? c.tide : undefined;
  const setManualTide = (patch: Partial<NonNullable<typeof manual>>) => manual && setC({ tide: { ...manual, ...patch } });
  const cur = c.current;

  const chooseSource = (id: string) => {
    if (id === 'manual') {
      setC({ weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { ...c.gusts, preset: c.gusts.preset === 'from-data' ? 'moderate' : c.gusts.preset } });
      return;
    }
    const src = ui.weatherSources.find((s) => s.id === id);
    if (!src) return;
    // Live data: start now. Replay: start at the data's valid time so tides and labels line up.
    const start = src.kind === 'live' ? new Date().toISOString().slice(0, 16) + ':00Z' : (src.validTime ?? c.startTime);
    setC({ weather: { source: 'metoffice', snapshot: src.json, replay: src.kind === 'replay' }, gusts: { ...c.gusts, preset: 'from-data' }, startTime: start });
  };

  const apply = () => {
    if (ctl.restart(draft)) onClose();
  };

  return (
    <section className="panel scenario" aria-label="Scenario settings">
      <h3>Scenario</h3>
      <TimeField label="Start time" iso={c.startTime} onChange={(iso) => setC({ startTime: iso })} />
      <div className="row tight">
        <button onClick={() => setC({ startTime: new Date().toISOString().slice(0, 16) + ':00Z' })}>Now</button>
      </div>
      <Num label="Start heading" value={draft.startHeadingDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setDraft({ ...draft, startHeadingDeg: v })} />
      <Num label="Start speed" value={draft.startSpeedKn} min={0} max={6} step={0.5} unit="kn" onChange={(v) => setDraft({ ...draft, startSpeedKn: v })} />

      <h4>Wind</h4>
      <label className="field select-field">
        <span>Source</span>
        <select value={sourceId} onChange={(e) => chooseSource(e.target.value)}>
          <option value="manual">Manual (uniform)</option>
          {ui.weatherSources.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>
      {w.source === 'manual' ? (
        <>
          <Num label="True wind speed" value={w.twsKn} min={0} max={25} step={0.5} unit="kn" onChange={(v) => setC({ weather: { ...w, twsKn: v } })} />
          <Num label="Wind from" value={w.twdDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setC({ weather: { ...w, twdDeg: v } })} />
        </>
      ) : (
        <p className="fine">
          Met Office UKV 2 km forecast model, valid {ui.weatherSources.find((s) => s.id === sourceId)?.validTime ?? '?'}
          {' '}({ageText(ui.weatherSources.find((s) => s.id === sourceId)?.validTime)}). Model output, not a measurement;
          spatially varying across the area. {w.replay ? 'Replay of a past snapshot.' : ''}
        </p>
      )}
      {ui.weatherSources.every((s) => s.kind !== 'live') && (
        <p className="fine">No live Met Office file is published yet (the scheduled ingest is Phase 6); a dated replay is available.</p>
      )}
      <label className="field select-field">
        <span>Gusts and shifts</span>
        <select value={c.gusts.preset} onChange={(e) => setC({ gusts: { ...c.gusts, preset: e.target.value as ConditionsSettings['gusts']['preset'] } })}>
          <option value="steady">Steady</option>
          <option value="moderate">Moderate</option>
          <option value="shifty">Shifty</option>
          {w.source !== 'manual' && <option value="from-data">From data (heuristic)</option>}
        </select>
      </label>
      <Num label="Random seed" value={c.gusts.seed} min={1} max={9999} step={1} unit="" onChange={(v) => setC({ gusts: { ...c.gusts, seed: Math.round(v) } })} />

      <h4>Tide (height)</h4>
      <label className="field select-field">
        <span>Tide</span>
        <select
          value={tideMode}
          onChange={(e) => {
            if (e.target.value === 'none') setC({ tide: undefined, current: cur.mode === 'tidal' ? { mode: 'none' } : cur });
            else setC({ tide: { mode: 'manual', hwTime: c.startTime, hwHeightM: 4.6, lwHeightM: 1.2 } });
          }}
        >
          <option value="none">None</option>
          <option value="manual">Manual (from tide tables)</option>
        </select>
      </label>
      {manual && (
        <>
          <TimeField label="High water" iso={manual.hwTime} onChange={(iso) => setManualTide({ hwTime: iso })} />
          <Num label="HW height" value={manual.hwHeightM} min={0} max={7} step={0.1} unit="m CD" onChange={(v) => setManualTide({ hwHeightM: v })} />
          <Num label="LW height" value={manual.lwHeightM} min={-0.5} max={4} step={0.1} unit="m CD" onChange={(v) => setManualTide({ lwHeightM: v })} />
          <p className="fine">Enter Dartmouth HW/LW from tide tables or ADMIRALTY EasyTide. Live gauge and UKHO predictions need network access (docs/LIVE_TIDES.md).</p>
        </>
      )}

      <h4>Current</h4>
      <label className="field select-field">
        <span>Current</span>
        <select
          value={cur.mode}
          onChange={(e) => {
            const m = e.target.value;
            if (m === 'none') setC({ current: { mode: 'none' } });
            else if (m === 'uniform') setC({ current: { mode: 'uniform', setDeg: 0, rateKn: 1 } });
            else setC({ current: { mode: 'tidal', stream: { ...DEFAULT_TIDAL_STREAM } } });
          }}
        >
          <option value="none">None</option>
          <option value="uniform">Uniform (steady)</option>
          <option value="tidal" disabled={!c.tide}>Tidal stream from tide timing{c.tide ? '' : ' (set a tide first)'}</option>
        </select>
      </label>
      {cur.mode === 'uniform' && (
        <>
          <Num label="Rate" value={cur.rateKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { ...cur, rateKn: v } })} />
          <Num label="Set (towards)" value={cur.setDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setC({ current: { ...cur, setDeg: v } })} />
        </>
      )}
      {cur.mode === 'tidal' && (
        <>
          <Num label="Flood sets towards" value={cur.stream.floodSetDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, floodSetDeg: v } } })} />
          <Num label="Peak flood" value={cur.stream.peakFloodKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, peakFloodKn: v } } })} />
          <Num label="Peak ebb" value={cur.stream.peakEbbKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, peakEbbKn: v } } })} />
          <Num label="River outflow" value={cur.stream.riverEbbKn} min={0} max={2} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, riverEbbKn: v } } })} />
          <p className="fine">Provisional model: slack at HW and LW, strongest at mid-tide. Not measured current data.</p>
        </>
      )}

      {ui.scenarioError && <p className="error" role="alert">Could not start: {ui.scenarioError}</p>}
      <div className="row">
        <button className="primary" onClick={apply}>Apply and restart</button>
        <button onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
