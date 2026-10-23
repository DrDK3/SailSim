import { useState } from 'react';
import { START_LOCATIONS, type AppScenario, type SimController, type StartLocationId, type UiState } from '../app/controller';
import type { ConditionsSettings } from '../sim/env/conditions';
import { DEFAULT_TIDAL_STREAM } from '../sim/env/current';
import { allCourses, PRACTICE_KINDS } from '../app/courseLibrary';
import { dataAgeMinutes } from '../sim/env/weather';
import type { AiLevel } from '../sim/ai/skipper';
import type { PrepFlag } from '../sim/race/committee';
import { SKY_PRESETS, type SkyPreset } from '../sim/env/sky';

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
  const tideSourceId = c.tide?.mode === 'snapshot' ? (ui.tideSources.find((s) => s.json === (c.tide as { snapshot: unknown }).snapshot)?.id ?? 'none') : undefined;
  const tideMode = c.tide?.mode === 'snapshot' ? (tideSourceId ?? 'none') : (c.tide?.mode ?? 'none');
  const weatherSrc = ui.weatherSources.find((s) => s.id === sourceId);
  const skyValue = c.sky ? (c.sky.source === 'data' ? 'data' : c.sky.preset) : w.source === 'metoffice' ? 'data' : 'clear';
  const skyFromData = w.source === 'metoffice' && Array.isArray((w.snapshot as { model?: { sky?: unknown[] } })?.model?.sky);
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
      <label className="field select-field">
        <span>Start position</span>
        <select
          value={draft.startLocation}
          onChange={(e) => {
            const loc = START_LOCATIONS.find((l) => l.id === e.target.value)!;
            setDraft({ ...draft, startLocation: loc.id as StartLocationId, startHeadingDeg: loc.headingDeg });
          }}
        >
          {START_LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </label>
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
        <>
          <p className="fine">
            Met Office UKV 2 km forecast model, valid {weatherSrc?.validTime ?? '?'} ({ageText(weatherSrc?.validTime)}). Model output, not a
            measurement; spatially varying across the area{(w.snapshot as { model?: { steps?: unknown[] } })?.model?.steps ? ' and following the forecast in time' : ''}.
            {' '}{w.replay ? 'Replay of a past snapshot.' : ''}
          </p>
          {weatherSrc?.freshness && (
            <p className={`fine ${weatherSrc.freshness.status === 'fresh' ? '' : 'warn-text'}`} role={weatherSrc.freshness.status === 'fresh' ? undefined : 'alert'} data-testid="weather-freshness">
              {weatherSrc.freshness.message}
            </p>
          )}
        </>
      )}
      {ui.weatherSources.every((s) => s.kind !== 'live') && (
        <p className="fine" data-testid="no-live-weather">
          No live Met Office forecast is published next to this copy of the app (the scheduled ingest job writes it: docs/DEPLOYMENT.md). Replays are available.
        </p>
      )}
      {ui.liveIssues.length > 0 && (
        <ul className="fine live-issues" data-testid="live-issues">
          {ui.liveIssues.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <label className="field select-field">
        <span>Sky</span>
        <select
          aria-label="Sky"
          value={skyValue}
          onChange={(e) => setC({ sky: e.target.value === 'data' ? { source: 'data' } : { source: 'preset', preset: e.target.value as SkyPreset } })}
        >
          {w.source === 'metoffice' && <option value="data">{skyFromData ? 'From the forecast (cloud, visibility, rain)' : 'From data (not in this file: fair)'}</option>}
          {(Object.keys(SKY_PRESETS) as SkyPreset[]).map((k) => (
            <option key={k} value={k}>{SKY_PRESETS[k].label}</option>
          ))}
        </select>
      </label>
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
            const v = e.target.value;
            const src = ui.tideSources.find((s) => s.id === v);
            if (v === 'none') setC({ tide: undefined, current: cur.mode === 'tidal' || cur.mode === 'dart' ? { mode: 'none' } : cur });
            else if (src) setC({ tide: { mode: 'snapshot', snapshot: src.json, useGauge: src.gaugeUsable === true } });
            else setC({ tide: { mode: 'manual', hwTime: c.startTime, hwHeightM: 4.6, lwHeightM: 1.2 } });
          }}
        >
          <option value="none">None</option>
          <option value="manual">Manual (from tide tables)</option>
          {ui.tideSources.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>
      {tideSourceId && ui.tideSources.find((s) => s.id === tideSourceId)?.freshness && (
        <p className="fine" data-testid="tide-freshness">{ui.tideSources.find((s) => s.id === tideSourceId)!.freshness!.message}</p>
      )}
      {ui.tideSources.length === 0 && (
        <p className="fine">No live tide file is published next to this copy of the app (needs the EA and UKHO hosts: docs/LIVE_TIDES.md).</p>
      )}
      {!c.tide && ui.dart.status === 'loaded' && (
        <p className="fine">No tide set: the water stays at about mean level ({'≈'}2.7 m above chart datum).</p>
      )}
      {manual && (
        <>
          <TimeField label="High water" iso={manual.hwTime} onChange={(iso) => setManualTide({ hwTime: iso })} />
          <Num label="HW height" value={manual.hwHeightM} min={0} max={7} step={0.1} unit="m CD" onChange={(v) => setManualTide({ hwHeightM: v })} />
          <Num label="LW height" value={manual.lwHeightM} min={-0.5} max={4} step={0.1} unit="m CD" onChange={(v) => setManualTide({ lwHeightM: v })} />
          <p className="fine">
            Enter Dartmouth HW/LW from tide tables or ADMIRALTY EasyTide. The water level sets the depths for grounding.
            Live gauge and UKHO predictions need network access (docs/LIVE_TIDES.md).
          </p>
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
            else if (m === 'dart') setC({ current: { mode: 'dart', stream: { ...DEFAULT_TIDAL_STREAM } } });
            else setC({ current: { mode: 'tidal', stream: { ...DEFAULT_TIDAL_STREAM } } });
          }}
        >
          <option value="none">None</option>
          <option value="uniform">Uniform (steady)</option>
          <option value="dart" disabled={!c.tide || ui.dart.status !== 'loaded'}>
            Channel-following tidal stream{!c.tide ? ' (set a tide first)' : ui.dart.status !== 'loaded' ? ' (needs the River Dart data)' : ''}
          </option>
          <option value="tidal" disabled={!c.tide}>Uniform tidal stream from tide timing{c.tide ? '' : ' (set a tide first)'}</option>
        </select>
      </label>
      {cur.mode === 'uniform' && (
        <>
          <Num label="Rate" value={cur.rateKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { ...cur, rateKn: v } })} />
          <Num label="Set (towards)" value={cur.setDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setC({ current: { ...cur, setDeg: v } })} />
        </>
      )}
      {cur.mode === 'dart' && (
        <>
          <Num label="Entrance peak flood" value={cur.stream.peakFloodKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'dart', stream: { ...cur.stream, peakFloodKn: v } } })} />
          <Num label="Entrance peak ebb" value={cur.stream.peakEbbKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'dart', stream: { ...cur.stream, peakEbbKn: v } } })} />
          <Num label="River outflow" value={cur.stream.riverEbbKn} min={0} max={2} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'dart', stream: { ...cur.stream, riverEbbKn: v } } })} />
          <p className="fine">
            Provisional model: follows the channel, about twice as fast in the narrows as at the entrance, slack in the creeks.
            Rates are the mean across the entrance at mid-tide. Not measured current data.
          </p>
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

      <h4>Course and start</h4>
      <label className="field select-field">
        <span>Course</span>
        <select
          aria-label="Course"
          value={draft.course ? (draft.course.source === 'practice' ? `practice:${draft.course.kind}` : draft.course.source === 'library' ? `library:${draft.course.id}` : 'inline') : 'none'}
          onChange={(e) => {
            const v = e.target.value;
            const race = draft.race ?? { sequence: 'one-minute' as const, startInS: 90 };
            if (v === 'none') setDraft({ ...draft, course: undefined });
            else if (v.startsWith('practice:')) setDraft({ ...draft, course: { source: 'practice', kind: v.slice(9) as (typeof PRACTICE_KINDS)[number]['kind'] }, race, startLocation: 'start-bay-practice' });
            else if (v.startsWith('library:')) setDraft({ ...draft, course: { source: 'library', id: v.slice(8) }, race });
          }}
        >
          <option value="none">None (free sailing)</option>
          <optgroup label="Practice courses (simulated, laid at the start position)">
            {PRACTICE_KINDS.map((k) => <option key={k.kind} value={`practice:${k.kind}`}>{k.label}</option>)}
          </optgroup>
          <optgroup label="Course library">
            {allCourses().map((c) => <option key={`${c.group}-${c.id}`} value={`library:${c.id}`}>{c.group === 'user' ? 'Mine: ' : ''}{c.name}</option>)}
          </optgroup>
          <option value="club" disabled>Club courses: none entered yet (RDYC documents needed)</option>
          {draft.course?.source === 'inline' && <option value="inline">From the editor</option>}
        </select>
      </label>
      {draft.course?.source === 'practice' && (
        <>
          <p className="fine">{PRACTICE_KINDS.find((k) => k.kind === (draft.course as { kind: string }).kind)?.description} Laid at the start position, relative to the wind there. Simulated: not an RDYC course.</p>
          <Num label="Leg length" value={draft.course.legM ?? PRACTICE_KINDS.find((k) => k.kind === (draft.course as { kind: string }).kind)!.legM} min={80} max={1500} step={20} unit="m" onChange={(v) => setDraft({ ...draft, course: { ...(draft.course as Extract<typeof draft.course, { source: 'practice' }>), legM: v } })} />
        </>
      )}
      {draft.course && draft.course.source !== 'inline' && (
        <Num label="Laps" value={draft.course.laps ?? 2} min={1} max={10} step={1} unit="" onChange={(v) => setDraft({ ...draft, course: { ...draft.course!, laps: Math.round(v) } as typeof draft.course })} />
      )}
      {draft.course && (
        <>
          <label className="field select-field">
            <span>Start sequence</span>
            <select value={draft.race?.sequence ?? 'one-minute'} onChange={(e) => setDraft({ ...draft, race: { startInS: draft.race?.startInS ?? 90, sequence: e.target.value as NonNullable<AppScenario['race']>['sequence'] } })}>
              <option value="one-minute">1 minute</option>
              <option value="three-minute">3 minutes</option>
              <option value="five-minute">5 minutes (warning, preparatory, one-minute)</option>
            </select>
          </label>
          <Num label="Start signal after" value={draft.race?.startInS ?? 90} min={20} max={600} step={10} unit="s" onChange={(v) => setDraft({ ...draft, race: { sequence: draft.race?.sequence ?? 'one-minute', startInS: Math.round(v) } })} />
          <h4>Fleet</h4>
          <Num label="AI boats" value={draft.fleet?.aiCount ?? 0} min={0} max={20} step={1} unit="" onChange={(v) => setDraft({ ...draft, fleet: { level: draft.fleet?.level ?? 'good', prepFlag: draft.fleet?.prepFlag ?? 'P', aiCount: Math.max(0, Math.min(20, Math.round(v))) } })} />
          <label className="field select-field">
            <span>AI level</span>
            <select aria-label="AI level" value={draft.fleet?.level ?? 'good'} onChange={(e) => setDraft({ ...draft, fleet: { aiCount: draft.fleet?.aiCount ?? 0, prepFlag: draft.fleet?.prepFlag ?? 'P', level: e.target.value as AiLevel } })}>
              <option value="club">Club</option>
              <option value="good">Good</option>
              <option value="expert">Expert</option>
            </select>
          </label>
          <label className="field select-field">
            <span>Preparatory flag</span>
            <select aria-label="Preparatory flag" value={draft.fleet?.prepFlag ?? 'P'} onChange={(e) => setDraft({ ...draft, fleet: { aiCount: draft.fleet?.aiCount ?? 0, level: draft.fleet?.level ?? 'good', prepFlag: e.target.value as PrepFlag } })}>
              <option value="P">P (no starting penalty)</option>
              <option value="U">U (rule 30.3)</option>
              <option value="black">Black flag (rule 30.4)</option>
            </select>
          </label>
          <p className="fine">
            AI Squibs sail with the same physics and controls as you (auto-trim, crew assist) and follow a simplified subset of the
            racing rules. Their sail numbers are invented. Starting sequence per rule 26; individual and general recalls per rule 29;
            the club's sailing instructions are not available, so the finishing window and recall policy are estimates.
            With a course you start in the first slot behind the line; practice start lines are longer for bigger fleets.
            The AI was tested with fleets of 5; in bigger fleets AI boats collide or start late more often.
          </p>
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
