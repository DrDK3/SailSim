import { useState } from 'react';
import { START_LOCATIONS, type AppScenario, type SimController, type StartLocationId, type UiState } from '../app/controller';
import type { ConditionsSettings } from '../sim/env/conditions';
import { DEFAULT_TIDAL_STREAM } from '../sim/env/current';
import { PRACTICE_KINDS } from '../app/courseLibrary';
import { dataAgeMinutes } from '../sim/env/weather';
import { SKY_PRESETS, type SkyPreset } from '../sim/env/sky';
import { DEFAULT_SQUIB_TYPE, SQUIB_TYPES, type SquibTypeId } from '../sim/boat/squib';

/** The Squib type: what each build or sail package changes, with the provenance of every difference. */
function BoatChoice({ value, onChange }: { value: SquibTypeId; onChange: (id: SquibTypeId) => void }) {
  const t = SQUIB_TYPES.find((x) => x.id === value) ?? SQUIB_TYPES[0]!;
  return (
    <>
      <h4>Boat</h4>
      <label className="field select-field">
        <span>Squib type</span>
        <select value={t.id} onChange={(e) => onChange(e.target.value as SquibTypeId)} data-testid="boat-type">
          {SQUIB_TYPES.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <p className="fine">{t.summary}</p>
      {t.differences.length > 0 && (
        <details className="boat-diff">
          <summary>What changes ({t.differences.length})</summary>
          <table>
            <tbody>
              {t.differences.map((d) => (
                <tr key={d.path}>
                  <td><code>{d.path}</code></td>
                  <td>{String(d.value)} {d.unit === '-' ? '' : d.unit}</td>
                  <td title="Provenance: S secondary source, E estimate">{d.tag}</td>
                  <td>{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <p className="fine">Hull: {t.hullLabel}. Sails: {t.sailsLabel}. AI boats sail the Rondar default.</p>
    </>
  );
}

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

export function ScenarioPanel({ ctl, ui, onClose, onRace }: { ctl: SimController; ui: UiState; onClose: () => void; onRace?: () => void }) {
  const [draft, setDraft] = useState<AppScenario>(() => structuredClone(ui.scenario));
  const c = draft.conditions;
  const setC = (patch: Partial<ConditionsSettings>) => setDraft({ ...draft, conditions: { ...c, ...patch } });
  const w = c.weather;
  const sourceId = w.source === 'manual' ? 'manual' : (ui.weatherSources.find((s) => s.json === w.snapshot)?.id ?? 'manual');
  const tideSourceId = c.tide?.mode === 'snapshot' ? (ui.tideSources.find((s) => s.json === (c.tide as { snapshot: unknown }).snapshot)?.id ?? 'none') : undefined;
  const tideMode = c.tide?.mode === 'snapshot' ? (tideSourceId ?? 'none') : (c.tide?.mode ?? 'none');
  const weatherSrc = ui.weatherSources.find((s) => s.id === sourceId);
  // Today's sky under a set wind (a random race or today's challenge) shows as the forecast's sky.
  const skyValue = c.sky ? (c.sky.source === 'preset' ? c.sky.preset : 'data') : w.source === 'metoffice' ? 'data' : 'clear';
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
    ctl.leaveTo('Applying these settings', () => {
      if (ctl.restart(draft)) onClose();
    });
  };

  return (
    <section className="panel scenario" aria-label="Scenario settings">
      <h3>Scenario</h3>
      <BoatChoice value={draft.boat ?? DEFAULT_SQUIB_TYPE} onChange={(boat) => setDraft({ ...draft, boat })} />
      <label className="field select-field">
        <span>Helm</span>
        <select value={draft.helm ?? 'male'} onChange={(e) => setDraft({ ...draft, helm: e.target.value === 'female' ? 'female' : 'male' })} data-testid="helm-build">
          <option value="male">Man</option>
          <option value="female">Woman</option>
        </select>
      </label>
      <p className="fine">How your helm is drawn (average adult height, 1.75 m or 1.61 m). Appearance only: the boat&apos;s crew weight is an estimate in its calibration.</p>
      <h4>Start</h4>
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
          <option value="gusty">Gusty (off the hills)</option>
          {w.source !== 'manual' && <option value="from-data">From data (heuristic)</option>}
        </select>
      </label>
      <Num label="Random seed" value={c.gusts.seed} min={1} max={9999} step={1} unit="" onChange={(v) => setC({ gusts: { ...c.gusts, seed: Math.round(v) } })} />
      <label className="field check-field" title="Shelter in the lee of the hills and the valley turning the wind along the river (estimated from the terrain; needs the River Dart data)">
        <input type="checkbox" checked={c.landEffects !== false} onChange={(e) => setC({ landEffects: e.target.checked })} data-testid="land-effects" />
        <span>The land shapes the wind (shelter, valley)</span>
      </label>

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
            Illustrative only: the pattern follows the channel, about twice as fast in the narrows as at the entrance,
            slack in the creeks. Its timing comes from the rise and fall of the tide, so it goes slack at high and low
            water and the flood mirrors the ebb: the real Dart stream does not keep that timing. Rates are the mean
            across the entrance at mid-tide. Not measured current data; not for learning stream tactics.
          </p>
        </>
      )}
      {cur.mode === 'tidal' && (
        <>
          <Num label="Flood sets towards" value={cur.stream.floodSetDeg} min={0} max={359} step={1} unit="°T" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, floodSetDeg: v } } })} />
          <Num label="Peak flood" value={cur.stream.peakFloodKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, peakFloodKn: v } } })} />
          <Num label="Peak ebb" value={cur.stream.peakEbbKn} min={0} max={4} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, peakEbbKn: v } } })} />
          <Num label="River outflow" value={cur.stream.riverEbbKn} min={0} max={2} step={0.1} unit="kn" onChange={(v) => setC({ current: { mode: 'tidal', stream: { ...cur.stream, riverEbbKn: v } } })} />
          <p className="fine">Illustrative only: slack at high and low water and strongest at mid-tide, a timing real streams need not follow. Not measured current data.</p>
        </>
      )}

      <h4>Course and race</h4>
      <p className="fine" data-testid="scenario-course">
        {draft.course
          ? `This scenario races ${ui.race?.courseName ?? (draft.course.source === 'practice' ? PRACTICE_KINDS.find((k) => k.kind === (draft.course as { kind: string }).kind)?.label ?? 'a practice course' : 'a course')}${draft.fleet?.aiCount ? ` against ${draft.fleet.aiCount} AI boat${draft.fleet.aiCount === 1 ? '' : 's'}` : ' alone'}. Apply keeps it, with the conditions above.`
          : 'Free sailing: no course.'}{' '}
        Courses, laps, the start sequence and the fleet are all set in Race.
      </p>
      <div className="row left wrap">
        {onRace && (
          <button
            onClick={() => {
              onClose();
              onRace();
            }}
          >
            Race set-up…
          </button>
        )}
        {draft.course && <button onClick={() => setDraft({ ...draft, course: undefined, race: undefined, fleet: undefined })}>Sail without the course</button>}
      </div>

      {ui.scenarioError && <p className="error" role="alert">Could not start: {ui.scenarioError}</p>}
      <div className="row">
        <button className="primary" onClick={apply}>Apply and restart</button>
        <button onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
