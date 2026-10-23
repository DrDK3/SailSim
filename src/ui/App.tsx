import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimController } from '../app/controller';
import { Instruments } from './Instruments';
import { Controls } from './Controls';
import { Minimap } from './Minimap';
import { RacePanel } from './RacePanel';
import { SKY_PRESETS } from '../sim/env/sky';
import { ReplayBar } from './ReplayBar';
import type { CameraMode } from '../render/scene';
import type { AppScenario } from '../app/controller';

/** Panels opened on demand load their code when first opened (docs/PERFORMANCE.md). */
const DebugPanel = lazy(() => import('./DebugPanel').then((m) => ({ default: m.DebugPanel })));
const ScenarioPanel = lazy(() => import('./ScenarioPanel').then((m) => ({ default: m.ScenarioPanel })));
const Help = lazy(() => import('./Help').then((m) => ({ default: m.Help })));
const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const PolarPanel = lazy(() => import('./PolarPanel').then((m) => ({ default: m.PolarPanel })));
const LayersPanel = lazy(() => import('./LayersPanel').then((m) => ({ default: m.LayersPanel })));
const ResultsPanel = lazy(() => import('./ResultsPanel').then((m) => ({ default: m.ResultsPanel })));
const CourseEditor = lazy(() => import('./CourseEditor').then((m) => ({ default: m.CourseEditor })));
const LibraryPanel = lazy(() => import('./LibraryPanel').then((m) => ({ default: m.LibraryPanel })));

function conditionsText(sc: AppScenario): string {
  const c = sc.conditions;
  const wind = c.weather.source === 'manual' ? `wind ${c.weather.twsKn} kn from ${c.weather.twdDeg}°` : `Met Office UKV model wind${c.weather.replay ? ' (replay)' : ''}`;
  const tide = c.tide ? `tide ${c.tide.mode}` : 'no tide';
  const cur = c.current.mode === 'tidal' ? 'modelled tidal stream' : c.current.mode === 'uniform' ? `current ${c.current.rateKn} kn` : 'no current';
  const course = sc.course ? (sc.course.source === 'practice' ? ` · practice course (simulated)` : ' · course set') : '';
  const fleet = sc.course && sc.fleet?.aiCount ? ` · ${sc.fleet.aiCount} AI boat${sc.fleet.aiCount === 1 ? '' : 's'}` : '';
  const sky = c.sky?.source === 'preset' && c.sky.preset !== 'clear' ? ` · ${SKY_PRESETS[c.sky.preset].label.toLowerCase()}` : '';
  return `${wind} · ${c.gusts.preset} gusts · ${tide} · ${cur}${sky}${course}${fleet}`;
}

export function App({ ctl }: { ctl: SimController }) {
  const host = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  // Side panels open just below the toolbar, which wraps to two rows on narrower screens.
  const [sideTop, setSideTop] = useState<number>();
  const ui = useSyncExternalStore(ctl.subscribe, ctl.getState);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    const nav = toolbar.current;
    if (!nav) return;
    const place = () => {
      const r = nav.getBoundingClientRect();
      // On small screens the toolbar sits at the bottom (styles.css): keep the default position then.
      setSideTop(r.top < window.innerHeight / 2 ? Math.round(r.bottom + 8) : undefined);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, []);

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
      <nav ref={toolbar} className="panel toolbar" aria-label="Simulation">
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
        <button aria-pressed={libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)} title="Scenario library and replays">Library</button>
        <button aria-pressed={ui.showLabels} onClick={() => ctl.toggleLabels()} title="Place labels (L)">Labels</button>
        <button aria-pressed={ui.showMinimap} onClick={() => ctl.toggleMinimap()} title="Minimap (N)">Map</button>
        <button aria-pressed={ui.showLayers} onClick={() => ctl.toggleLayers()} title="Layers, provisional elements and sources">Layers</button>
        <button aria-pressed={ui.showEditor} onClick={() => ctl.toggleEditor()} title="Course editor">Courses</button>
        <button onClick={() => ctl.toggleHelp()} title="Help (H)">Help</button>
      </nav>
      <div className="side" style={sideTop === undefined ? undefined : { top: sideTop, maxHeight: `calc(100% - ${sideTop + 230}px)` }}>
        <Suspense fallback={null}>{scenarioOpen && <ScenarioPanel ctl={ctl} ui={ui} onClose={() => setScenarioOpen(false)} />}</Suspense>
        <Suspense fallback={null}>{libraryOpen && <LibraryPanel ctl={ctl} ui={ui} onClose={() => setLibraryOpen(false)} />}</Suspense>
        <Suspense fallback={null}>{ui.showPolar && <PolarPanel onClose={() => ctl.togglePolar(false)} />}</Suspense>
        <Suspense fallback={null}>{ui.showDebug && <DebugPanel ui={ui} />}</Suspense>
      </div>
      <Suspense fallback={null}>{ui.showDashboard && <Dashboard ctl={ctl} ui={ui} onClose={() => ctl.toggleDashboard(false)} />}</Suspense>
      {ui.replay ? <ReplayBar ctl={ctl} ui={ui} /> : <Controls ctl={ctl} ui={ui} />}
      {ui.paused && <div className="banner">{ui.replay?.finished ? 'End of the replay: “Take over” to sail on' : 'Paused (P to resume)'}</div>}
      {ui.contact && <div className="banner error contact-banner" role="alert" data-testid="contact">{ui.contact}</div>}
      {ui.showMinimap && <Minimap ctl={ctl} ui={ui} />}
      {(ui.dart.issues.length > 0 || ui.dart.status === 'unavailable') && (
        <div className="banner warn-banner" role="alert" data-testid="dart-warning">
          {ui.dart.status === 'unavailable' ? 'River Dart data could not be loaded: sailing on open water.' : `Some River Dart data failed to load (${ui.dart.issues.map((i) => i.asset).join(', ')}).`}{' '}
          <button onClick={() => ctl.toggleLayers(true)}>Details</button>
        </div>
      )}
      <Suspense fallback={null}>{ui.showLayers && <LayersPanel ctl={ctl} ui={ui} onClose={() => ctl.toggleLayers(false)} />}</Suspense>
      {ui.race && <RacePanel race={ui.race} ctl={ctl} />}
      <Suspense fallback={null}>{ui.race?.results && ui.showResults && <ResultsPanel rows={ui.race.results} final={ui.race.raceOver} onClose={() => ctl.toggleResults(false)} />}</Suspense>
      <Suspense fallback={null}>{ui.showEditor && <CourseEditor ctl={ctl} ui={ui} onClose={() => ctl.toggleEditor(false)} />}</Suspense>
      <footer className="badge">
        Phase 6 · {ui.dart.status === 'loaded' ? 'River Dart (depths and stream provisional)' : ui.dart.status === 'loading' ? 'loading the River Dart…' : 'open water'} · {conditionsText(ui.scenario)} · coefficients estimated · not for navigation
      </footer>
      <Suspense fallback={null}>{ui.showHelp && <Help onClose={() => ctl.toggleHelp(false)} />}</Suspense>
    </div>
  );
}
