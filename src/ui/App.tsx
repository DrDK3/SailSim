import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimController } from '../app/controller';
import { Instruments } from './Instruments';
import { Controls } from './Controls';
import { Minimap } from './Minimap';
import { RacePanel } from './RacePanel';
import { SKY_PRESETS } from '../sim/env/sky';
import { ReplayBar } from './ReplayBar';
import { Menu } from './Menu';
import { TutorialPanel } from './TutorialPanel';
import { Welcome, markWelcomed, shouldWelcome } from './Welcome';
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
  const [welcome, setWelcome] = useState(shouldWelcome);
  // Small screens: the toolbar folds behind a Menu button (styles.css).
  const [toolsOpen, setToolsOpen] = useState(false);
  // One side panel at a time: opening Scenario closes the Library and the other way round.
  const openScenario = (open: boolean) => {
    setScenarioOpen(open);
    if (open) setLibraryOpen(false);
  };
  const openLibrary = (open: boolean) => {
    setLibraryOpen(open);
    if (open) setScenarioOpen(false);
  };
  const closeWelcome = (then?: () => void) => {
    markWelcomed();
    setWelcome(false);
    then?.();
  };

  // Escape closes the panels this component owns (the controller closes help, polar and layers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setScenarioOpen(false);
      setLibraryOpen(false);
      setToolsOpen(false);
      ctl.toggleEditor(false);
      ctl.toggleDashboard(false);
      ctl.toggleResults(false);
      if (ctl.getState().confirmReset) ctl.answerReset(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  useEffect(() => {
    const nav = toolbar.current;
    if (!nav) return;
    const instruments = document.querySelector<HTMLElement>('.instruments');
    const place = () => {
      const r = nav.getBoundingClientRect();
      // On tablets the toolbar sits at the bottom (styles.css): keep the default position then.
      let top = r.top < window.innerHeight / 2 ? r.bottom + 8 : undefined;
      // On phones the instruments span the top: open panels (the tutorial too) below them, not over them.
      if (window.innerWidth <= 700 && instruments) top = Math.max(top ?? 0, instruments.getBoundingClientRect().bottom + 8);
      setSideTop(top === undefined ? undefined : Math.round(top));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    if (instruments) ro.observe(instruments);
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
      <nav ref={toolbar} className={`panel toolbar ${toolsOpen ? 'open' : ''}`} aria-label="Simulation">
        <button className="tb-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>
          {toolsOpen ? 'Close menu' : 'Menu'}
        </button>
        <div className="tb-items">
          <div className="tb-group">
            <button onClick={() => ctl.togglePause()} data-testid="pause" title="Pause or resume (P)">{ui.paused ? 'Resume' : 'Pause'}</button>
            <button onClick={() => ctl.requestReset()} title="Reset to the scenario start (R)">Reset</button>
            <label className="select">
              <span className="sr-only">Camera</span>
              <select value={ui.camera} onChange={(e) => ctl.setCamera(e.target.value as CameraMode)} title="Camera (C cycles)">
                <option value="chase">Chase view</option>
                <option value="helm">Helm view</option>
                <option value="orbit">Orbit (drag)</option>
                <option value="top">Top-down</option>
              </select>
            </label>
          </div>
          <div className="tb-group">
            <button aria-pressed={!!ui.tutorial} onClick={() => (ui.tutorial ? ctl.endTutorial() : ctl.startTutorial())} title="Learn to sail, step by step" data-tutorial="tutorial">
              Tutorial
            </button>
            <button aria-pressed={libraryOpen} onClick={() => openLibrary(!libraryOpen)} title="Ready-made scenarios, your saved ones, and replays" data-tutorial="library">Library</button>
            <button aria-pressed={scenarioOpen} onClick={() => openScenario(!scenarioOpen)} title="Set up wind, tide, place, course and fleet">Scenario</button>
            <button aria-pressed={ui.showEditor} onClick={() => ctl.toggleEditor()} title="Course editor">Courses</button>
          </div>
          <div className="tb-group">
            <Menu
              label="View"
              title="What is shown"
              items={[
                { label: 'Place labels', keys: 'L', checked: ui.showLabels, onSelect: () => ctl.toggleLabels() },
                { label: 'Minimap', keys: 'N', checked: ui.showMinimap, onSelect: () => ctl.toggleMinimap() },
                { label: 'Force arrows', keys: 'F', checked: ui.showForces, onSelect: () => ctl.toggleForces() },
                { label: 'Layers and sources', checked: ui.showLayers, onSelect: () => ctl.toggleLayers() },
              ]}
            />
            <Menu
              label="Tools"
              title="Physics and validation tools"
              items={[
                { label: 'Validation dashboard', keys: 'V', checked: ui.showDashboard, onSelect: () => ctl.toggleDashboard() },
                { label: 'Polar sweep', checked: ui.showPolar, onSelect: () => ctl.togglePolar() },
                { label: 'Physics panel', keys: 'G', checked: ui.showDebug, onSelect: () => ctl.toggleDebug() },
              ]}
            />
            <button onClick={() => ctl.toggleHelp()} title="Help and keys (H)" data-tutorial="help">Help</button>
          </div>
        </div>
      </nav>
      <div className="side" style={sideTop === undefined ? undefined : { top: sideTop, maxHeight: `calc(100% - ${sideTop + 230}px)` }}>
        {ui.tutorial && <TutorialPanel ctl={ctl} ui={ui} />}
        <Suspense fallback={null}>{scenarioOpen && <ScenarioPanel ctl={ctl} ui={ui} onClose={() => openScenario(false)} />}</Suspense>
        <Suspense fallback={null}>{libraryOpen && <LibraryPanel ctl={ctl} ui={ui} onClose={() => openLibrary(false)} />}</Suspense>
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
        {ui.dart.status === 'loaded' ? 'River Dart (depths and stream provisional)' : ui.dart.status === 'loading' ? 'loading the River Dart…' : 'open water'} · {conditionsText(ui.scenario)} · physics estimated · not for navigation
      </footer>
      <Suspense fallback={null}>
        {ui.showHelp && (
          <Help
            onClose={() => ctl.toggleHelp(false)}
            onTutorial={() => {
              ctl.toggleHelp(false);
              ctl.startTutorial();
            }}
          />
        )}
      </Suspense>
      {ui.confirmReset && (
        <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" data-testid="confirm-reset">
          <section className="panel confirm">
            <h3 id="reset-title">Restart the race?</h3>
            <p>The race has started. Resetting goes back to the beginning of the sequence and your progress is lost.</p>
            <div className="row left">
              <button className="primary" autoFocus onClick={() => ctl.answerReset(false)}>Keep racing</button>
              <button onClick={() => ctl.answerReset(true)}>Restart</button>
            </div>
          </section>
        </div>
      )}
      {welcome && (
        <Welcome
          onTutorial={() => closeWelcome(() => ctl.startTutorial())}
          onLibrary={() => closeWelcome(() => openLibrary(true))}
          onExplore={() => closeWelcome()}
        />
      )}
    </div>
  );
}
