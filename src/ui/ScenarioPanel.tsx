import { useState } from 'react';
import type { ScenarioSettings, SimController, UiState } from '../app/controller';

function Num({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="unit">{unit}</span>
    </label>
  );
}

export function ScenarioPanel({ ctl, ui, onClose }: { ctl: SimController; ui: UiState; onClose: () => void }) {
  const [draft, setDraft] = useState<ScenarioSettings>(ui.scenario);
  const set = (k: keyof ScenarioSettings) => (v: number) => setDraft({ ...draft, [k]: v });
  return (
    <section className="panel scenario" aria-label="Scenario settings">
      <h3>Scenario</h3>
      <p className="fine">Open water, uniform steady wind (Phase 1 manual scenario). Live Met Office wind and real tides are planned for Phases 2–3.</p>
      <Num label="True wind speed" value={draft.twsKn} min={0} max={25} step={0.5} unit="kn" onChange={set('twsKn')} />
      <Num label="Wind from" value={draft.twdDeg} min={0} max={359} step={1} unit="°T" onChange={set('twdDeg')} />
      <Num label="Current rate" value={draft.currentRateKn ?? 0} min={0} max={4} step={0.1} unit="kn" onChange={set('currentRateKn')} />
      <Num label="Current set (towards)" value={draft.currentSetDeg ?? 0} min={0} max={359} step={1} unit="°T" onChange={set('currentSetDeg')} />
      <Num label="Start heading" value={draft.startHeadingDeg} min={0} max={359} step={1} unit="°T" onChange={set('startHeadingDeg')} />
      <Num label="Start speed" value={draft.startSpeedKn} min={0} max={6} step={0.5} unit="kn" onChange={set('startSpeedKn')} />
      <div className="row">
        <button className="primary" onClick={() => { ctl.restart(draft); onClose(); }}>Apply and restart</button>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="fine">Environment: {ui.envLabel}</p>
    </section>
  );
}
