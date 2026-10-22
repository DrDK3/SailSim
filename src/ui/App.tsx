import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimController } from '../app/controller';
import { Instruments } from './Instruments';
import { Controls } from './Controls';
import { DebugPanel } from './DebugPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { Help } from './Help';
import { Dashboard } from './Dashboard';
import { PolarPanel } from './PolarPanel';
import { Minimap } from './Minimap';
import { LayersPanel } from './LayersPanel';
import { RacePanel } from './RacePanel';
import { CourseEditor } from './CourseEditor';
import type { CameraMode } from '../render/scene';
import type { AppScenario } from '../app/controller';

function conditionsText(sc: AppScenario): string {
  const c = sc.conditions;
  const wind = c.weather.source === 'manual' ? `wind ${c.weather.twsKn} kn from ${c.weather.twdDeg}°` : `Met Office UKV model wind${c.weather.replay ? ' (replay)' : ''}`;
  const tide = c.tide ? `tide ${c.tide.mode}` : 'no tide';
  const cur = c.current.mode === 'tidal' ? 'modelled tidal stream' : c.current.mode === 'uniform' ? `current ${c.current.rateKn} kn` : 'no current';
  const course = sc.course ? (sc.course.source === 'practice' ? ` · practice course (simulated)` : ' · course set') : '';
  return `${wind} · ${c.gusts.preset} gusts · ${tide} · ${cur}${course}`;
}

export function App({ ctl }: { ctl: SimController }) {
  const host = useRef<HTMLDivElement>(null);
  const ui = useSyncExternalStore(ctl.subscribe, ctl.getState);
  const [scenarioOpen, setScenarioOpen] = useState(false);

  useEffect(() => {
    const el = host.current!;
    ctl.attach(el);
    const ro = new ResizeObserver(() => ctl.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      ctl.detach();
    };
  }, [ctl]);

  return (
    <div className="app">
      <div ref={host} className="viewport" data-testid="viewport" />
      {ui.webglError && <div className="banner error" role="alert">{ui.webglError}</div>}
      <Instruments s={ui.snapshot} />
      <nav className="panel toolbar" aria-label="Simulation">
        <button onClick={() => ctl.togglePause()} data-testid="pause">{ui.paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => ctl.restart()} title="Reset to the scenario start (R)">Reset</button>
        <label className="select">
          Camera
          <select value={ui.camera} onChange={(e) => ctl.setCamera(e.target.value as CameraMode)}>
            <option value="chase">Chase</option>
            <option value="helm">Helm</option>
            <option value="orbit">Orbit (drag)</option>
            <option value="top">Top-down</option>
          </select>
        </label>
        <button aria-pressed={ui.showForces} onClick={() => ctl.toggleForces()} title="Force arrows (F)">Forces</button>
        <button aria-pressed={ui.showDebug} onClick={() => ctl.toggleDebug()} title="Physics panel (G)">Debug</button>
        <button aria-pressed={ui.showDashboard} onClick={() => ctl.toggleDashboard()} title="Validation dashboard (V)">Dashboard</button>
        <button aria-pressed={ui.showPolar} onClick={() => ctl.togglePolar()} title="Model polar sweep">Polar</button>
        <button aria-pressed={scenarioOpen} onClick={() => setScenarioOpen(!scenarioOpen)}>Scenario</button>
        <button aria-pressed={ui.showLabels} onClick={() => ctl.toggleLabels()} title="Place labels (L)">Labels</button>
        <button aria-pressed={ui.showMinimap} onClick={() => ctl.toggleMinimap()} title="Minimap (N)">Map</button>
        <button aria-pressed={ui.showLayers} onClick={() => ctl.toggleLayers()} title="Layers, provisional elements and sources">Layers</button>
        <button aria-pressed={ui.showEditor} onClick={() => ctl.toggleEditor()} title="Course editor">Courses</button>
        <button onClick={() => ctl.toggleHelp()} title="Help (H)">Help</button>
      </nav>
      <div className="side">
        {scenarioOpen && <ScenarioPanel ctl={ctl} ui={ui} onClose={() => setScenarioOpen(false)} />}
        {ui.showPolar && <PolarPanel onClose={() => ctl.togglePolar(false)} />}
        {ui.showDebug && <DebugPanel ui={ui} />}
      </div>
      {ui.showDashboard && <Dashboard ctl={ctl} ui={ui} onClose={() => ctl.toggleDashboard(false)} />}
      <Controls ctl={ctl} ui={ui} />
      {ui.paused && <div className="banner">Paused (P to resume)</div>}
      {ui.showMinimap && <Minimap ctl={ctl} ui={ui} />}
      {(ui.dart.issues.length > 0 || ui.dart.status === 'unavailable') && (
        <div className="banner warn-banner" role="alert" data-testid="dart-warning">
          {ui.dart.status === 'unavailable' ? 'River Dart data could not be loaded: sailing on open water.' : `Some River Dart data failed to load (${ui.dart.issues.map((i) => i.asset).join(', ')}).`}{' '}
          <button onClick={() => ctl.toggleLayers(true)}>Details</button>
        </div>
      )}
      {ui.showLayers && <LayersPanel ctl={ctl} ui={ui} onClose={() => ctl.toggleLayers(false)} />}
      {ui.race && <RacePanel race={ui.race} />}
      {ui.showEditor && <CourseEditor ctl={ctl} ui={ui} onClose={() => ctl.toggleEditor(false)} />}
      <footer className="badge">
        Phase 4 prototype · {ui.dart.status === 'loaded' ? 'River Dart (depths and stream provisional)' : ui.dart.status === 'loading' ? 'loading the River Dart…' : 'open water'} · {conditionsText(ui.scenario)} · coefficients estimated · not for navigation
      </footer>
      {ui.showHelp && <Help onClose={() => ctl.toggleHelp(false)} />}
    </div>
  );
}
