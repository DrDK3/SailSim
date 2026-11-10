import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimController } from '../app/controller';
import { Instruments } from './Instruments';
import { DamageBanner, DamageCard } from './DamageCard';
import { Controls } from './Controls';
import { Minimap } from './Minimap';
import { RacePanel } from './RacePanel';
import { CoachCard, CoachTip } from './Coach';
import { HintCard } from './HintCard';
import { GhostStatus, ResumeCard } from './ResumeCard';
import { ReplayBar } from './ReplayBar';
import { Menu } from './Menu';
import { TutorialPanel } from './TutorialPanel';
import { ExperienceHub, markWelcomed, shouldWelcome } from './Welcome';
import { hasStoredLevel } from '../app/level';
import { Confirm } from './Confirm';
import { activityOf } from './activity';
import { ActivityIcon } from './icons';
import type { CameraMode } from '../render/scene';

/** Panels opened on demand load their code when first opened (docs/PERFORMANCE.md). */
const DebugPanel = lazy(() => import('./DebugPanel').then((m) => ({ default: m.DebugPanel })));
const ScenarioPanel = lazy(() => import('./ScenarioPanel').then((m) => ({ default: m.ScenarioPanel })));
const Help = lazy(() => import('./Help').then((m) => ({ default: m.Help })));
const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const PolarPanel = lazy(() => import('./PolarPanel').then((m) => ({ default: m.PolarPanel })));
const LayersPanel = lazy(() => import('./LayersPanel').then((m) => ({ default: m.LayersPanel })));
const SettingsPanel = lazy(() => import('./SettingsPanel').then((m) => ({ default: m.SettingsPanel })));
const ResultsPanel = lazy(() => import('./ResultsPanel').then((m) => ({ default: m.ResultsPanel })));
const CourseEditor = lazy(() => import('./CourseEditor').then((m) => ({ default: m.CourseEditor })));
const LibraryPanel = lazy(() => import('./LibraryPanel').then((m) => ({ default: m.LibraryPanel })));
const QuickRacePanel = lazy(() => import('./QuickRacePanel').then((m) => ({ default: m.QuickRacePanel })));

const CONTROLS_KEY = 'squib.controls.hidden';

/** A remembered on/off choice (localStorage may be unavailable: then it lasts for the visit). */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // storage unavailable
  }
}

export function App({ ctl }: { ctl: SimController }) {
  const host = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  // Side panels open just below the toolbar, which wraps to two rows on narrower screens.
  const [sideTop, setSideTop] = useState<number>();
  // The camera hint strip sits just below the toolbar, however many rows the toolbar wraps onto.
  const [barTop, setBarTop] = useState<number>();
  // The left column (instruments, race, coach) stops above the dock and scrolls, whatever their heights (UX-5).
  // How much of the toolbar shows on one row (owner review, 4 Nov 2026: no wrapping, no blank space).
  const [density, setDensity] = useState<'full' | 'compact' | 'minimal' | 'menu'>('full');
  const ui = useSyncExternalStore(ctl.subscribe, ctl.getState);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [raceOpen, setRaceOpen] = useState(false);
  // The experience hub: by itself on the first visit only; the activity button brings it back.
  const [hubFirst, setHubFirst] = useState(shouldWelcome);
  const [hubOpen, setHubOpen] = useState(hubFirst);
  // A first visit with no level chosen yet starts at Learn ("Not yet" in the welcome's question), so that
  // "Sail now" starts lesson 1; answering the question changes it.
  useEffect(() => {
    if (hubFirst && !hasStoredLevel()) ctl.setLevel('learn');
  }, []);
  // Small screens: the toolbar folds behind a Menu button (styles.css).
  const [toolsOpen, setToolsOpen] = useState(false);
  // The sailing controls can be put away (keyboard sailors), remembered in this browser.
  const [controlsHidden, setControlsHiddenState] = useState(() => readFlag(CONTROLS_KEY));
  const setControlsHidden = (v: boolean) => {
    setControlsHiddenState(v);
    writeFlag(CONTROLS_KEY, v);
  };
  // One side panel at a time: opening one of Race, Library and Scenario closes the others.
  const openScenario = (open: boolean) => {
    setScenarioOpen(open);
    if (open) {
      setLibraryOpen(false);
      setRaceOpen(false);
    }
  };
  const openLibrary = (open: boolean) => {
    setLibraryOpen(open);
    if (open) {
      setScenarioOpen(false);
      setRaceOpen(false);
    }
  };
  const openRace = (open: boolean) => {
    setRaceOpen(open);
    if (open) {
      setScenarioOpen(false);
      setLibraryOpen(false);
    }
  };
  const closeHub = (then?: () => void) => {
    markWelcomed();
    setHubOpen(false);
    setHubFirst(false);
    then?.();
  };
  const activity = activityOf(ui);
  const startTutorial = () => ctl.leaveTo('Starting a lesson', () => ctl.startTutorial());

  // Escape closes the panels this component owns (the controller closes help, polar and layers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setScenarioOpen(false);
      setLibraryOpen(false);
      setRaceOpen(false);
      setToolsOpen(false);
      ctl.toggleEditor(false);
      ctl.toggleDashboard(false);
      ctl.toggleResults(false);
      if (ctl.getState().confirmReset) ctl.answerReset(false);
      if (ctl.getState().confirmLeave) ctl.answerLeave(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  useEffect(() => {
    const nav = toolbar.current;
    if (!nav) return;
    const instruments = document.querySelector<HTMLElement>('.hud-left');
    const dockNow = () => document.querySelector<HTMLElement>('.controls, .controls-show');
    const dock = dockNow();
    const root = nav.parentElement;
    const place = () => {
      // The toolbar keeps clear of the left column, however wide the column's panels make it (UX-5).
      if (instruments && root) root.style.setProperty('--hud-w', `${Math.round(instruments.getBoundingClientRect().width)}px`);
      // One row, sized to its content: the fullest form that fits beside the left column (labels shorten, then
      // the less used buttons move into More, then everything goes behind the Menu button as on a phone).
      if (window.innerWidth > 700 && instruments) {
        const avail = window.innerWidth - instruments.getBoundingClientRect().right - 12 - 12;
        let d: typeof density = 'menu';
        for (const k of ['full', 'compact', 'minimal'] as const) {
          nav.dataset.density = k;
          if (nav.offsetWidth <= avail) {
            d = k;
            break;
          }
        }
        nav.dataset.density = d;
        setDensity(d);
      } else {
        nav.dataset.density = 'menu';
        setDensity('menu');
      }
      const r = nav.getBoundingClientRect();
      // On tablets the toolbar sits at the bottom (styles.css): keep the default position then.
      let top = r.top < window.innerHeight / 2 ? r.bottom + 8 : undefined;
      setBarTop(top === undefined ? undefined : Math.round(top));
      // On phones the instruments span the top: open panels (the tutorial too) below them, not over them.
      if (window.innerWidth <= 700 && instruments) top = Math.max(top ?? 0, instruments.getBoundingClientRect().bottom + 8);
      setSideTop(top === undefined ? undefined : Math.round(top));
      if (instruments) {
        const h = instruments.getBoundingClientRect();
        const d = dockNow()?.getBoundingClientRect();
        // Above the dock where the two share columns of the screen; otherwise down to the bottom edge. Written
        // straight to the column (no re-render); styles.css also caps it above the console, whose height is fixed
        // at each width, so a measurement taken before a resize has settled cannot let the two overlap.
        const bottom = d && d.height > 0 && d.left < h.right && d.right > h.left ? d.top - 8 : window.innerHeight - 8;
        instruments.style.setProperty('--hud-js', `${Math.max(96, Math.floor(bottom - h.top))}px`);
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    if (instruments) ro.observe(instruments);
    if (dock) ro.observe(dock);
    // The window's resize event can come before the new layout; the root's size comes after it.
    if (root) ro.observe(root);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [controlsHidden, !!ui.replay]);

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
    <div className={`app${ui.showMinimap ? ' has-minimap' : ''}${!ui.replay && !controlsHidden ? ' console-on' : ''}`}>
      <div ref={host} className="viewport" data-testid="viewport" />
      {ui.webglError && <div className="banner error" role="alert">{ui.webglError}</div>}
      <DamageBanner ctl={ctl} ui={ui} />
      {ui.graphicsLost && (
        <div className="banner error" role="alert" data-testid="graphics-lost">
          The browser reset the graphics. Restoring the picture… The simulation is paused and carries on when the picture is back.{' '}
          <button onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      )}
      {/* What the helmsman reads, together on the left: the instruments, and the race when there is one. */}
      <div className="hud-left">
        <Instruments s={ui.snapshot} level={ui.level} />
        <DamageCard ctl={ctl} ui={ui} />
        {ui.race && <RacePanel race={ui.race} ctl={ctl} caption={ui.soundCaption} />}
        {ui.race && <CoachCard ctl={ctl} ui={ui} />}
      </div>
      <nav ref={toolbar} className={`panel toolbar ${toolsOpen ? 'open' : ''}`} aria-label="Simulation" data-density={density}>
        <button className="tb-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>
          {toolsOpen ? 'Close menu' : 'Menu'}
        </button>
        <div className="tb-items">
          {/* What you are doing, and the way to the other experiences. */}
          <div className="tb-group">
            <button
              className="activity-chip"
              data-kind={activity.kind}
              onClick={() => {
                setToolsOpen(false);
                setHubOpen(true);
              }}
              aria-haspopup="dialog"
              aria-label={`Activity: ${activity.label}${activity.detail ? `, ${activity.detail}` : ''}. Choose another`}
              title={`${activity.label}${activity.detail ? ` · ${activity.detail}` : ''}: learn to sail, sail freely, race against AI or choose a scenario`}
              data-testid="activity"
            >
              <ActivityIcon kind={activity.kind} />
              <span className="chip-label">{activity.label}</span>
              {activity.detail && <span className="chip-detail">{activity.detail}</span>}
              <span className="chip-caret" aria-hidden="true">▾</span>
            </button>
          </div>
          {/* Playback: the commonest actions, first. */}
          <div className="tb-group">
            <button className="tb-primary" onClick={() => ctl.togglePause()} data-testid="pause" title="Pause or resume (P)">
              <span className="icon" aria-hidden="true">{ui.paused ? '▶' : '❚❚'}</span>
              {ui.paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => ctl.requestReset()} title="Reset to the scenario start (R)" aria-label="Reset">
              <span className="icon" aria-hidden="true">↺</span>
              <span className="tb-label">Reset</span>
            </button>
            <label className="select">
              <span className="sr-only">Camera</span>
              <select
                value={ui.camera}
                onChange={(e) => {
                  ctl.setCamera(e.target.value as CameraMode);
                  // Back to the water: the keys sail the boat again at once (the list kept them otherwise).
                  e.currentTarget.blur();
                }}
                title="Camera (C cycles)"
              >
                <option value="chase">Chase view</option>
                <option value="scenic">Scenic (wide, slow orbit)</option>
                <option value="helm">Helm (first person)</option>
                <option value="orbit">Orbit the boat</option>
                <option value="drone">Drone (fly and pan)</option>
                <option value="top">Top-down</option>
                <option value="line" disabled={!ui.race}>Start line (from the committee boat){ui.race ? '' : ': with a course'}</option>
              </select>
            </label>
          </div>
          {/* Setting up a sail: ready-made scenarios, or your own. */}
          <div className="tb-group">
            <button aria-pressed={raceOpen} onClick={() => openRace(!raceOpen)} title="Race: today\u2019s challenge, or choose the course, the fleet, the start and the conditions">Race</button>
            <button className="tb-secondary" aria-pressed={libraryOpen} onClick={() => openLibrary(!libraryOpen)} title="Ready-made scenarios, your saved ones, and replays" data-tutorial="library">Library</button>
            <button className="tb-secondary" aria-pressed={scenarioOpen} onClick={() => openScenario(!scenarioOpen)} title="Set up wind, tide, place, course and fleet">Scenario</button>
          </div>
          {/* Everything else, one click further away. */}
          <div className="tb-group">
            <Menu
              label="More"
              title="Lessons, course editor, what is shown, and physics tools"
              items={[
                { section: 'Learn and plan', label: 'Lessons', checked: !!ui.tutorial, onSelect: () => (ui.tutorial ? ctl.endTutorial() : startTutorial()) },
                { label: 'Teaching overlay', checked: ui.teaching, onSelect: () => ctl.toggleTeaching() },
                { label: 'Course editor', checked: ui.showEditor, onSelect: () => ctl.toggleEditor() },
                { label: 'Race coach', checked: ui.coach?.on ?? ctl.coachEnabled, onSelect: () => ctl.toggleCoach() },
                { section: 'Show', label: 'Place labels', keys: 'L', checked: ui.showLabels, onSelect: () => ctl.toggleLabels() },
                { label: 'Minimap', keys: 'N', checked: ui.showMinimap, onSelect: () => ctl.toggleMinimap() },
                { label: 'Sailing controls', checked: !controlsHidden, onSelect: () => setControlsHidden(!controlsHidden) },
                { label: 'Force arrows', keys: 'F', checked: ui.showForces, onSelect: () => ctl.toggleForces() },
                { label: 'Layers and sources', checked: ui.showLayers, onSelect: () => ctl.toggleLayers() },
                { section: 'Settings', label: 'Graphics and sound', checked: ui.showSettings, onSelect: () => ctl.toggleSettings() },
                { label: ui.audio.muted ? 'Sound off' : 'Sound on', keys: 'U', checked: !ui.audio.muted, onSelect: () => ctl.toggleMute() },
                { section: 'Physics tools', label: 'Validation dashboard', keys: 'V', checked: ui.showDashboard, onSelect: () => ctl.toggleDashboard() },
                { label: 'Polar sweep', checked: ui.showPolar, onSelect: () => ctl.togglePolar() },
                { label: 'Physics panel', keys: 'G', checked: ui.showDebug, onSelect: () => ctl.toggleDebug() },
              ]}
            />
            <button className="tb-help" onClick={() => ctl.toggleHelp()} title="Help and keys (H)" data-tutorial="help" aria-label="Help">
              <span aria-hidden="true">?</span>
            </button>
          </div>
        </div>
      </nav>
      <div className="side" style={sideTop === undefined ? undefined : { top: sideTop, maxHeight: `calc(100% - ${sideTop + 230}px)` }}>
        {ui.tutorial && <TutorialPanel ctl={ctl} ui={ui} onRace={() => openRace(true)} />}
        <Suspense fallback={null}>{scenarioOpen && <ScenarioPanel ctl={ctl} ui={ui} onClose={() => openScenario(false)} onRace={() => openRace(true)} />}</Suspense>
        <Suspense fallback={null}>{libraryOpen && <LibraryPanel ctl={ctl} ui={ui} onClose={() => openLibrary(false)} />}</Suspense>
        <Suspense fallback={null}>{raceOpen && <QuickRacePanel ctl={ctl} ui={ui} onClose={() => openRace(false)} />}</Suspense>
        <Suspense fallback={null}>{ui.showPolar && <PolarPanel onClose={() => ctl.togglePolar(false)} />}</Suspense>
        <Suspense fallback={null}>{ui.showDebug && <DebugPanel ui={ui} />}</Suspense>
      </div>
      <Suspense fallback={null}>{ui.showDashboard && <Dashboard ctl={ctl} ui={ui} onClose={() => ctl.toggleDashboard(false)} />}</Suspense>
      {ui.replay && ui.ghostLoading === undefined && ui.catchingUp === undefined ? (
        <ReplayBar ctl={ctl} ui={ui} />
      ) : controlsHidden ? (
        <button className="panel controls-show" onClick={() => setControlsHidden(false)} title="Show the trim, helm and crew controls">
          Show sailing controls
        </button>
      ) : (
        <Controls ctl={ctl} ui={ui} onHide={() => setControlsHidden(true)} />
      )}
      {ui.camera === 'drone' && (
        <div className="camera-bar panel" role="group" aria-label="Drone view" style={barTop === undefined ? undefined : { top: barTop }}>
          <span className="fine">Drag to turn · right-drag or two fingers to pan · wheel to climb</span>
          <button onClick={() => ctl.centreDrone()} title="Fly back to the boat (B)">Back to boat <kbd className="key-hint" aria-hidden="true">B</kbd></button>
          <label className="toggle" title="Carry the view along with the boat">
            <input type="checkbox" checked={ui.droneFollow} onChange={(e) => ctl.setDroneFollow(e.target.checked)} />
            Follow
          </label>
        </div>
      )}
      {ui.camera === 'helm' && (
        <div className="camera-bar panel" role="note" aria-label="Helm view" style={barTop === undefined ? undefined : { top: barTop }}>
          <span className="fine">Drag to look around · double-click to look ahead · wheel to zoom</span>
        </div>
      )}
      <CoachTip ui={ui} />
      {ui.ghostLoading !== undefined ? <GhostStatus ctl={ctl} ui={ui} /> : ui.resume || ui.catchingUp !== undefined ? <ResumeCard ctl={ctl} ui={ui} /> : !ui.tutorial && <HintCard ctl={ctl} ui={ui} />}
      {ui.ghost && ui.ghostLoading === undefined && <GhostStatus ctl={ctl} ui={ui} />}
      {ui.paused && (
        // Below the toolbar however many rows it wraps onto (it covered the pill on a two-row toolbar), and below
        // a camera strip if one is showing.
        <div className="banner paused-pill" role="status" style={barTop === undefined || window.innerWidth <= 700 ? undefined : { top: barTop + (ui.camera === 'drone' || ui.camera === 'helm' ? 48 : 4) }}>
          {ui.replay?.finished ? 'End of the replay: “Take over” to sail on' : 'Paused (P to resume)'}
        </div>
      )}
      {ui.runningSlow && (
        // Same place as the paused pill (the two never show together).
        <div className="banner paused-pill slow-pill" role="status" data-testid="running-slow" style={barTop === undefined || window.innerWidth <= 700 ? undefined : { top: barTop + (ui.camera === 'drone' || ui.camera === 'helm' ? 48 : 4) }}>
          Running slow: {Math.round(ui.runningSlow.ratio * 100)}% of real time
          {ui.runningSlow.lowered ? ` · graphics lowered to ${ui.runningSlow.lowered[0]!.toUpperCase()}${ui.runningSlow.lowered.slice(1)}` : ''}
        </div>
      )}
      {ui.contact && <div className="banner error contact-banner" role="alert" data-testid="contact">{ui.contact}</div>}
      {ui.showMinimap && <Minimap ctl={ctl} ui={ui} />}
      {(ui.dart.issues.length > 0 || ui.dart.status === 'unavailable') && (
        <div className="banner warn-banner" role="alert" data-testid="dart-warning">
          {ui.dart.status === 'unavailable' ? 'River Dart data could not be loaded: sailing on open water.' : `Some River Dart data failed to load (${ui.dart.issues.map((i) => i.asset).join(', ')}).`}{' '}
          <button onClick={() => ctl.toggleLayers(true)}>Details</button>
        </div>
      )}
      <Suspense fallback={null}>{ui.showLayers && <LayersPanel ctl={ctl} ui={ui} onClose={() => ctl.toggleLayers(false)} />}</Suspense>
      <Suspense fallback={null}>{ui.showSettings && <SettingsPanel ctl={ctl} ui={ui} onClose={() => ctl.toggleSettings(false)} />}</Suspense>
      <Suspense fallback={null}>{ui.race?.results && ui.showResults && <ResultsPanel rows={ui.race.results} final={ui.race.raceOver} onClose={() => ctl.toggleResults(false)} />}</Suspense>
      <Suspense fallback={null}>{ui.showEditor && <CourseEditor ctl={ctl} ui={ui} onClose={() => ctl.toggleEditor(false)} />}</Suspense>
      <Suspense fallback={null}>
        {ui.showHelp && (
          <Help
            onClose={() => ctl.toggleHelp(false)}
            build={ui.build}
            onTutorial={() => {
              ctl.toggleHelp(false);
              startTutorial();
            }}
          />
        )}
      </Suspense>
      {ui.confirmReset && (
        <Confirm id="reset" title="Restart the race?" keep="Keep racing" go="Restart" onAnswer={(yes) => ctl.answerReset(yes)} testId="confirm-reset">
          The race has started. Resetting goes back to the beginning of the sequence and your progress is lost.
        </Confirm>
      )}
      {hubOpen && (
        <ExperienceHub
          first={hubFirst}
          activity={activity}
          onClose={() => closeHub()}
          onLearn={() => closeHub(startTutorial)}
          onFree={() => closeHub(() => ctl.leaveTo('Free sailing', () => ctl.freeSail()))}
          onRace={() => closeHub(() => openRace(true))}
          onScenarios={() => closeHub(() => openLibrary(true))}
          steering={ui.steering}
          level={ui.level}
          onAnswer={(l, m) => {
            ctl.setLevel(l);
            ctl.setSteering(m);
          }}
          onSailNow={() => closeHub(() => (ui.level === 'learn' ? ctl.leaveTo('Starting lesson 1', () => ctl.startLesson('steer')) : ctl.leaveTo('Free sailing', () => ctl.freeSail())))}
          lessonsDone={ui.lessons.filter((l) => l.done && l.group === 'basics').length}
        />
      )}
      {ui.confirmLeave && (
        <Confirm id="leave" title="Leave the race?" keep="Keep racing" go="Leave the race" onAnswer={(yes) => ctl.answerLeave(yes)} testId="confirm-leave">
          The race is under way. {ui.confirmLeave} ends it, and the race is lost.
        </Confirm>
      )}
    </div>
  );
}
