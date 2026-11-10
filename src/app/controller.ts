import { saveFix, type MaterialCheck, type MaterialFix } from '../render/gpuCheck';
import { signalCaption } from './signalCaption';
import { ocsGuide, type OcsGuide } from './ocsGuide';
import { helmAction, loadSteering, saveSteering, type SteeringMode } from './steering';
import { DT, Simulation, type BoatSnapshot, type ControlInput, type InputLogEntry } from '../sim/simulation';
import { quayPiers } from '../sim/env/quays';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { HintEngine, loadMilestones, loadSeenHints, saveMilestones, saveSeenHints, type Hint, type HintSample, type Milestones, type ShowMe } from './hints';
import { autopilotHelm } from '../sim/control/autopilot';
import type { ReportDetail } from './visualReport';
import { SignalScheduler, blastsInWords } from './soundSignals';
import { GHOST_EVERY, ghostPoseAt, poseOf } from './ghost';
import { RESUME_MIN_S, clearResume, loadResume, resumeSummary, saveResume } from './resume';
import type { PierInput } from '../sim/race/piers';
import { RDYC_FRONTAGE } from '../render/rdyc';
import { buildRiverTraffic, type RiverTraffic } from '../sim/env/traffic';
import { DEFAULT_SQUIB_TYPE, isSquibType, squibParams, squibTypeParams, type SquibTypeId } from '../sim/boat/squib';
import { buildConditions, type BuiltConditions, type ConditionsSettings } from '../sim/env/conditions';
import { clamp } from '../sim/math/angles';
import { optimalSheets } from '../sim/control/trim';
import { CAMERA_MODES, SceneView, type CameraMode, type SceneWeather } from '../render/scene';
import { Telemetry } from './telemetry';
import { loadDartData, type DartData } from './geoLoader';
import { DartScene } from '../render/dart';
import { courseFor, type CourseChoice } from './courseLibrary';
import type { ResolvedCourse } from '../sim/course/course';
import type { RaceEvent } from '../sim/course/judge';
import { DART_LEVELS, type CourseIssue } from '../sim/course/validate';
import { createRace, practiceLineLength, raceStructures, startClearWater, startPositions, type ClearWater } from '../sim/race/setup';
import { Fleet } from '../sim/race/fleet';
import { committeeHeading, mooredBoatPose, mooringSwingDeg } from '../sim/race/anchored';
import type { RaceSession, LogEntry } from '../sim/race/session';
import type { Flag, PrepFlag, ResultRow } from '../sim/race/committee';
import type { AiLevel } from '../sim/ai/skipper';
import type { FleetPose } from '../render/fleet';
import { buildRestrictions } from '../sim/course/restrictions';
import type { Course } from '../sim/course/types';
import { DART_PROJECTION, RDYC_ORIGIN } from '../sim/geo/projection';
import { sunPosition } from '../sim/env/sun';
import { presetSky } from '../sim/env/sky';
import { windFrom } from '../sim/boat/forces';
import type { CrewBuild } from '../render/crew';
import { loadLive, parseLiveIndex, type Freshness, type LiveIndexEntry } from '../sim/env/liveData';
import { CHECKPOINT_STEPS, REPLAY_SCHEMA, decodeInputs, encodeInputs, parseRecording, type Recording, type ReplayStatus } from './replay';
import { Tutorial, type TutorialState } from './tutorial';
import { courseKey, recordRaceTime, recordStart } from './bests';
import { levelDefaults, loadLevel, saveLevel, type InterfaceLevel } from './level';
import { LESSONS, lessonAfter, lessonById, lessonsIn, loadLessonProgress, nextLessonFor, saveLessonDone, type Lesson, type LessonGroup, type LessonId, type LessonProgress, type OverlayPart } from './lessons';
import { sailState } from './sailStatus';
import { RaceCoach, type Debrief, type Tip } from './coach';
import { quickRaceScenario, type QuickRaceOptions } from './quickRace';
import { SoundScape, type AudioSettings } from '../render/audio';
import { presetSettings, type GraphicsPreset, type GraphicsSettings } from '../render/graphics';
import { lightingStart, type LightingPreset } from './lighting';
import { freshLiveWeather, liveNowConditions, nowStartTime } from './liveNow';

/**
 * Start positions on the River Dart (local metres from the RDYC origin). Chosen in deep water from the
 * geodata (E); the heading is only the default.
 */
export const START_LOCATIONS = [
  { id: 'off-rdyc', label: 'Off RDYC, mid-river', n: 0, e: -150, headingDeg: 170 },
  { id: 'dart-marina', label: 'Off Dart Marina, upriver', n: 1150, e: -180, headingDeg: 170 },
  { id: 'entrance', label: 'Harbour entrance, between the castles', n: -680, e: 755, headingDeg: 150 },
  { id: 'start-bay', label: 'Start Bay, west of Castle Ledge buoy', n: -1800, e: 1300, headingDeg: 200 },
  { id: 'start-bay-practice', label: 'Start Bay practice area (open water)', n: -3500, e: 1200, headingDeg: 0 },
] as const;
export type StartLocationId = (typeof START_LOCATIONS)[number]['id'];

/** Everything needed to (re)start a run in the app. Serialisable, so runs can be shared and replayed. */
export interface AppScenario {
  conditions: ConditionsSettings;
  startLocation: StartLocationId;
  startHeadingDeg: number;
  startSpeedKn: number;
  /** Optional course to sail; practice courses are laid at the start position, relative to the wind. */
  course?: CourseChoice;
  /** Start sequence: kind, and when the start signal is (seconds after the run begins). */
  race?: { sequence: 'one-minute' | 'three-minute' | 'five-minute'; startInS: number };
  /** AI boats racing against the user (0 = sail the course alone), their level and the preparatory flag. */
  fleet?: { aiCount: number; level: AiLevel; prepFlag: PrepFlag };
  /** The user's Squib type (data/boats/squib/variants.json); default the Rondar. AI boats sail the default. */
  boat?: SquibTypeId;
  /** Who helms the user's boat, as drawn: a man (default) or a woman. Appearance only (the physics' crew weight is its calibration estimate). */
  helm?: CrewBuild;
}

/** One row of the live fleet ranking or the results. */
export interface FleetRow {
  id: string;
  name: string;
  sailNumber: string;
  colour: number;
  you: boolean;
  /** Live: legs completed; results: place. */
  place: number | null;
  code?: ResultRow['code'];
  elapsed?: number;
  points?: number;
  penalties?: string;
  status: string;
}

export interface RaceUi {
  courseName: string;
  courseStatus: Course['status'];
  phase: 'pre-start' | 'racing' | 'finished';
  /** Seconds to the start signal (negative after it). */
  toStart: number;
  nextSignal?: string;
  ocs: boolean;
  /** While OCS after the start: the nearer end of the line and which way it lies (src/app/ocsGuide.ts). */
  ocsGuide?: OcsGuide;
  mayStart: boolean;
  legIndex: number;
  legCount: number;
  lap: number;
  laps: number;
  nextLabel?: string;
  nextDistance?: number;
  nextBearingDeg?: number;
  startTime?: number;
  finishTime?: number;
  events: RaceEvent[];
  warnings: CourseIssue[];
  /** Flags the race committee is showing, and the signal log. */
  flags: Flag[];
  signals: LogEntry[];
  /** Race-wide log: signals, other boats' starts and roundings, incidents, penalties. */
  log: LogEntry[];
  attempt: number;
  prepFlag: PrepFlag;
  /** The user's place in the fleet now (by progress round the course), and the fleet size. */
  position?: number;
  fleetSize: number;
  /** Penalty turns the user still owes (0 = none). */
  penaltyOwed: number;
  /** Results (low points), once the race is over or the user has finished. */
  results?: FleetRow[];
  raceOver: boolean;
  disqualified?: string;
  /** Your start and finish against your bests in this browser (src/app/bests.ts). */
  best?: { start?: { delayS: number; best: boolean; previousS?: number }; finish?: { timeS: number; best: boolean; previousS?: number; label: string } };
}

export const DEFAULT_SCENARIO: AppScenario = {
  conditions: {
    startTime: '2026-07-15T13:00:00Z',
    weather: { source: 'manual', twsKn: 10, twdDeg: 225 },
    gusts: { preset: 'moderate', seed: 1 },
    current: { mode: 'none' },
  },
  startLocation: 'off-rdyc',
  startHeadingDeg: 170,
  startSpeedKn: 3,
};

/** A data file the app can offer as a weather or tide source. */
export interface DataSource {
  id: string;
  /** 'live' = rewritten by the scheduled job and judged by its freshness; 'replay' = a fixed recording. */
  kind: 'live' | 'replay';
  label: string;
  url: string;
  validTime?: string;
  json: unknown;
  /** For live files: fresh, stale (usable, with a warning) or expired (shown as a recording only). */
  freshness?: Freshness;
  /** Tide only: whether the gauge reading is recent enough to apply the measured surge. */
  gaugeUsable?: boolean;
}

export interface UiState {
  snapshot: BoatSnapshot;
  paused: boolean;
  camera: CameraMode;
  /** Drone view: carried along with the boat. */
  droneFollow: boolean;
  /** The race coach (races only): its briefing, latest tips and, after the finish, the debrief. */
  coach?: { on: boolean; briefing: string[]; tips: readonly Tip[]; debrief?: Debrief; now: number };
  /** A hint when you are stuck (src/app/hints.ts), and your first sails counted in this browser. */
  hint?: Hint;
  milestones: Milestones;
  /** A run kept from the last visit, offered as "Continue where you left off" (src/app/resume.ts). */
  resume?: { label: string; summary: string; note?: string };
  /** Sailing the kept run again to where it was left (0–1), before handing over. */
  catchingUp?: number;
  /** Racing a ghost: its title and how long its recording lasts; or learning its path (0–1). */
  ghost?: { title: string; endS: number };
  ghostLoading?: number;
  showForces: boolean;
  showDebug: boolean;
  showHelp: boolean;
  showDashboard: boolean;
  showPolar: boolean;
  scenario: AppScenario;
  envLabel: string;
  fps: number;
  physicsMsPerFrame: number;
  webglError?: string;
  /** The browser has taken the GPU context away: the picture is gone until it is restored (the run is paused). */
  graphicsLost?: boolean;
  /** The simulation is not keeping up with real time: the share it manages, and any preset the graphics were lowered to. */
  runningSlow?: { ratio: number; lowered?: string };
  autoLowerGraphics: boolean;
  /** The player's preferences kept in this browser (src/app/prefs.ts). */
  prefs: Prefs;
  scenarioError?: string;
  race?: RaceUi;
  weatherSources: DataSource[];
  tideSources: DataSource[];
  /** Problems finding or reading the live-data files (shown in the scenario panel). */
  liveIssues: string[];
  /** Playing back a recording (controls disabled until "Take over"). */
  replay?: ReplayStatus;
  /** Simulation speed relative to real time (1, 2, 4, 8). */
  timeScale: number;
  /** The lesson running (src/app/lessons.ts), with its step, and its result card once it is finished. */
  tutorial?: TutorialState & {
    finished: boolean;
    lesson: { id: LessonId; number: number; title: string; count: number; group: LessonGroup; inGroup: number };
    /** The result card: what you did, whether it was your best time, and the next lesson. */
    result?: { lines: string[]; best: boolean; next?: { id: LessonId; title: string } };
  };
  /** The six lessons, with what is done in this browser. */
  lessons: { id: LessonId; group: LessonGroup; number: number; title: string; summary: string; minutes: number; done: boolean; bestS?: number }[];
  /** The teaching overlay (heading, course over ground, stream, winds, VMG) is on outside the lessons. */
  teaching: boolean;
  /** How much the interface shows by default (src/app/level.ts). */
  level: InterfaceLevel;
  /** Reset was asked for during a race: the UI asks before throwing the race away. */
  confirmReset: boolean;
  /** Something else was asked for during a race (what, in a few words): the UI asks before leaving the race. */
  confirmLeave?: string;
  telemetryVersion: number;
  /** River Dart data: loading, loaded, or unavailable; plus anything that failed to load. */
  dart: { status: 'loading' | 'loaded' | 'unavailable'; issues: DartData['issues'] };
  showLabels: boolean;
  showMinimap: boolean;
  showLayers: boolean;
  showEditor: boolean;
  showResults: boolean;
  /** Other boats of the fleet (for the minimap), 10 Hz. */
  fleet: { id: string; n: number; e: number; heading: number; colour: number; label: string }[];
  /** The user's latest contact with a boat, mark, moored boat or ferry, for 8 s after it happened. */
  contact?: string;
  /** The latest race-committee sound signal in words, for 5 s after it (the visual equivalent of the horn, GR-6). */
  soundCaption?: string;
  /** Graphics and sound settings (the panel), and the scenery detail the view was built with. */
  showSettings: boolean;
  graphics?: GraphicsSettings;
  sceneryBuilt?: 'high' | 'low';
  shadowsBuilt?: 'standard' | 'fine';
  audio: AudioSettings;
  audioRunning: boolean;
  /** Which way the steering keys and buttons move the boat (src/app/steering.ts). */
  steering: SteeringMode;
  /** The graphics check of painted surfaces on this card (src/render/gpuCheck.ts), and the mode in use. */
  materialCheck?: { fault: boolean; reason: string; mode: string; at: string };
  materialMode?: MaterialFix;
  gpuName?: string;
  /** This build: the commit it was made from and when. */
  build: { id: string; time: string };
}

type Listener = () => void;

/** Helm and sheet rates for held keys/buttons (fraction of full travel per second). */
/** Sailing a recording through (continue, ghosts): run this long between letting the page update (ms). */
const CATCH_UP_SLICE_MS = 150;
const HELM_RATE = 1.4;
const HELM_RETURN = 1.8;
const SHEET_RATE = 0.35;
const MAX_STEPS_PER_FRAME = 12;
/** Identifies the build in recordings (Vite's mode and the package version; a commit id when CI provides one). */
const BUILD_ID = `${import.meta.env.MODE}-${import.meta.env.VITE_BUILD_ID ?? 'local'}`;
/** When this build was made (vite.config.ts), shown with the build id so the owner can tell which version runs. */
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown';
/** Fills a partial starting input to a full one for the recording. */
const DEFAULT_INPUT_FOR_RECORD: ControlInput = { helm: 0, mainSheet: 0.3, jibSheet: 0.3, autoMain: false, autoJib: true, crewHike: 0.6, autoCrew: true, flatten: 0 };

/** The list of live and replay data files served next to the app (public/live/README.md). */
const LIVE_INDEX = 'live/index.json';
/** Replays built into every deployment, tried when the index cannot be read. */
const BUNDLED_REPLAYS: LiveIndexEntry[] = [
  { path: 'metoffice-replay-2026-10-23T1400Z.json', kind: 'weather', mode: 'replay' },
  { path: 'metoffice-replay-2026-10-22T0715Z.json', kind: 'weather', mode: 'replay' },
];

/**
 * Owns the simulation and the render loop. Inputs (keys, buttons) are sampled once per physics step so
 * runs are reproducible from the input log. Publishes a UI snapshot ~10 times a second and records
 * telemetry for the validation dashboard at 10 Hz.
 */
export class SimController {
  sim!: Simulation;
  built!: BuiltConditions;
  readonly telemetry = new Telemetry();
  private view?: SceneView;
  private prevSnap!: BoatSnapshot;
  private currSnap!: BoatSnapshot;
  private detailSnap!: BoatSnapshot;
  private accumulator = 0;
  private lastFrame = 0;
  private renderTime = 0;
  private raf = 0;
  private paused = false;
  /** Pace against the wall clock (`watchPace`). */
  private readonly pace = { wall: 0, sim: 0, slowWindows: 0, lastLowered: -Infinity, skipFrames: 0 };
  private runningSlow?: { ratio: number; lowered?: GraphicsPreset };
  /** Step the graphics down when the simulation cannot keep up (a setting; on by default). */
  autoLowerGraphics = true;
  /** The player's own preferences, kept in this browser (src/app/prefs.ts). */
  prefs: Prefs = loadPrefs();
  private readonly hints = new HintEngine(loadSeenHints());
  /** Hints are kept out of automated test runs (?nowelcome) unless asked for (&hints): they appear on their own. */
  private readonly hintsAllowed = typeof location === 'undefined' || !new URLSearchParams(location.search).has('nowelcome') || new URLSearchParams(location.search).has('hints');
  private milestones: Milestones = loadMilestones();
  /** "Continue where you left off": the run kept from the last visit (not in automated tests unless &resume). */
  private resumePoint = typeof location === 'undefined' || !new URLSearchParams(location.search).has('nowelcome') || new URLSearchParams(location.search).has('resume') ? loadResume() : undefined;
  private catchUp?: { from: number; to: number };
  /** Ghost racing: the recorded boat's poses every GHOST_EVERY steps, and the scenario it belongs to. */
  private ghost?: { title: string; poses: FleetPose[]; scenario: string; endS: number };
  /** Sailing the ghost's recording through to learn its path (0–1). */
  private ghostLoading?: number;
  /** The tiller dragged on a touch screen: the helm it is being moved to. */
  private helmDrag?: number;
  /** Battery saver: when the last frame was drawn (ms). */
  private lastDrawn = -Infinity;
  /** "Show me": the boat sails herself out of trouble until `until` (simulated time). */
  private showMe?: { action: ShowMe; until: number; side: number };
  private lastMainSide = 0;
  /** The GPU context is lost, and whether that (not the user) paused the run. */
  private graphicsLost = false;
  private pausedForGraphics = false;
  private held = new Set<string>();
  private steeringMode: SteeringMode = loadSteering();
  private listeners = new Set<Listener>();
  private ui!: UiState;
  private lastPublish = 0;
  /** Real time (ms) of the last weather/sun update sent to the scene; -Infinity forces one. */
  private lastWeather = -Infinity;
  /** The input the user's boat was built with (part of a recording), and the state hashes so far. */
  private initialInput: ControlInput | null = null;
  private checkpoints: [number, string][] = [];
  /** Replay in progress: the recording, its decoded inputs and how far it has been checked. */
  private replay?: { rec: Recording; inputs: InputLogEntry[]; next: number; matched: number; total: number; verifiedTo: number; divergedAt?: number; ended: boolean; notes: string[] };
  private timeScale = 1;
  /** The lesson running (src/app/lessons.ts) and its step engine (src/app/tutorial.ts). */
  private tutorial?: Tutorial;
  private lesson?: Lesson;
  /** The lesson's buoy (local metres), placed from where the boat started. */
  private lessonTarget?: { n: number; e: number };
  private lessonResult?: { lines: string[]; best: boolean; next?: { id: LessonId; title: string } };
  private lessonProgress: LessonProgress = loadLessonProgress();
  /** Today's challenge, while it is the race being sailed. */
  private raceTag?: { key: string; scenario: string };
  /** This race's start and finish against your bests (once each). */
  private raceBest: NonNullable<RaceUi['best']> = {};
  /** The teaching overlay outside lessons (Settings; on by default at the Learn level). */
  private teachingOn = readFlag('squib.teaching', false);
  private interfaceLevel: InterfaceLevel = loadLevel();
  private confirmReset = false;
  private lastRecordT = -Infinity;
  private frames = 0;
  private coach?: RaceCoach;
  private debrief?: Debrief;
  private coachOn = readFlag('squib.coach', true);
  private fpsT0 = 0;
  private fps = 0;
  private physMs = 0;
  scenario: AppScenario = structuredClone(DEFAULT_SCENARIO);
  private showForces = false;
  private showDebug = false;
  private showHelp = false;
  private showDashboard = false;
  private showPolar = false;
  private webglError?: string;
  private scenarioError?: string;
  weatherSources: DataSource[] = [];
  tideSources: DataSource[] = [];
  liveIssues: string[] = [];
  dartData?: DartData;
  /** The river traffic of the current run (ferries, Dart Marina boats). */
  traffic?: RiverTraffic;
  private dartStatus: UiState['dart']['status'] = 'loading';
  private dartScene?: DartScene;
  private showLabels = true;
  /** The course being sailed, the race (fleet, committee, judges, rules) and the validator's warnings. */
  race?: { course: Course; resolved: ResolvedCourse; session: RaceSession; warnings: CourseIssue[] };
  private fleetPrev = new Map<string, FleetPose>();
  private fleetCurr = new Map<string, FleetPose>();
  private showResults = false;
  /** Free sailing: the user's boat in a one-boat fleet (contact with moored boats and ferries). */
  private soloFleet?: Fleet;
  private resultsShown = false;
  private showMinimap = true;
  private showLayers = false;
  private showEditor = false;

  constructor() {
    this.restart();
  }

  // ------------------------------------------------------------ lifecycle

  /** Start (or restart) a run. On invalid settings the previous run continues and the error is shown. */
  /**
   * Start (or restart) a run. `initialInput` overrides the input the user's boat is built with (a replay
   * passes the recorded one; by default the previous run's input carries over with the helm centred).
   */
  restart(scenario: AppScenario = this.scenario, opts: { initialInput?: ControlInput | null; keepReplay?: boolean } = {}): boolean {
    let built: BuiltConditions;
    const geo = this.dartData?.geo;
    try {
      built = buildConditions(scenario.conditions, geo);
    } catch (err) {
      this.scenarioError = (err as Error).message;
      this.publish(true);
      return false;
    }
    const loc = START_LOCATIONS.find((l) => l.id === scenario.startLocation) ?? START_LOCATIONS[0];
    const prevInput = this.sim?.input;
    const startInput: ControlInput | undefined =
      opts.initialInput !== undefined ? (opts.initialInput ?? undefined) : prevInput ? { ...prevInput, helm: 0 } : undefined;
    let race: SimController['race'];
    let sim: Simulation;
    const boatParams = squibTypeParams(isSquibType(scenario.boat) ? scenario.boat : DEFAULT_SQUIB_TYPE);
    // River traffic for this run (its ferries crab in this run's stream): shared by the physics and the picture.
    const feats = this.dartData?.features;
    const startMs = built.env.startEpochMs ?? Date.parse(scenario.conditions.startTime);
    const traffic = feats
      ? buildRiverTraffic({
          ferries: feats.ferries,
          current: (ms, n, e) => built.env.current((ms - startMs) / 1000, n, e),
          waterLevel: built.env.waterLevel ? (ms) => built.env.waterLevel!((ms - startMs) / 1000) : undefined,
          geo,
          moorings: feats.moorings,
          marinas: feats.marinas,
          piers: feats.piers,
        })
      : undefined;
    if (scenario.course) {
      try {
        const w = windFrom(built.env.wind(0, loc.n, loc.e));
        const fleet = scenario.fleet ?? { aiCount: 0, level: 'good' as AiLevel, prepFlag: 'P' as PrepFlag };
        const course = courseFor(scenario.course, { n: loc.n, e: loc.e }, (w.fromDir * 180) / Math.PI, practiceLineLength(fleet.aiCount + 1));
        const seq = scenario.race ?? { sequence: 'one-minute', startInS: 90 };
        const created = createRace({
          conditions: scenario.conditions,
          env: built.env,
          geo,
          features: this.dartData?.features ? { ...this.dartData.features, piers: [...this.dartData.features.piers, ...this.solidWalls()] } : undefined,
          course,
          aiCount: Math.max(0, Math.min(20, Math.round(fleet.aiCount))),
          level: fleet.level,
          seed: scenario.conditions.gusts.seed,
          human: {
            controller: () => this.sampleInputs(),
            input: startInput,
            params: boatParams,
            // Sailing the course alone: 100 m behind the line as before; with a fleet, the first starting slot.
            // Either way in clear water (not on the mud of a river bank).
            initial: fleet.aiCount > 0 ? undefined : (r) => preStartPosition(r, geo ? startClearWater(geo, built.env.waterLevel?.(0), boatParams.draft, feats?.mooringAreas.map((a) => ({ ring: a.ring.map(([e, n]) => ({ n, e })) })), [...raceStructures(feats, geo), ...this.solidWalls()]) : undefined),
          },
          committee: { startAt: Math.round(seq.startInS), sequence: seq.sequence, prepFlag: fleet.prepFlag },
          traffic,
        });
        const session = created.session;
        race = { course: created.course, resolved: session.course, session, warnings: created.warnings };
        sim = session.fleet.boat('you')!.sim;
      } catch (err) {
        this.scenarioError = (err as Error).message;
        this.publish(true);
        return false;
      }
    } else {
      // Free sailing: the user's boat alone in a one-boat fleet, so moored boats and ferries are solid.
      sim = new Simulation({
        params: boatParams,
        env: built.env,
        seabed: geo,
        ownsEnvironment: false,
        initial: { n: loc.n, e: loc.e, headingDeg: scenario.startHeadingDeg, speedKn: scenario.startSpeedKn },
        input: startInput,
        controller: () => this.sampleInputs(),
      });
      const fleet = new Fleet(built.env);
      fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xf5f5f2, kind: 'human', sim });
      const f = this.dartData?.features;
      if (f) fleet.setObstacles({ moored: f.moorings.map((m) => ({ n: m.n, e: m.e, l: m.l, area: m.a, swingDeg: mooringSwingDeg(m.h) })), ferries: f.ferries, traffic, piers: [...raceStructures(f, geo), ...this.solidWalls()] });
      this.soloFleet = fleet;
    }
    if (race) this.soloFleet = undefined;
    this.scenarioError = undefined;
    this.traffic = traffic;
    this.scenario = structuredClone(scenario);
    this.built = built;
    this.race = race;
    this.sim = sim;
    this.coach = race ? this.makeCoach(race, built, scenario) : undefined;
    this.debrief = undefined;
    // Start with sensible manual sheet settings for the starting point of sail.
    if (!startInput) this.sim.setInput(optimalSheets(this.sim));
    this.initialInput = startInput ? { ...DEFAULT_INPUT_FOR_RECORD, ...startInput } : null;
    this.checkpoints = [];
    if (!opts.keepReplay) {
      this.replay = undefined;
      this.timeScale = 1;
    }
    this.confirmReset = false;
    this.leave = undefined;
    this.raceBest = {};
    if (this.raceTag && this.raceTag.scenario !== JSON.stringify(scenario)) this.raceTag = undefined;
    // The ghost stays for a reset of its own scenario; anything else ends it.
    if (this.ghost && this.ghost.scenario !== JSON.stringify(scenario)) this.ghost = undefined;
    // Starting anything other than the lesson's own scenario ends the lesson (a Reset keeps it).
    if (this.tutorial && JSON.stringify(scenario) !== JSON.stringify(this.lesson?.scenario)) this.endLesson();
    else if (this.tutorial) {
      // Reset keeps the step but starts its measuring again from the new start, and sets the boat up for it
      // again (a sheet handed over stays handed over).
      this.tutorial.restartStep();
      this.applyTutorialInput();
    }
    this.currSnap = this.sim.snapshot(false);
    this.prevSnap = this.currSnap;
    this.detailSnap = this.sim.snapshot();
    this.captureFleet();
    this.fleetPrev = this.fleetCurr;
    this.showResults = false;
    this.resultsShown = false;
    this.view?.setBoatType(isSquibType(scenario.boat) ? scenario.boat : DEFAULT_SQUIB_TYPE, boatParams, scenario.helm === 'female' ? 'female' : 'male');
    this.view?.setCourse(this.race?.resolved, this.race?.course, this.dartData?.features?.marks);
    this.view?.setFleet(this.fleetList());
    this.lastWeather = -Infinity; // new conditions: update the sky at the next frame
    this.view?.resetSea(); // and the sea's field at once
    this.accumulator = 0;
    this.telemetry.clear();
    this.showMe = undefined;
    this.lastMainSide = 0;
    if (!this.replay) {
      this.milestones.sessions++;
      this.milestones.firstVisit ??= new Date().toISOString().slice(0, 10);
      saveMilestones(this.milestones);
    }
    this.lastRecordT = -Infinity;
    this.publish(true);
    return true;
  }

  /**
   * The walls standing in the water, solid to the boats: the towns' quays and the yacht club's frontage sea wall
   * (each drawn as a vertical stone face; owner, 6 Nov 2026: the Squib going through solid objects).
   */
  private solidWalls(): PierInput[] {
    if (!this.dartData?.geo) return [];
    return [...quayPiers(this.dartData.quays ?? []), ...quayPiers([{ line: [...RDYC_FRONTAGE] }], "the yacht club's sea wall")];
  }

  /** Validation context: with the River Dart data when it is loaded (land, depth, restrictions). */
  validationContext() {
    const d = this.dartData;
    return {
      projection: DART_PROJECTION,
      seabed: d?.geo,
      inDomain: d?.geo ? (n: number, e: number) => d.geo!.inDomain(n, e) : undefined,
      restrictions: d?.features ? buildRestrictions(d.features) : undefined,
      draft: squibParams().draft,
      ...DART_LEVELS,
      lowWaterOdn: -(d?.geo?.cdBelowOdn ?? 2.62),
    };
  }

  /** One physics step: the whole race (fleet, committee, judges, rules, AI) or the user's boat alone. */
  private stepSim(): void {
    if (this.replay && !this.replay.ended && this.sim.step >= this.replay.rec.endStep) {
      // The recording's last checkpoint is where it was saved, usually between the regular ones.
      if (this.sim.step % CHECKPOINT_STEPS !== 0) this.verify(this.sim.step, this.stateHash());
      this.replay.ended = true;
      this.paused = true;
      this.publish(true);
    }
    if (this.replay?.ended) return; // hold at the end of the recording until "Take over"
    if (this.race) this.race.session.step();
    else if (this.soloFleet) this.soloFleet.stepOnce();
    else this.sim.stepOnce();
    if (this.sim.step % CHECKPOINT_STEPS === 0) this.checkpoint();
    if (this.tutorial && this.sim.step % 10 === 0) this.updateTutorial();
    else if (!this.replay && this.prefs.hints && this.hintsAllowed && this.sim.step % 10 === 0) this.updateHints();
    if (this.coach && this.sim.step % 50 === 0) this.updateCoach();
    if (this.sim.step % 6000 === 0) this.keepResumePoint();
    // Only your own sailing counts towards your bests, not a replay of a recording.
    if (this.race && !this.replay && this.sim.step % 50 === 0) this.checkRaceBests();
  }

  /** The coach for a race: the line, the first mark and the conditions at the line when the run begins. */
  private makeCoach(race: NonNullable<SimController['race']>, built: BuiltConditions, scenario: AppScenario): RaceCoach {
    const [a, b] = race.resolved.start;
    const mid = { n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 };
    const w = windFrom(built.env.wind(0, mid.n, mid.e));
    const c = built.env.current(0, mid.n, mid.e);
    const kindOf = (id: string) => race.course.marks.find((m) => m.id === id)?.kind;
    const label = (id: string) => (kindOf(id) === 'committee-boat' ? 'committee boat' : kindOf(id) === 'pin' ? 'pin' : (race.course.marks.find((m) => m.id === id)?.name ?? id));
    const ends = race.course.start.ends;
    return new RaceCoach(
      {
        twsKn: w.speed / 0.514444,
        twdDeg: (w.fromDir * 180) / Math.PI,
        gusts: scenario.conditions.gusts.preset,
        current: Math.hypot(c.n, c.e) > 0.05 ? { setDeg: ((Math.atan2(c.e, c.n) * 180) / Math.PI + 360) % 360, rateKn: Math.hypot(c.n, c.e) / 0.514444 } : undefined,
        line: { a, b },
        endLabels: [label(ends[0]), label(ends[1])],
        firstMark: race.resolved.legs[0]?.target ?? mid,
        sequence: race.session.committee.opts.sequence,
        competitors: race.session.fleet.boats.length - 1,
      },
      race.session.polar,
    );
  }

  /** Every half second of a race: what the coach sees of your boat; the debrief once you are done. */
  private updateCoach(): void {
    const r = this.race;
    const coach = this.coach;
    if (!r || !coach) return;
    const s = this.sim.snapshot(false);
    const t = s.t;
    const session = r.session;
    const st = session.judgeOf('you').state(t);
    const leg = r.resolved.legs[st.legIndex];
    coach.update({
      t, n: s.n, e: s.e, stw: s.stw, vmg: s.vmg, tws: s.tws, twd: s.twd, twa: s.twa, heel: s.heel,
      rudderFrac: s.rudder / this.sim.params.rudder.maxAngle,
      mainLuff: s.forces.main.luff, mainStall: s.forces.main.stall, autoMain: s.input.autoMain, flatten: s.input.flatten ?? 0,
      race: { phase: st.phase, toStart: session.committee.startTime - t, ocs: st.ocs, mark: leg?.target, penaltyOwed: session.owesPenalty('you') },
    });
    const done = st.phase === 'finished' || session.outOfRace('you') || session.committee.finished || session.committee.abandoned;
    if (done && !this.debrief) {
      const row = session.results().find((x) => x.id === 'you');
      this.debrief = coach.debrief({ place: row?.place ?? undefined, fleet: session.fleet.boats.length, incidents: session.incidents.filter((i) => i.atFault === 'you').length });
      this.publish(true);
    }
  }

  /** Whether the race coach is shown (in races). */
  get coachEnabled(): boolean {
    return this.coachOn;
  }

  /** Show or hide the race coach's briefing and tips (remembered in this browser). */
  toggleCoach(force?: boolean): void {
    this.coachOn = force ?? !this.coachOn;
    writeFlag('squib.coach', this.coachOn);
    this.publish(true);
  }

  /** Start a quick race (one step: competitors, level, venue and conditions). Returns a summary, or undefined. */
  startQuickRace(o: QuickRaceOptions): { summary: string; note?: string } | undefined {
    const live = this.weatherSources.find((w) => w.kind === 'live');
    const liveTide = this.tideSources.find((t) => t.kind === 'live');
    const q = quickRaceScenario(o, this.scenario, live, liveTide);
    if (!this.restart(q.scenario)) return undefined;
    // Today's challenge keeps its best apart (it stays the challenge through a Reset of the same race).
    this.raceTag = o.challenge ? { key: o.challenge, scenario: JSON.stringify(q.scenario) } : undefined;
    if (this.paused) this.togglePause();
    return { summary: q.summary, note: q.note };
  }

  /**
   * Reset from the toolbar or R. Once the start signal has gone (and until you finish), ask first: one key
   * would otherwise throw the race away (error prevention). Otherwise reset at once.
   */
  requestReset(): void {
    if (this.raceAtStake()) {
      this.confirmReset = true;
      this.publish(true);
      return;
    }
    this.restart();
  }

  /** A race the user would lose by starting again or starting something else: from its start signal to your finish. */
  private raceAtStake(): boolean {
    const judge = this.race?.session.judgeOf('you');
    return !!judge && !this.replay && this.sim.time >= judge.startSignalTime && judge.phase !== 'finished';
  }

  // ------------------------------------------------------- leaving the current activity

  /** Waiting for the user to confirm leaving a race in progress: what would start instead. */
  private leave?: { what: string; start: () => void };

  /**
   * Start something else: another scenario, a race, the tutorial, new settings, a replay. During a race that has
   * started (when Reset asks too) ask first, since the race would be lost; otherwise start it at once.
   * `what` says it in a few words ("Loading Fog in the harbour").
   */
  leaveTo(what: string, start: () => void): void {
    if (this.raceAtStake()) {
      this.leave = { what, start };
      this.publish(true);
      return;
    }
    start();
  }

  answerLeave(go: boolean): void {
    const l = this.leave;
    this.leave = undefined;
    if (go && l) l.start();
    this.publish(true);
  }

  /** Start a session and sail: a restart, then on from a pause (a new activity starts moving, as a quick race does). */
  startSession(scenario: AppScenario): boolean {
    if (!this.restart(scenario)) return false;
    this.resume();
    return true;
  }

  /**
   * Free sailing from whatever is running: a replay hands over where it is, the tutorial ends where the boat is,
   * and a course with its fleet is left (the place, conditions and boat stay); then the boat sails.
   */
  freeSail(): void {
    if (this.replay) this.takeOver();
    if (this.tutorial) this.endLesson();
    if (this.race) {
      const free = structuredClone(this.scenario);
      delete free.course;
      delete free.race;
      delete free.fleet;
      if (!this.restart(free)) return;
    }
    this.resume();
  }

  private resume(): void {
    if (!this.paused) return this.publish(true);
    this.paused = false;
    this.lastFrame = performance.now();
    this.publish(true);
  }

  answerReset(reset: boolean): void {
    this.confirmReset = false;
    if (reset) this.restart();
    else this.publish(true);
  }

  /** A clean start and a finish are compared with your bests in this browser, once each per race. */
  private checkRaceBests(): void {
    const r = this.race!;
    const t = this.sim.time;
    const cm = r.session.committee;
    const st = r.session.judgeOf('you').state(t);
    if (!this.raceBest.start && st.startTime !== undefined) {
      const delayS = Math.max(0, st.startTime - cm.startTime);
      this.raceBest.start = { delayS, ...recordStart(delayS) };
      this.publish(true);
    }
    if (!this.raceBest.finish && st.phase === 'finished' && st.finishTime !== undefined && st.startTime !== undefined) {
      const timeS = st.finishTime - cm.startTime;
      const label = this.raceTag ? `Today's challenge (${this.raceTag.key.slice(10)})` : courseKey(r.course.name, r.course.laps);
      this.raceBest.finish = { timeS, label, ...recordRaceTime(this.raceTag?.key ?? courseKey(r.course.name, r.course.laps), label, timeS) };
      this.publish(true);
    }
  }

  // ------------------------------------------------------------- lessons

  /** Start a lesson (src/app/lessons.ts): its own water and wind, steps checked as you sail. Default: the next one not done. */
  startLesson(id?: LessonId): void {
    const lesson = id ? lessonById(id) : nextLessonFor(this.lessonProgress);
    this.endLesson();
    if (!this.restart(structuredClone(lesson.scenario), { initialInput: lesson.input })) return;
    this.lesson = lesson;
    this.tutorial = new Tutorial(lesson.steps);
    const s = this.sim.state;
    const b = ((lesson.target?.bearingDeg ?? 0) * Math.PI) / 180;
    this.lessonTarget = lesson.target ? { n: s.n + Math.cos(b) * lesson.target.distM, e: s.e + Math.sin(b) * lesson.target.distM } : undefined;
    this.lessonResult = undefined;
    this.paused = false;
    this.lastFrame = performance.now();
    this.applyTutorialInput();
    this.applyTeaching();
    this.publish(true);
  }

  /** The lessons began as one tutorial; "Learn to sail" starts the next lesson not yet done. */
  startTutorial(): void {
    this.startLesson();
  }

  endTutorial(): void {
    this.endLesson();
    this.publish(true);
  }

  private endLesson(): void {
    this.tutorial = undefined;
    this.lesson = undefined;
    this.lessonTarget = undefined;
    this.lessonResult = undefined;
    this.applyTeaching();
  }

  tutorialNext(): void {
    this.tutorial?.next();
    this.applyTutorialInput();
    this.checkLessonDone();
    this.publish(true);
  }

  tutorialBack(): void {
    this.tutorial?.back();
    this.applyTutorialInput();
    this.publish(true);
  }

  private applyTutorialInput(): void {
    const t = this.tutorial;
    if (!t?.pendingInput) return;
    this.sim.setInput(t.pendingInput);
    t.pendingInput = undefined;
  }

  /** The teaching overlay: the lesson's parts during a lesson, else all of them when switched on (or none). */
  private applyTeaching(): void {
    const parts: OverlayPart[] = this.lesson ? this.lesson.overlay : this.teachingOn ? ['heading', 'cog', 'current', 'wind', 'vmg'] : [];
    this.view?.setTeaching(parts, this.lessonTarget);
  }

  /**
   * The interface level: kept in this browser, and it sets the defaults it governs (the teaching overlay, the
   * coach, all the instruments, the dock's advanced controls), each of which can still be changed by hand.
   */
  setLevel(l: InterfaceLevel): void {
    this.interfaceLevel = l;
    saveLevel(l);
    const d = levelDefaults(l);
    this.teachingOn = d.teaching;
    writeFlag('squib.teaching', d.teaching);
    this.coachOn = d.coach;
    writeFlag('squib.coach', d.coach);
    try {
      localStorage.setItem('squib.instruments.more', d.allInstruments ? '1' : '0');
    } catch {
      // storage unavailable
    }
    this.applyTeaching();
    this.publish(true);
  }

  get level(): InterfaceLevel {
    return this.interfaceLevel;
  }

  get teachingEnabled(): boolean {
    return this.teachingOn;
  }

  /** The teaching overlay outside the lessons (kept in this browser). */
  toggleTeaching(force?: boolean): void {
    this.teachingOn = force ?? !this.teachingOn;
    writeFlag('squib.teaching', this.teachingOn);
    this.applyTeaching();
    this.publish(true);
  }

  /** Hints when you are stuck, and the first-sail milestones (src/app/hints.ts). */
  private updateHints(): void {
    const s = this.sim.snapshot(false);
    const KN = 0.514444;
    const R2D = 180 / Math.PI;
    const stwKn = s.stw / KN;
    // Milestones: the first time she sails at 2 kn, the first tack.
    const m = this.milestones;
    let changed = false;
    if (m.firstSailS === undefined && stwKn > 2) {
      m.firstSailS = Math.round(s.t);
      changed = true;
    }
    if (this.lastMainSide && s.mainSide !== this.lastMainSide && Math.abs(s.twa) * R2D < 90 && m.firstTackS === undefined) {
      m.firstTackS = Math.round(s.t);
      changed = true;
    }
    this.lastMainSide = s.mainSide;
    let ferryM: number | undefined;
    const fleet = this.race?.session.fleet ?? this.soloFleet;
    // Only where the traffic can be (its routes' box): elsewhere there is nothing to be close to.
    if (fleet && fleet.nearFerries(s.n, s.e)) {
      for (const v of fleet.ferriesAt(s.t)) {
        if (!v.moving || !(v.kind === 'tug-float' || v.kind === 'floating-bridge' || v.kind === 'passenger-ferry' || v.kind === 'paddle-steamer' || v.kind === 'river-cruiser')) continue;
        const d = Math.hypot(v.n - s.n, v.e - s.e) - v.length / 2;
        ferryM = Math.min(ferryM ?? Infinity, d);
      }
    }
    const sample: HintSample = {
      t: s.t,
      twaDeg: Math.abs(s.twa) * R2D,
      stwKn,
      sogKn: s.sog / KN,
      heelDeg: Math.abs(s.heel) * R2D,
      grounded: s.grounded,
      main: sailState(s.forces.main),
      jib: sailState(s.forces.jib),
      autoMain: s.input.autoMain,
      autoJib: s.input.autoJib,
      // The harbour's 6 kn limit runs from Castle Ledge buoy (n −1651 here) up the river (harbour guide).
      inHarbour: !!this.dartData?.geo && s.n > -1651 && s.n < 9000,
      ferryM,
    };
    const was = this.hints.current?.id;
    const h = this.hints.update(sample);
    if (h) {
      m.hintsShown++;
      changed = true;
      saveSeenHints(this.hints.seenIds);
    }
    if (changed) saveMilestones(m);
    if (h || was !== this.hints.current?.id) this.publish(true);
  }

  /** Close the hint showing. */
  dismissHint(): void {
    this.hints.dismiss();
    this.publish(true);
  }

  /** The hint's "Show me": the boat sails out of it herself for a few seconds, or the crew take the sheets. */
  hintShowMe(): void {
    const a = this.hints.current?.showMe?.action;
    if (!a) return;
    this.milestones.showMeUsed++;
    saveMilestones(this.milestones);
    if (a.kind === 'auto-sheets') this.sim.setInput({ autoMain: true, autoJib: true });
    else this.showMe = { action: a, until: this.sim.time + a.seconds, side: Math.sign(this.sim.snapshot(false).twa) || 1 };
    this.hints.dismiss();
    this.publish(true);
  }

  /** What the lesson sees of the boat now. */
  private lessonSample() {
    const s = this.sim.snapshot(false);
    const R2D = 180 / Math.PI;
    const KN = 0.514444;
    let race: { toStart: number; ocs: boolean; startedAt?: number; signalAt: number } | undefined;
    if (this.race) {
      const cm = this.race.session.committee;
      const st = this.race.session.judgeOf('you').state(s.t);
      race = { toStart: cm.startTime - s.t, ocs: st.ocs, startedAt: st.startTime, signalAt: cm.startTime };
    }
    const tg = this.lessonTarget;
    return {
      t: s.t,
      headingDeg: s.heading * R2D,
      twaDeg: Math.abs(s.twa) * R2D,
      stwKn: s.stw / KN,
      mainSide: s.mainSide,
      main: sailState(s.forces.main),
      autoMain: s.input.autoMain,
      autoCrew: s.input.autoCrew,
      crewHike: s.input.crewHike,
      n: s.n,
      e: s.e,
      sogKn: s.sog / KN,
      vmgKn: s.vmg / KN,
      awsKn: s.aws / KN,
      jib: sailState(s.forces.jib),
      autoJib: s.input.autoJib,
      targetDistM: tg ? Math.hypot(tg.n - s.n, tg.e - s.e) : undefined,
      targetBearingRelDeg: tg ? ((((Math.atan2(tg.e - s.e, tg.n - s.n) - s.heading) * R2D) % 360) + 540) % 360 - 180 : undefined,
      targetBearingDeg: tg ? (((Math.atan2(tg.e - s.e, tg.n - s.n) * R2D) % 360) + 360) % 360 : undefined,
      race,
    };
  }

  /** Every 0.1 s of simulated time: check the step's goal; move on 2 s after it is met. */
  private updateTutorial(): void {
    const t = this.tutorial!;
    t.update(this.lessonSample());
    const since = t.sinceDone(this.sim.time);
    if (since !== undefined && since >= 2 && t.state.index < t.state.total - 1) {
      t.next();
      this.applyTutorialInput();
      this.checkLessonDone();
      this.publish(true);
    }
  }

  /** On reaching the lesson's last step: its result card, and the lesson marked done in this browser. */
  private checkLessonDone(): void {
    const t = this.tutorial;
    const l = this.lesson;
    if (!t || !l || !t.finished || this.lessonResult) return;
    const elapsed = this.sim.time;
    const { progress, best } = saveLessonDone(l.id, elapsed);
    this.lessonProgress = progress;
    const next = lessonAfter(l.id);
    this.lessonResult = { lines: l.result(t.record, elapsed), best, next: next && { id: next.id, title: next.title } };
  }

  /** The whole run's state hash: every boat (and so, through determinism, everything else). */
  stateHash(): string {
    return this.race ? this.race.session.stateHash() : this.soloFleet ? this.soloFleet.stateHash() : this.sim.stateHash();
  }

  private checkpoint(): void {
    const step = this.sim.step;
    const hash = this.stateHash();
    this.checkpoints.push([step, hash]);
    this.verify(step, hash);
  }

  /** In a replay, compare a state hash with the recording's for the same step (if it has one). */
  private verify(step: number, hash: string): void {
    const r = this.replay;
    if (!r) return;
    const expected = r.rec.checkpoints.find((c) => c[0] === step);
    if (!expected) return;
    if (expected[1] === hash && r.divergedAt === undefined) {
      r.matched++;
      r.verifiedTo = step * DT;
    } else if (r.divergedAt === undefined) r.divergedAt = step * DT;
  }

  // ------------------------------------------------------------ recordings

  /** The run so far as a recording (the replay file). */
  saveRecording(title = 'Squib session'): Recording {
    const sc = structuredClone(this.scenario);
    // Carry the course itself, so the replay does not depend on this browser's course library.
    if (this.race) sc.course = { source: 'inline', course: structuredClone(this.race.course) };
    const checkpoints = this.checkpoints.filter((c) => c[0] <= this.sim.step);
    if (!checkpoints.length || checkpoints[checkpoints.length - 1]![0] !== this.sim.step) checkpoints.push([this.sim.step, this.stateHash()]);
    return {
      schema: REPLAY_SCHEMA,
      created: new Date().toISOString(),
      title,
      build: BUILD_ID,
      scenario: sc,
      initialInput: this.initialInput,
      dart: this.dartData?.geo ? 'loaded' : 'none',
      inputs: encodeInputs(this.sim.inputLog),
      checkpoints,
      endStep: this.sim.step,
    };
  }

  /** Play a recording back: same scenario and starting input, the user's inputs fed step by step, checked. */
  startReplay(json: unknown): boolean {
    let rec: Recording;
    try {
      rec = parseRecording(json);
    } catch (err) {
      this.scenarioError = (err as Error).message;
      this.publish(true);
      return false;
    }
    const notes: string[] = [];
    const dartNow = this.dartData?.geo ? 'loaded' : 'none';
    if (rec.dart !== dartNow) notes.push(`Recorded ${rec.dart === 'loaded' ? 'with' : 'without'} the River Dart data, played ${dartNow === 'loaded' ? 'with' : 'without'} it: it will not match.`);
    if (rec.build !== BUILD_ID) notes.push(`Recorded with build ${rec.build}; this is ${BUILD_ID}. A different build may not reproduce it exactly.`);
    if (!this.restart(rec.scenario, { initialInput: rec.initialInput, keepReplay: true })) return false;
    this.replay = { rec, inputs: decodeInputs(rec.inputs), next: 0, matched: 0, total: rec.checkpoints.length, verifiedTo: 0, ended: false, notes };
    this.held.clear();
    this.paused = false;
    this.publish(true);
    return true;
  }

  // ------------------------------------------------------------ continue where you left off

  /** Keep the run so far in this browser (free sailing and races, after the first 30 s; not lessons or replays). */
  private keepResumePoint(): void {
    // Not while last visit's run is still on offer (unanswered), so ignoring the card for a minute does not lose it.
    if (this.resumePoint || this.replay || this.catchUp || this.tutorial || this.sim.time < RESUME_MIN_S) return;
    if (this.race && this.race.session.judgeOf('you').phase === 'finished') return;
    const loc = START_LOCATIONS.find((l) => l.id === this.scenario.startLocation)?.label ?? this.scenario.startLocation;
    const label = this.race ? `Race: ${this.race.course.name}` : `Free sailing from ${loc.charAt(0).toLowerCase()}${loc.slice(1)}`;
    saveResume({ rec: this.saveRecording('Where you left off'), label, savedAt: new Date().toISOString() });
  }

  /**
   * Sail the kept run again, step by step and as fast as the device allows (a little at a time, so the page keeps
   * drawing), to where it was left; then hand over. The same build lands exactly there; another may differ a little.
   */
  continueSession(): boolean {
    const p = this.resumePoint;
    if (!p) return false;
    this.resumePoint = undefined;
    if (!this.startReplay(p.rec)) {
      this.publish(true);
      return false;
    }
    this.catchUp = { from: this.sim.step, to: p.rec.endStep };
    this.paused = true;
    const chunk = () => {
      if (!this.catchUp || !this.replay) return;
      const t0 = performance.now();
      while (this.sim.step < this.catchUp.to && !this.replay.ended && performance.now() - t0 < CATCH_UP_SLICE_MS) {
        this.stepSim();
        if (this.sim.step % 10 === 0) this.recordTelemetry(this.sim.snapshot());
      }
      if (this.sim.step < this.catchUp.to && !this.replay.ended) {
        this.publish(true);
        setTimeout(chunk, 0);
        return;
      }
      this.catchUp = undefined;
      this.currSnap = this.sim.snapshot(false);
      this.prevSnap = this.currSnap;
      this.captureFleet();
      this.fleetPrev = this.fleetCurr;
      this.takeOver();
    };
    this.publish(true);
    setTimeout(chunk, 0);
    return true;
  }

  /** "Start fresh": forget the kept run. */
  dismissResume(): void {
    this.resumePoint = undefined;
    clearResume();
    this.publish(true);
  }

  /** Stop the replay here and sail on from this point (the recording continues from the replayed part). */
  takeOver(): void {
    this.replay = undefined;
    this.catchUp = undefined;
    this.ghostLoading = undefined;
    this.timeScale = 1;
    this.held.clear();
    this.paused = false;
    this.publish(true);
  }

  setTimeScale(x: number): void {
    this.timeScale = [1, 2, 4, 8].includes(x) ? x : 1;
    this.publish(true);
  }

  private contactText(): string | undefined {
    const events = this.race?.session.fleet.events ?? this.soloFleet?.events ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (this.sim.time - e.t > 8) break;
      if (e.a !== 'you' && e.b !== 'you') continue;
      const other = e.kind === 'boat' ? this.race?.session.fleet.boat(e.a === 'you' ? e.b : e.a)?.name ?? 'another boat' : e.label;
      // What it did to the boat (the impact recorded at the same moment).
      const hit = this.sim.impacts.find((i) => Math.abs(i.t - e.t) < 0.05 && i.effects.length);
      return `Contact with ${other} at ${e.speed.toFixed(1)} m/s${hit ? `: ${hit.effects.join(', ')}` : ''}`;
    }
    // Running aground hard; the mast coming down.
    const g = this.sim.impacts[this.sim.impacts.length - 1];
    if (g && g.what === 'the bottom' && this.sim.time - g.t < 8) return `Ran aground at ${g.speed.toFixed(1)} m/s${g.effects.length ? `: ${g.effects.join(', ')}` : ''}`;
    if (g && g.what === 'the rig' && this.sim.time - g.t < 8) return `Dismasted: ${g.effects.join(', ')}`;
    return undefined;
  }

  /** Contacts in free sailing (moored boats, ferries), newest last. */
  get soloContacts() {
    return this.soloFleet?.events ?? [];
  }

  /** The other boats of the fleet (for the 3D view). */
  private fleetList(): { id: string; label: string; colour: number; ghost?: boolean }[] {
    const list: { id: string; label: string; colour: number; ghost?: boolean }[] = (this.race?.session.fleet.boats ?? []).filter((b) => b.id !== 'you').map((b) => ({ id: b.id, label: b.sailNumber, colour: b.colour }));
    if (this.ghost) list.push({ id: 'ghost', label: `Ghost: ${this.ghost.title}`, colour: 0xbfe3ff, ghost: true });
    return list;
  }

  // ------------------------------------------------------------ ghost racing

  /**
   * Race a ghost (red team, 10 Nov 2026): a recording (a replay file, src/app/replay.ts) is sailed again quickly,
   * step by step, to learn where its boat was every 0.1 s; then the same scenario starts again and you sail it with
   * that boat drawn as a ghost beside you. The ghost is only a picture: no contact, no wind shadow, not in the race.
   */
  startGhost(json: unknown): boolean {
    let rec: Recording;
    try {
      rec = parseRecording(json);
    } catch (err) {
      this.scenarioError = (err as Error).message;
      this.publish(true);
      return false;
    }
    if (!this.startReplay(rec)) return false;
    const poses: FleetPose[] = [];
    this.ghost = undefined;
    this.ghostLoading = 0;
    this.paused = true;
    const end = rec.endStep;
    const chunk = () => {
      if (!this.replay || this.ghostLoading === undefined) return;
      const t0 = performance.now();
      while (this.sim.step <= end && performance.now() - t0 < CATCH_UP_SLICE_MS) {
        if (this.sim.step % GHOST_EVERY === 0) poses.push(poseOf('ghost', this.sim.snapshot(false)));
        if (this.sim.step === end || this.replay.ended) break;
        this.stepSim();
      }
      if (this.sim.step < end && !this.replay.ended) {
        this.ghostLoading = this.sim.step / Math.max(1, end);
        this.publish(true);
        setTimeout(chunk, 0);
        return;
      }
      this.ghostLoading = undefined;
      this.replay = undefined;
      if (!this.restart(rec.scenario, { initialInput: rec.initialInput })) return;
      this.ghost = { title: rec.title, poses, scenario: JSON.stringify(rec.scenario), endS: end * DT };
      this.captureFleet();
      this.fleetPrev = this.fleetCurr;
      this.view?.setFleet(this.fleetList());
      this.paused = false;
      this.lastFrame = performance.now();
      this.publish(true);
    };
    this.publish(true);
    setTimeout(chunk, 0);
    return true;
  }

  /** Stop showing the ghost. */
  endGhost(): void {
    this.ghost = undefined;
    this.view?.setFleet(this.fleetList());
    this.captureFleet();
    this.fleetPrev = this.fleetCurr;
    this.publish(true);
  }

  /** Poses of the other boats now (kept for the last two physics states, for render interpolation). */
  private captureFleet(): void {
    const m = new Map<string, FleetPose>();
    for (const b of this.race?.session.fleet.boats ?? []) {
      if (b.id === 'you') continue;
      m.set(b.id, poseOf(b.id, b.sim.snapshot(false)));
    }
    const g = this.ghost && ghostPoseAt(this.ghost.poses, this.sim.step / GHOST_EVERY);
    if (g) m.set('ghost', g);
    this.fleetCurr = m;
  }

  /**
   * Find the live and replay data files served with the app: live/index.json lists them (so nothing that is
   * absent is requested), each is fetched, checked and judged for freshness. Without an index only the
   * bundled replays are tried. Problems are reported, never fatal: the app falls back to manual conditions.
   */
  async discoverSources(nowMs = Date.now()): Promise<void> {
    const weather: DataSource[] = [];
    const tide: DataSource[] = [];
    const issues: string[] = [];
    let entries: LiveIndexEntry[];
    try {
      const res = await fetch(LIVE_INDEX, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entries = parseLiveIndex(await res.json()).files;
    } catch (e) {
      issues.push(`Live-data index (${LIVE_INDEX}) not available: ${(e as Error).message}. Only the bundled replay is offered.`);
      entries = BUNDLED_REPLAYS;
    }
    for (const entry of entries) {
      const url = `live/${entry.path}`;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const loaded = loadLive(entry, await res.json(), nowMs);
        const expired = loaded.freshness?.status === 'expired';
        const kind = entry.mode === 'live' && !expired ? 'live' : 'replay';
        if (loaded.kind === 'weather') {
          const valid = loaded.snapshot.model.valid;
          const stale = loaded.freshness?.status === 'stale' ? ' (stale)' : '';
          weather.push({
            id: url,
            kind,
            url,
            validTime: valid,
            json: loaded.snapshot,
            freshness: loaded.freshness,
            label: kind === 'live' ? `Live${stale}: Met Office UKV, from ${valid}` : `${expired ? 'Recorded' : 'Replay'}: Met Office UKV, valid ${valid}`,
          });
        } else {
          const ev = loaded.snapshot.predictions.events;
          tide.push({
            id: url,
            kind,
            url,
            validTime: ev[0]?.time,
            json: loaded.snapshot,
            freshness: loaded.freshness,
            gaugeUsable: loaded.freshness?.gaugeUsable ?? false,
            label: `${kind === 'live' ? 'Live' : expired ? 'Recorded' : 'Replay'} tide: ${loaded.snapshot.predictions.source}`,
          });
        }
      } catch (e) {
        issues.push(`${url}: ${(e as Error).message}. Not offered.`);
      }
    }
    this.weatherSources = weather;
    this.tideSources = tide;
    this.liveIssues = issues;
    this.publish(true);
    // With the River Dart still loading, the switch waits for it (loadDart rebuilds the session anyway).
    if (this.dartStatus !== 'loading') this.goLiveIfUntouched();
  }

  /**
   * Real-time conditions (owner review, 1 Nov 2026): when the site's live forecast covers now and the user has not
   * started anything yet (the default free sail, a few seconds in), sail in today's weather from this minute, so
   * the wind, the sky and the sun are the Dart's now. Not with ?conditions=set (tests that need the defaults).
   */
  private goLiveIfUntouched(): void {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('conditions') === 'set') return;
    const untouched = !this.race && !this.tutorial && !this.replay && this.sim.time < 60 && JSON.stringify(this.scenario) === JSON.stringify(DEFAULT_SCENARIO);
    if (!untouched) return;
    try {
      this.useLiveNow();
    } catch (err) {
      // Never let the switch stop the app: report it with the live data's other problems and sail on as set.
      this.liveIssues = [...this.liveIssues, `Could not start in the live conditions: ${(err as Error).message}`];
      this.publish(true);
    }
  }

  /** Restart the current activity in the live conditions of now (forecast, sky, the real clock); false if none covers now. */
  useLiveNow(): boolean {
    const w = freshLiveWeather(this.weatherSources);
    if (!w) return false;
    const tide = this.tideSources.find((t) => t.kind === 'live');
    // On the river, a live tide drives the channel stream (it needs the River Dart data); in Start Bay, none.
    const river = this.scenario.startLocation !== 'start-bay-practice' && this.dartStatus === 'loaded';
    return this.restart({ ...this.scenario, conditions: liveNowConditions(w, { tide, stream: river, seed: this.scenario.conditions.gusts.seed }) });
  }

  /**
   * Load the River Dart data, then restart the current scenario with the seabed and channel stream. Any file
   * that fails is reported in the UI; the app keeps running with what it has (open water at worst).
   */
  async loadDart(base?: string): Promise<void> {
    this.dartStatus = 'loading';
    this.publish(true);
    const data = await loadDartData(base);
    this.dartData = data;
    this.dartStatus = data.geo ? 'loaded' : 'unavailable';
    if (data.geo && data.manifest && this.view) {
      try {
        this.dartScene = new DartScene({ manifest: data.manifest, geo: data.geo, features: data.features, drape: data.drape, town: data.town, waterMask: data.waterMask, roads: data.roads, quays: data.quays, detail: this.view.quality });
        this.dartScene.setLightLabels(this.prefs.lightLabels);
        this.view.setDart(this.dartScene, (n, e) => data.geo!.depth(n, e, this.sim.waterLevel()));
        this.settlePace();
        // A course already drawn learns which of its marks are real buoys the harbour now draws.
        if (this.race) this.view.setCourse(this.race.resolved, this.race.course, data.features?.marks);
      } catch (err) {
        data.issues.push({ asset: '3D scene', message: (err as Error).message, effect: 'River Dart not drawn; the physics still uses it.' });
      }
    }
    // A scenario that needed the Dart (channel stream) may not have started: rebuild either way.
    this.restart(this.scenario);
    // Live data that arrived while the Dart loaded: switch to it now, in one restart.
    this.goLiveIfUntouched();
  }

  attach(container: HTMLElement): void {
    // Start downloading the River Dart data first: building the view compiles shaders for a second or more,
    // and the download runs meanwhile (the scene is added when both are ready).
    void this.loadDart();
    try {
      this.view = new SceneView(container, this.sim.params);
      this.view.onContextChange = (lost) => this.onGraphicsContext(lost);
      this.applyTeaching();
    } catch (err) {
      this.webglError = `3D view unavailable: ${(err as Error).message}. The simulation still runs; instruments remain live.`;
    }
    this.view?.setBoatType(isSquibType(this.scenario.boat) ? this.scenario.boat : DEFAULT_SQUIB_TYPE, this.sim.params, this.scenario.helm === 'female' ? 'female' : 'male');
    this.view?.setCourse(this.race?.resolved, this.race?.course, this.dartData?.features?.marks);
    this.view?.setFleet(this.fleetList());
    this.lastWeather = -Infinity; // new conditions: update the sky at the next frame
    this.view?.resetSea(); // and the sea's field at once
    this.lastFrame = performance.now();
    this.fpsT0 = this.lastFrame;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // Battery saver (Settings; on by default on touch screens): draw at most 30 frames a second.
      if (this.prefs.batterySaver && now - this.lastDrawn < 1000 / 30 - 4) return;
      this.lastDrawn = now;
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pointerdown', this.onGesture);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.discoverSources();
    // The graphics check, once the scene has been drawn for a while (owner review, 4 Nov 2026), on a graphics card
    // (the fault was seen on one; a software renderer draws these surfaces correctly). Settings runs it anywhere.
    if (this.view && !/swiftshader|llvmpipe|software|basic render/i.test(this.view.gpuName)) this.checkTimer = window.setTimeout(() => this.runMaterialCheck(), 8000);
    this.publish(true);
  }

  private checkTimer = 0;
  private lastMaterialCheck?: MaterialCheck;

  /**
   * Measure how this graphics card draws painted surfaces and apply the first fix that works if they come out
   * black (src/render/gpuCheck.ts). `?gpucheck=fault` simulates the fault (tests).
   */
  runMaterialCheck(): MaterialCheck | undefined {
    if (!this.view) return undefined;
    const simulate = new URLSearchParams(location.search).get('gpucheck') === 'fault';
    const c = this.view.checkMaterials(simulate);
    if (c) this.lastMaterialCheck = c;
    this.settlePace();
    this.publish(true);
    return c;
  }

  /** Draw painted surfaces as built, without reflections, or with simple materials (Settings). */
  setMaterialMode(fix: MaterialFix): void {
    if (!this.view) return;
    this.view.setMaterialFix(fix);
    saveFix(this.view.gpuName, fix);
    this.settlePace();
    this.publish(true);
  }

  /** Everything the graphics check measured, as text to paste into a message. */
  materialReport(): string {
    const v = this.view;
    const lines = [
      `Squib simulator graphics check`,
      `Build: ${BUILD_ID} (${BUILD_TIME})`,
      `Graphics card: ${v?.gpuName ?? 'unknown'}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}× · preset ${v?.graphics.preset} · shadows ${v?.quality} · mode ${v?.materialMode}`,
    ];
    for (const c of v?.materialChecks ?? []) {
      lines.push(`${c.at} [${c.mode}] ${c.fault ? 'FAULT' : 'ok'}: ${c.reason}`);
      for (const p of c.probes) lines.push(`  ${p.name}: ${p.rgb.map((x) => x.toFixed(3)).join(' ')}`);
    }
    if (!v?.materialChecks.length) lines.push('No measurement yet (it runs in daylight, 8 s after loading).');
    return lines.join('\n');
  }

  /**
   * A picture of the 3D view (a PNG data URL): drawn now and read in the same task, since the canvas keeps no copy of
   * a frame once it is shown. Undefined without a 3D view or if the browser refuses.
   */
  captureView(): Promise<string | undefined> {
    if (!this.view) return Promise.resolve(undefined);
    try {
      this.drawScene(performance.now(), 1, 0);
      return Promise.resolve(this.view.renderer.domElement.toDataURL('image/png'));
    } catch {
      return Promise.resolve(undefined);
    }
  }

  /** Everything needed to see the view again: build, graphics, settings, the scenario, the boat and the camera. */
  visualReportDetails(): ReportDetail[] {
    const v = this.view;
    const s = this.currSnap;
    const sc = this.scenario;
    const R2D = 180 / Math.PI;
    const KN = 0.514444;
    const w = sc.conditions.weather;
    const epochMs = (this.sim.env.startEpochMs ?? Date.parse(sc.conditions.startTime)) + this.sim.time * 1000;
    const pose = v?.cameraPose();
    const f1 = (x: number) => x.toFixed(1);
    const out: ReportDetail[] = [
      { label: 'Made', value: new Date().toISOString() },
      { label: 'Build', value: `${BUILD_ID} (${BUILD_TIME})` },
      { label: 'Address', value: location.pathname + location.search },
      { label: 'Browser', value: navigator.userAgent },
      { label: 'Screen', value: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}×` },
      { label: 'Graphics card', value: v?.gpuName ?? (this.webglError || 'unknown') },
      { label: 'Graphics', value: v ? `preset ${v.graphics.preset} · scenery and shadows built ${v.quality} · drawing mode ${v.materialMode} · ${f1(this.fps)} frames/s` : 'no 3D view' },
      { label: 'Graphics settings', value: v ? JSON.stringify(v.graphics) : '' },
      { label: 'Camera', value: v && pose ? `${v.cameraMode} · at ${pose.position.map(f1).join(', ')} · looking at ${pose.target.map(f1).join(', ')} (x east, y up, z south; metres from the club)` : '' },
      { label: 'Boat', value: `n ${f1(s.n)} m, e ${f1(s.e)} m from the club · heading ${Math.round(((s.heading * R2D) % 360 + 360) % 360)}° · heel ${f1(s.heel * R2D)}° · ${f1(s.stw / KN)} kn${s.grounded ? ' · aground' : ''}` },
      { label: 'Time in the run', value: `${f1(this.sim.time)} s (${new Date(epochMs).toISOString()})` },
      { label: 'Start', value: `${sc.startLocation} · heading ${sc.startHeadingDeg}° · ${sc.startSpeedKn} kn${sc.boat ? ` · ${sc.boat}` : ''}` },
      { label: 'Wind', value: w.source === 'manual' ? `set: ${w.twsKn} kn from ${w.twdDeg}°` : `Met Office${w.replay ? ' (replayed)' : ''} · now ${f1(s.twsGround / KN)} kn from ${Math.round(((s.twdGround * R2D) % 360 + 360) % 360)}°` },
      { label: 'Sky', value: JSON.stringify(sc.conditions.sky ?? 'default') },
      { label: 'Water level', value: `${this.sim.waterLevel().toFixed(2)} m ODN` },
      { label: 'Mode', value: [this.race ? 'race' : this.tutorial ? 'lesson' : 'free sailing', this.replay ? 'replay' : ''].filter(Boolean).join(' · ') },
    ];
    for (const c of v?.materialChecks ?? []) out.push({ label: `Graphics check ${c.at}`, value: `[${c.mode}] ${c.fault ? 'FAULT' : 'ok'}: ${c.reason}` });
    return out;
  }

  detach(): void {
    window.clearTimeout(this.checkTimer);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.sound.dispose();
    this.view?.dispose();
    this.view = undefined;
  }

  resize(w: number, h: number): void {
    this.view?.resize(w, h);
  }

  /** The sky (cloud, visibility, rain) and the sun for the current moment of the run, for the scene. */
  sceneWeather(): SceneWeather {
    const sim = this.sim;
    const epochMs = (sim.env.startEpochMs ?? Date.parse(this.scenario.conditions.startTime)) + sim.time * 1000;
    const sun = sunPosition(epochMs, RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    return { sky: (sim.env.sky ?? presetSky('clear')).at(sim.time), sunElevationDeg: sun.elevationDeg, sunAzimuthDeg: sun.azimuthDeg };
  }

  /** Draw the 3D view for this moment (alpha: between the last two physics states). */
  private drawScene(now: number, alpha: number, dt: number): void {
    const info = this.detailSnap.env;
    const sim = this.sim;
    if (now - this.lastWeather > 1000) {
      this.lastWeather = now;
      this.view?.setWeather(this.sceneWeather());
    }
    this.view?.render(this.prevSnap, this.currSnap, alpha, this.renderTime, dt, {
      puffs: sim.env.windField?.puffs() ?? [],
      windAgainstTide: info?.windAgainstTide ?? false,
      sea: sim.env.seaState ? (n, e) => sim.env.seaState!(sim.time, n, e) : undefined,
      dart: this.dartScene
        ? {
            waterLevel: sim.waterLevel(),
            epochMs: (sim.env.startEpochMs ?? Date.parse(this.scenario.conditions.startTime)) + sim.time * 1000,
            stream: (n, e) => sim.env.current(sim.time, n, e),
            traffic: this.traffic,
            windFromDir: this.currSnap.twdGround,
            windSpeed: this.currSnap.twsGround,
            showLabels: this.showLabels,
            mooredPose: (m) => mooredBoatPose(m, sim.env, sim.time),
          }
        : undefined,
      course: this.race
        ? { nextLeg: this.race.session.judgeOf('you').legIndex, phase: this.race.session.judgeOf('you').phase, showLabels: this.showLabels, committeeHeading: (n, e) => committeeHeading(sim.env, sim.time, n, e) }
        : undefined,
      fleet: this.race || this.ghost ? { prev: this.fleetPrev, curr: this.fleetCurr, showLabels: this.showLabels } : undefined,
    });
  }

  private frame(now: number): void {
    // Never backwards: a frame's timestamp can fall a little before a clock reading taken on resume.
    const rawDt = (now - this.lastFrame) / 1000;
    const dt = Math.max(0, Math.min(0.1, rawDt));
    this.lastFrame = now;
    let steps = 0;
    if (!this.paused) {
      const t0 = performance.now();
      this.accumulator += dt * this.timeScale;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME * this.timeScale) {
        // Keep (light) snapshots of the last two physics states for render interpolation.
        const last = this.accumulator - DT < DT;
        if (last) {
          this.prevSnap = this.sim.snapshot(false);
          this.fleetPrev = this.fleetCurr;
        }
        this.stepSim();
        this.accumulator -= DT;
        steps++;
        if (last) {
          this.currSnap = this.sim.snapshot(false);
          this.captureFleet();
        }
      }
      // Too slow to keep up: drop simulated time rather than spiral.
      if (steps > 0 && this.currSnap.step !== this.sim.step) {
        this.accumulator = 0;
        this.currSnap = this.sim.snapshot(false);
        this.prevSnap = this.currSnap;
        this.captureFleet();
        this.fleetPrev = this.fleetCurr;
      }
      this.physMs = this.physMs * 0.9 + (performance.now() - t0) * 0.1;
      this.renderTime += dt;
      this.watchPace(rawDt, steps * DT);
    }
    // While a kept run or a ghost's recording is sailed through, the picture would only show it paused: skip drawing,
    // so the device spends its time on the sailing (a software renderer takes seconds a frame).
    if (this.catchUp === undefined && this.ghostLoading === undefined) this.drawScene(now, this.paused ? 1 : clamp(this.accumulator / DT, 0, 1), dt);
    this.frames++;
    if (now - this.fpsT0 > 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT0);
      this.frames = 0;
      this.fpsT0 = now;
    }
    this.updateSound(now);
    if (now - this.lastPublish > 100) this.publish();
  }

  // --------------------------------------------------------------- sound, graphics, lighting

  readonly sound = new SoundScape();
  private showSettings = false;
  private lastBoomT = -1;
  /** What the event sounds have played so far (the committee's signal log, contacts, groundings). */
  private heard = { log: undefined as unknown, signals: 0, contactT: -1, groundT: -1, knockAt: -1, crunchT: -1 };
  /** The river traffic's whistle signals (COLREGs Rules 34–35; src/app/soundSignals.ts). */
  private readonly whistles = new SignalScheduler();
  private whistleAt = -Infinity;
  private caption?: { text: string; t: number };
  private harbour = { at: -Infinity, value: 0 };
  private onGesture = () => this.sound.resume();
  private onPageHide = () => this.keepResumePoint();

  private onVisibility = () => {
    if (document.hidden) this.keepResumePoint();
    this.sound.setHidden(document.hidden);
    this.pace.skipFrames = Math.max(this.pace.skipFrames, 1);
  };

  /** The sounds follow the boat as drawn (the latest physics state). */
  private updateSound(now: number): void {
    const c = this.currSnap;
    const boom = c.lastBoomEvent?.t ?? -1;
    const crossed = boom !== this.lastBoomT && boom > this.lastBoomT;
    this.lastBoomT = boom;
    // Moored boats near (their halyards), once a second: the nearest mooring within 180 m.
    if (now - this.harbour.at > 1000) {
      this.harbour.at = now;
      let best = Infinity;
      for (const m of this.dartData?.features?.moorings ?? []) best = Math.min(best, (m.n - c.n) ** 2 + (m.e - c.e) ** 2);
      this.harbour.value = Math.max(0, 1 - Math.sqrt(best) / 180);
    }
    this.sound.update({ aws: c.aws, awa: c.awa, stw: c.stw, luffMain: c.forces.main.luff, luffJib: c.forces.jib.luff, bowDrop: this.view?.bowDrop ?? 0, boomCrossed: crossed, harbour: this.harbour.value, paused: this.paused || !!this.replay?.ended });
    this.eventSounds();
  }

  /** Twice a second: the traffic's fog signals and doubt signal, heard and captioned (not in replays). */
  private trafficSignals(now: number): void {
    if (now < this.whistleAt) this.whistles.reset();
    if (Math.abs(now - this.whistleAt) < 0.5) return;
    this.whistleAt = now;
    const fleet = this.race?.session.fleet ?? this.soloFleet;
    if (!fleet || this.replay) return;
    const s = this.currSnap;
    const visibilityM = (this.sim.env.sky ?? presetSky('clear')).at(now).visibilityM;
    const own = { n: s.n, e: s.e, vn: s.sog * Math.cos(s.cog), ve: s.sog * Math.sin(s.cog) };
    const due = this.whistles.update(now, fleet.ferriesAt(now), visibilityM, own);
    for (const sig of due) {
      const d = Math.hypot(sig.n - s.n, sig.e - s.e);
      this.sound.whistle(sig.blasts, d, sig.lengthM);
      this.caption = { text: `${sig.label}: ${blastsInWords(sig.blasts)} (${sig.rule}: ${sig.meaning})`, t: now };
    }
  }

  /**
   * Sounds for events (review GR-6): the race committee's sound signals with a caption, a knock for a contact and a
   * scrape for a grounding (their banner is the visual equivalent). Each event sounds once; a new run starts over.
   */
  private eventSounds(): void {
    const h = this.heard;
    const now = this.sim.time;
    if (now < h.contactT || now < h.groundT) Object.assign(h, { contactT: -1, groundT: -1, knockAt: -1, crunchT: -1 });
    this.trafficSignals(now);
    const log = this.race?.session.committee.log;
    if (log !== h.log) Object.assign(h, { log, signals: 0 });
    if (log) {
      for (; h.signals < log.length; h.signals++) {
        const s = log[h.signals]!;
        const text = signalCaption(s);
        if (!text) continue;
        this.sound.horn(s.long ? 1 : s.sounds, !!s.long);
        this.caption = { text, t: now };
      }
    }
    const events = this.race?.session.fleet.events ?? this.soloFleet?.events ?? [];
    for (let i = events.length - 1; i >= 0 && events[i]!.t > h.contactT; i--) {
      const e = events[i]!;
      if ((e.a === 'you' || e.b === 'you') && now - h.knockAt > 0.4 && now - e.t < 2) {
        this.sound.knock(e.speed / 3);
        h.knockAt = now;
      }
    }
    if (events.length) h.contactT = Math.max(h.contactT, events[events.length - 1]!.t);
    const g = this.sim.impacts[this.sim.impacts.length - 1];
    if (g && g.what === 'the bottom' && g.t > h.groundT) {
      if (now - g.t < 2) this.sound.scrape(g.speed / 2);
      h.groundT = g.t;
    }
    // Glassfibre breaking or the rig coming down: a crunch, louder the worse it is.
    if (g && g.t > h.crunchT && g.effects.some((x) => /cracked|holed|parted|broken|fell|torn|keel joint/.test(x))) {
      if (now - g.t < 2) this.sound.crunch(g.what === 'the rig' ? 1 : Math.min(1, g.energy / 8000));
      h.crunchT = g.t;
    }
  }

  setAudio(a: AudioSettings): void {
    this.sound.resume();
    this.sound.setSettings(a);
    this.publish(true);
  }

  toggleMute(): void {
    this.setAudio({ ...this.sound.settings, muted: !this.sound.settings.muted });
  }

  toggleSettings(force?: boolean): void {
    this.showSettings = force ?? !this.showSettings;
    this.publish(true);
  }

  setAutoLowerGraphics(on: boolean): void {
    this.autoLowerGraphics = on;
    this.publish(true);
  }

  /** Change and keep a preference (src/app/prefs.ts). */
  setPrefs(change: Partial<Prefs>): void {
    this.prefs = { ...this.prefs, ...change };
    savePrefs(this.prefs);
    this.dartScene?.setLightLabels(this.prefs.lightLabels);
    this.publish(true);
  }

  /** Apply and keep graphics settings (scenery detail and shadows need a reload of the page). */
  setGraphics(g: GraphicsSettings): void {
    // The user's own choice wins: no automatic lowering for the rest of this visit.
    this.autoLowerGraphics = false;
    this.view?.applyGraphics(g, true);
    this.settlePace();
    this.publish(true);
  }

  /**
   * Restart at the time of day (and with the sky) of a lighting preset on the scenario's date; the wind and
   * everything else are kept, and the tide follows the new time.
   */
  setLighting(preset: LightingPreset): void {
    const c = this.scenario.conditions;
    if (preset === 'now') {
      // Real time: today's live weather and sky if the site has them, else the wind as set at this minute.
      if (this.useLiveNow()) return;
      this.restart({ ...this.scenario, conditions: { ...c, startTime: nowStartTime() } });
      return;
    }
    const l = lightingStart(c.startTime, preset, RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    this.restart({ ...this.scenario, conditions: { ...c, startTime: l.startTime, sky: { source: 'preset', preset: l.sky } } });
  }

  // --------------------------------------------------------------- inputs

  /** Called by the simulation at the start of every step (deterministic sampling of held controls). */
  private sampleInputs(): Partial<ControlInput> | void {
    const r = this.replay;
    if (r) {
      // Playing back: the recorded input for this step, if there is one; the keyboard is ignored.
      const step = this.sim.step;
      while (r.next < r.inputs.length && r.inputs[r.next]!.step < step) r.next++;
      const e = r.inputs[r.next];
      if (e && e.step === step) {
        r.next++;
        return { ...e.input };
      }
      return undefined;
    }
    const i = this.sim.input;
    const change: Partial<ControlInput> = {};
    // "Show me" (a hint): the boat sails herself out of trouble for a few seconds; any key takes over again.
    const sm = this.showMe;
    if (sm && (this.sim.time >= sm.until || this.held.size > 0)) this.showMe = undefined;
    else if (sm) {
      // With no way on she answers the helm slowly (about 3°/s: there is no "back the jib" control yet).
      if (sm.action.kind === 'bear-away') change.helm = autopilotHelm(this.sim, { mode: 'twa', target: (sm.side * sm.action.twaDeg * Math.PI) / 180 });
      else if (sm.action.kind === 'ease-main') {
        change.autoMain = false;
        change.mainSheet = clamp(this.sim.currentSheet('main') + SHEET_RATE * DT, 0, 1);
      }
      return change;
    }
    const left = this.held.has('helmLeft');
    const right = this.held.has('helmRight');
    if (left !== right) change.helm = clamp(i.helm + (right ? 1 : -1) * HELM_RATE * DT, -1, 1);
    // Dragging the tiller (touch screens): the helm follows the finger at the keys' rate.
    else if (this.helmDrag !== undefined) {
      const d = this.helmDrag - i.helm;
      if (Math.abs(d) > 1e-4) change.helm = i.helm + Math.sign(d) * Math.min(Math.abs(d), HELM_RATE * DT);
    }
    else if (!this.held.has('helmHold') && i.helm !== 0) {
      const d = Math.min(Math.abs(i.helm), HELM_RETURN * DT);
      change.helm = i.helm - Math.sign(i.helm) * d;
    }
    const sheet = (name: 'main' | 'jib', inKey: string, outKey: string) => {
      const dir = (this.held.has(outKey) ? 1 : 0) - (this.held.has(inKey) ? 1 : 0);
      if (dir === 0) return;
      const autoKey = name === 'main' ? 'autoMain' : 'autoJib';
      const sheetKey = name === 'main' ? 'mainSheet' : 'jibSheet';
      const current = this.sim.currentSheet(name);
      change[autoKey] = false;
      change[sheetKey] = clamp(current + dir * SHEET_RATE * DT, 0, 1);
    };
    sheet('main', 'mainIn', 'mainOut');
    sheet('jib', 'jibIn', 'jibOut');
    return Object.keys(change).length ? change : undefined;
  }

  /** Dragging the tiller picture (touch): where the helm should go (−1 … 1), or undefined on letting go. */
  setHelmDrag(target: number | undefined): void {
    if (this.replay) return;
    this.helmDrag = target === undefined ? undefined : clamp(target, -1, 1);
  }

  /** Held controls (keyboard or on-screen buttons). */
  press(action: string, down: boolean): void {
    if (this.replay && down) return;
    if (down) this.held.add(action);
    else this.held.delete(action);
  }

  /** Test hook: advance the simulation synchronously (held controls still apply). */
  advance(seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      this.stepSim();
      if (this.sim.step % 10 === 0) this.recordTelemetry(this.sim.snapshot());
    }
    this.currSnap = this.sim.snapshot(false);
    this.prevSnap = this.currSnap;
    this.captureFleet();
    this.fleetPrev = this.fleetCurr;
    this.publish(true);
  }

  /** Retire from the race (scored RET). */
  retire(): void {
    if (!this.race) return;
    this.race.session.retire('you');
    this.publish(true);
  }

  /**
   * The crew stuff the worst hole they can reach with a sail bag or a cushion (it takes them about 20 s and
   * stops most of the flow): an input, so a replay repeats it (src/sim/boat/flooding.ts).
   */
  plugLeak(): void {
    if (this.replay) return;
    this.sim.setInput({ plug: (this.sim.input.plug ?? 0) + 1 });
    this.publish(true);
  }

  toggleResults(force?: boolean): void {
    this.showResults = force ?? !this.showResults;
    this.publish(true);
  }

  setInput(change: Partial<ControlInput>): void {
    if (this.replay) return; // playing back: the recording drives the boat
    this.sim.setInput(change);
    this.publish(true);
  }

  releaseSheets(): void {
    if (this.replay) return;
    this.sim.setInput({ autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1 });
    this.publish(true);
  }

  centreHelm(): void {
    if (this.replay) return;
    this.sim.setInput({ helm: 0 });
  }

  /**
   * A one-off pause the app makes itself (new shaders compiled after the river scene arrives, a change of drawing
   * mode or graphics, the graphics check): leave its frames out and start the measurement again, so it is not
   * taken for a device too slow to keep up (which would lower the graphics for nothing).
   */
  private settlePace(frames = 4): void {
    const w = this.pace;
    w.skipFrames = Math.max(w.skipFrames, frames);
    w.wall = 0;
    w.sim = 0;
    w.slowWindows = 0;
  }

  /**
   * Keeping up with real time (review PH-5). Each frame may advance at most 0.1 s and 12 steps, so on a slow
   * device the simulation runs slower than the clock. Over windows of 3 s of wall time (the frame after a hidden
   * tab returns is left out) the share of real time simulated is measured; under 90% the run is "running
   * slow", which the UI shows. After two slow windows in a row the graphics step down one preset (not saved),
   * at most every 30 s, while "lower the graphics when slow" is on.
   */
  private watchPace(wallS: number, simS: number): void {
    const w = this.pace;
    // The first frame after the tab is shown again spans the time it was hidden: not slowness.
    if (w.skipFrames > 0 || wallS > 30 || wallS <= 0) {
      w.skipFrames = Math.max(0, w.skipFrames - 1);
      return;
    }
    w.wall += wallS;
    w.sim += simS / this.timeScale;
    if (w.wall < 3) return;
    const ratio = w.sim / w.wall;
    w.wall = 0;
    w.sim = 0;
    const slow = ratio < 0.9;
    w.slowWindows = slow ? w.slowWindows + 1 : 0;
    const was = this.runningSlow;
    this.runningSlow = slow ? { ratio, lowered: was?.lowered } : undefined;
    if (slow && w.slowWindows >= 2 && this.autoLowerGraphics && this.view && performance.now() - w.lastLowered > 30_000) {
      const order: GraphicsPreset[] = ['ultra', 'balanced', 'performance'];
      const g = this.view.graphics;
      const at = g.preset === 'custom' ? 0 : order.indexOf(g.preset);
      const next = order[Math.min(order.length - 1, at + 1)]!;
      if (next !== g.preset) {
        this.view.applyGraphics(presetSettings(next, g.cameraMotion), false);
        w.lastLowered = performance.now();
        // Its own recompiling is not more slowness (the next step down is still at least 30 s away).
        w.skipFrames = Math.max(w.skipFrames, 4);
        this.runningSlow = { ratio, lowered: next };
      }
    }
    if (!!was !== !!this.runningSlow || was?.lowered !== this.runningSlow?.lowered) this.publish(true);
  }

  /**
   * The browser took the GPU context away or gave it back (review GR-3): pause while the picture is gone, so
   * nothing happens unseen, and carry on when it returns (unless the user had paused already).
   */
  private onGraphicsContext(lost: boolean): void {
    this.graphicsLost = lost;
    if (lost && !this.paused) {
      this.paused = true;
      this.pausedForGraphics = true;
    } else if (!lost && this.pausedForGraphics) {
      this.paused = false;
      this.pausedForGraphics = false;
      this.lastFrame = performance.now();
    }
    this.publish(true);
  }

  togglePause(): void {
    if (this.replay?.ended) return; // the recording is over: "Take over" sails on
    this.paused = !this.paused;
    this.lastFrame = performance.now();
    this.publish(true);
  }

  cycleCamera(): void {
    if (!this.view) return;
    // The start-line view is offered only when there is a course (a start line to look along).
    const modes = CAMERA_MODES.filter((m) => m !== 'line' || this.view!.hasStartLine);
    const i = modes.indexOf(this.view.cameraMode);
    this.setCamera(modes[(i + 1) % modes.length]!);
  }

  setCamera(mode: CameraMode): void {
    this.view?.setCameraMode(mode);
    this.publish(true);
  }

  /** The camera's pose (Three.js coordinates) and the helm view's look direction: for tests and screenshots. */
  cameraInfo(): { position: [number, number, number]; target: [number, number, number]; helm: { yaw: number; pitch: number; fov: number } } | undefined {
    return this.view ? { ...this.view.cameraPose(), helm: this.view.helmView } : undefined;
  }

  /** Drone view: fly back to the boat (B). */
  centreDrone(): void {
    this.view?.centreDrone();
  }

  /** Drone view: follow the boat, or stay where it was flown. */
  setDroneFollow(on: boolean): void {
    if (!this.view) return;
    this.view.droneFollow = on;
    if (on) this.view.centreDrone();
    this.publish(true);
  }

  toggleForces(): void {
    this.showForces = !this.showForces;
    if (this.view) this.view.showForces = this.showForces;
    this.publish(true);
  }

  toggleDebug(): void {
    this.showDebug = !this.showDebug;
    this.publish(true);
  }

  toggleDashboard(force?: boolean): void {
    this.showDashboard = force ?? !this.showDashboard;
    this.publish(true);
  }

  togglePolar(force?: boolean): void {
    this.showPolar = force ?? !this.showPolar;
    this.publish(true);
  }

  toggleLabels(force?: boolean): void {
    this.showLabels = force ?? !this.showLabels;
    this.publish(true);
  }

  toggleMinimap(force?: boolean): void {
    this.showMinimap = force ?? !this.showMinimap;
    this.publish(true);
  }

  toggleLayers(force?: boolean): void {
    this.showLayers = force ?? !this.showLayers;
    this.publish(true);
  }

  toggleEditor(force?: boolean): void {
    this.showEditor = force ?? !this.showEditor;
    this.publish(true);
  }

  toggleHelp(force?: boolean): void {
    this.showHelp = force ?? !this.showHelp;
    this.publish(true);
  }

  get steering(): SteeringMode {
    return this.steeringMode;
  }

  /** Bow or tiller steering (D4), kept in this browser. Held helm keys are let go, so none sticks. */
  setSteering(m: SteeringMode): void {
    this.steeringMode = m;
    saveSteering(m);
    this.held.delete('helmLeft');
    this.held.delete('helmRight');
    this.publish(true);
  }

  /** A held key's action; the steering keys follow the steering mode. */
  private keyAction(code: string): string | undefined {
    const a = SimController.KEYMAP[code];
    if (a === 'helmLeft' || a === 'helmRight') return helmAction(a === 'helmLeft' ? 'left' : 'right', this.steeringMode);
    return a;
  }

  private static readonly KEYMAP: Record<string, string> = {
    ArrowLeft: 'helmLeft', KeyA: 'helmLeft', ArrowRight: 'helmRight', KeyD: 'helmRight',
    ArrowUp: 'mainIn', KeyW: 'mainIn', ArrowDown: 'mainOut', KeyS: 'mainOut',
    KeyE: 'jibIn', KeyQ: 'jibOut', ShiftLeft: 'helmHold', ShiftRight: 'helmHold',
  };

  /**
   * Whether a key belongs to the focused control rather than the boat: everything in a text field; in a list,
   * slider, checkbox or button only the keys that work it (the arrows, Space, Enter, Home and End). The letter keys
   * sail the boat even while the camera list or a slider has the focus (owner review, 5 Nov 2026: after the
   * camera was chosen from its list, A and D no longer steered, and D chose the drone view).
   */
  static keyForControl(target: EventTarget | null, code: string): boolean {
    const t = target as HTMLElement | null;
    if (!t || !t.tagName) return false;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
    if (t.tagName === 'INPUT') {
      const type = (t as HTMLInputElement).type;
      if (!['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(type)) return true;
    } else if (t.tagName !== 'SELECT' && t.tagName !== 'BUTTON') return false;
    // Escape always reaches the app (it closes the panels), whatever has the focus.
    return /^(Arrow|Page)|^(Space|Enter|NumpadEnter|Home|End)$/.test(code);
  }

  private onKeyDown = (ev: KeyboardEvent) => {
    // Browsers let sound start only after the user has pressed a key or clicked.
    this.sound.resume();
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (SimController.keyForControl(ev.target, ev.code)) return;
    const held = this.keyAction(ev.code);
    if (held) {
      this.press(held, true);
      ev.preventDefault();
      return;
    }
    switch (ev.code) {
      case 'Space': this.centreHelm(); break;
      case 'KeyX': this.releaseSheets(); break;
      case 'KeyJ': this.setInput({ autoJib: !this.sim.input.autoJib }); break;
      case 'KeyM': this.setInput({ autoMain: !this.sim.input.autoMain }); break;
      case 'KeyK': this.setInput({ autoCrew: !this.sim.input.autoCrew }); break;
      case 'KeyZ': this.setInput({ flatten: Math.round(((this.sim.input.flatten ?? 0) + (ev.shiftKey ? -0.25 : 0.25)) * 4) / 4 }); break;
      case 'KeyP': this.togglePause(); break;
      case 'KeyR': this.requestReset(); break;
      case 'KeyC': this.cycleCamera(); break;
      case 'KeyU': this.toggleMute(); break;
      case 'KeyB': this.centreDrone(); break;
      case 'KeyF': this.toggleForces(); break;
      case 'KeyG': this.toggleDebug(); break;
      case 'KeyV': this.toggleDashboard(); break;
      case 'KeyL': this.toggleLabels(); break;
      case 'KeyN': this.toggleMinimap(); break;
      case 'KeyH': case 'Slash': this.toggleHelp(); break;
      case 'Escape': this.toggleHelp(false); this.togglePolar(false); this.toggleLayers(false); this.toggleSettings(false); break;
      default: return;
    }
    ev.preventDefault();
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    const held = this.keyAction(ev.code);
    if (held) this.press(held, false);
  };

  private onBlur = () => this.held.clear();

  // ------------------------------------------------------------ UI store

  private recordTelemetry(s: BoatSnapshot): void {
    if (s.t - this.lastRecordT < 0.099) return;
    this.lastRecordT = s.t;
    this.telemetry.record(s);
  }

  private publish(force = false): void {
    if (!force && performance.now() - this.lastPublish < 100) return;
    this.lastPublish = performance.now();
    // Sunk in a race: she retires (she cannot finish).
    if (this.race && !this.replay && this.sim.damage.state === 'sunk' && !this.race.session.outOfRace('you')) this.race.session.retire('you');
    // Show the results once when the race is over.
    const over = !!this.race && (this.race.session.committee.finished || this.race.session.committee.abandoned);
    if (over && !this.resultsShown) {
      this.resultsShown = true;
      this.showResults = true;
    }
    // One detailed snapshot per publish (10 Hz) feeds the UI and the telemetry.
    this.detailSnap = this.sim.snapshot();
    if (!this.paused) this.recordTelemetry(this.detailSnap);
    this.ui = {
      snapshot: this.detailSnap,
      paused: this.paused,
      timeScale: this.timeScale,
      tutorial:
        this.tutorial && this.lesson
          ? {
              ...this.tutorial.state,
              finished: this.tutorial.finished,
              lesson: {
                id: this.lesson.id,
                number: this.lesson.number,
                title: this.lesson.title,
                group: this.lesson.group,
                count: lessonsIn(this.lesson.group).length,
                inGroup: lessonsIn(this.lesson.group).findIndex((l) => l.id === this.lesson!.id) + 1,
              },
              result: this.lessonResult,
            }
          : undefined,
      lessons: LESSONS.map((l) => ({ id: l.id, group: l.group, number: l.number, title: l.title, summary: l.summary, minutes: l.minutes, done: !!this.lessonProgress[l.id], bestS: this.lessonProgress[l.id]?.bestS })),
      teaching: this.teachingOn,
      level: this.interfaceLevel,
      confirmReset: this.confirmReset,
      confirmLeave: this.leave?.what,
      replay: this.replay
        ? {
            title: this.replay.rec.title,
            state: this.replay.divergedAt !== undefined ? 'diverged' : this.replay.ended ? 'ended' : 'playing',
            finished: this.replay.ended,
            verifiedToS: this.replay.verifiedTo,
            checkpointsMatched: this.replay.matched,
            checkpointsTotal: this.replay.total,
            divergedAtS: this.replay.divergedAt,
            endS: this.replay.rec.endStep * DT,
            notes: this.replay.notes,
          }
        : undefined,
      camera: this.view?.cameraMode ?? 'chase',
      droneFollow: this.view?.droneFollow ?? false,
      coach: this.coach ? { on: this.coachOn, briefing: this.coach.briefing, tips: this.coach.recent, debrief: this.debrief, now: this.sim.time } : undefined,
      showForces: this.showForces,
      showDebug: this.showDebug,
      showHelp: this.showHelp,
      showDashboard: this.showDashboard,
      showPolar: this.showPolar,
      scenario: this.scenario,
      envLabel: this.sim.env.label,
      fps: this.fps,
      physicsMsPerFrame: this.physMs,
      webglError: this.webglError,
      graphicsLost: this.graphicsLost,
      runningSlow: this.paused ? undefined : this.runningSlow,
      autoLowerGraphics: this.autoLowerGraphics,
      prefs: { ...this.prefs },
      hint: this.hints.current,
      milestones: { ...this.milestones },
      resume: this.resumePoint
        ? {
            label: this.resumePoint.label,
            summary: resumeSummary(this.resumePoint, new Date(), DT),
            note: this.resumePoint.rec.build !== BUILD_ID ? 'Kept by an earlier version: she may not end exactly where you left her.' : undefined,
          }
        : undefined,
      ghost: this.ghost ? { title: this.ghost.title, endS: this.ghost.endS } : undefined,
      ghostLoading: this.ghostLoading,
      catchingUp: this.catchUp ? clamp((this.sim.step - this.catchUp.from) / Math.max(1, this.catchUp.to - this.catchUp.from), 0, 1) : undefined,
      scenarioError: this.scenarioError,
      race: this.raceUi(),
      weatherSources: this.weatherSources,
      tideSources: this.tideSources,
      liveIssues: this.liveIssues,
      telemetryVersion: this.telemetry.version,
      dart: { status: this.dartStatus, issues: this.dartData?.issues ?? [] },
      showLabels: this.showLabels,
      showMinimap: this.showMinimap,
      showLayers: this.showLayers,
      showEditor: this.showEditor,
      showResults: this.showResults,
      fleet: (this.race?.session.fleet.boats ?? []).filter((b) => b.id !== 'you').map((b) => ({ id: b.id, n: b.sim.state.n, e: b.sim.state.e, heading: b.sim.state.psi, colour: b.colour, label: b.sailNumber })),
      contact: this.contactText(),
      soundCaption: this.caption && this.sim.time - this.caption.t < 5 && this.sim.time >= this.caption.t ? this.caption.text : undefined,
      showSettings: this.showSettings,
      graphics: this.view?.graphics,
      sceneryBuilt: this.view?.sceneryBuilt,
      shadowsBuilt: this.view?.shadowsBuilt,
      audio: this.sound.settings,
      audioRunning: this.sound.running,
      steering: this.steeringMode,
      materialCheck: this.lastMaterialCheck && { fault: this.lastMaterialCheck.fault, reason: this.lastMaterialCheck.reason, mode: this.lastMaterialCheck.mode, at: this.lastMaterialCheck.at },
      materialMode: this.view?.materialMode,
      gpuName: this.view?.gpuName,
      build: { id: BUILD_ID, time: BUILD_TIME },
    };
    for (const l of this.listeners) l();
  }

  /** The nearer end of the starting line from the user's boat, for a boat over the line at the start. */
  private ocsGuideNow(r: NonNullable<SimController['race']>, s: { n: number; e: number; psi: number }, sinceStartS: number): OcsGuide {
    const kindOf = (id: string) => r.course.marks.find((m) => m.id === id)?.kind;
    const label = (id: string) => (kindOf(id) === 'committee-boat' ? 'the committee boat' : kindOf(id) === 'pin' ? 'the pin end' : (r.course.marks.find((m) => m.id === id)?.name ?? id));
    const [a, b] = r.resolved.start;
    const [ia, ib] = r.course.start.ends;
    return ocsGuide({ n: s.n, e: s.e, headingRad: s.psi }, [{ ...a, label: label(ia) }, { ...b, label: label(ib) }], sinceStartS);
  }

  private raceUi(): RaceUi | undefined {
    const r = this.race;
    if (!r) return undefined;
    const session = r.session;
    const t = this.sim.time;
    const judge = session.judgeOf('you');
    const st = judge.state(t);
    const leg = r.resolved.legs[st.legIndex];
    const s = this.sim.state;
    const target = leg?.target ?? (st.phase === 'racing' ? { n: (r.resolved.finish[0].n + r.resolved.finish[1].n) / 2, e: (r.resolved.finish[0].e + r.resolved.finish[1].e) / 2 } : undefined);
    const cm = session.committee;
    const statusOf = session.status();
    // Live ranking: finished boats by time, then legs completed, then distance to the next mark.
    const progress = session.fleet.boats.map((b) => {
      const j = session.judgeOf(b.id);
      const sj = statusOf.find((x) => x.id === b.id)!;
      const l = r.resolved.legs[j.legIndex];
      const tgt = l?.target ?? r.resolved.finish[0];
      const d = Math.hypot(tgt.n - b.sim.state.n, tgt.e - b.sim.state.e);
      return { b, key: sj.finished ? -1e9 + (sj.finishTime ?? 0) : sj.started ? -j.legIndex * 1e6 + d : 1e9 + d };
    }).sort((a, b) => a.key - b.key);
    const position = progress.findIndex((p) => p.b.id === 'you') + 1;
    const raceOver = cm.finished || cm.abandoned;
    const youDone = st.phase === 'finished' || session.outOfRace('you');
    const results: FleetRow[] | undefined = raceOver || youDone
      ? session.results().map((row) => {
          const b = session.fleet.boat(row.id)!;
          const sj = statusOf.find((x) => x.id === row.id)!;
          return {
            id: row.id, name: row.name, sailNumber: row.sailNumber, colour: b.colour, you: row.id === 'you',
            place: row.place, code: row.code, elapsed: row.elapsed, points: row.points, penalties: row.penalties,
            status: row.code === 'FIN' ? 'Finished' : raceOver ? row.code : sj.started ? 'Racing' : 'Not started',
          };
        })
      : undefined;
    const dq = cm.bfd.has('you') ? 'Black flag (rule 30.4): disqualified (BFD)' : cm.ufd.has('you') ? 'U flag (rule 30.3): disqualified (UFD)' : undefined;
    return {
      courseName: r.course.name,
      courseStatus: r.course.status,
      phase: st.phase,
      toStart: cm.startTime - t,
      nextSignal: cm.nextSignal(t)?.name,
      ocs: st.ocs,
      ocsGuide: st.ocs && t >= cm.startTime ? this.ocsGuideNow(r, s, t - cm.startTime) : undefined,
      mayStart: st.mayStart,
      legIndex: st.legIndex,
      legCount: st.legCount,
      lap: leg?.lap ?? r.course.laps,
      laps: r.course.laps,
      nextLabel: st.phase === 'pre-start' ? 'Start line' : leg?.label ?? (st.phase === 'racing' ? 'Finish line' : undefined),
      nextDistance: target ? Math.hypot(target.n - s.n, target.e - s.e) : undefined,
      nextBearingDeg: target ? (((Math.atan2(target.e - s.e, target.n - s.n) * 180) / Math.PI) + 360) % 360 : undefined,
      startTime: st.startTime,
      finishTime: st.finishTime,
      events: st.events.slice(-12),
      warnings: r.warnings,
      flags: [...cm.flags],
      signals: session.log.filter((l) => l.kind === 'signal').slice(-8),
      log: session.log.filter((l) => l.kind !== 'signal').slice(-10),
      attempt: cm.attempt,
      prepFlag: cm.prepFlag,
      position: session.fleet.boats.length > 1 ? position : undefined,
      fleetSize: session.fleet.boats.length,
      penaltyOwed: session.owesPenalty('you'),
      results,
      raceOver,
      disqualified: dq,
      best: this.raceBest.start || this.raceBest.finish ? { ...this.raceBest } : undefined,
    };
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): UiState => this.ui;
}

/**
 * Where to put the boat before the start when sailing a course alone: 100 m behind the start line on the
 * pre-start side and 160 m along it towards the committee-boat end (the second end), heading along the line
 * towards the pin. From there, turning up to close-hauled on starboard crosses the line near its middle.
 */
export function preStartPosition(r: ResolvedCourse, clear?: ClearWater): { n: number; e: number; headingDeg: number; speedKn: number } {
  const [a, b] = r.start;
  const m = { n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 };
  const len = Math.hypot(b.n - a.n, b.e - a.e) || 1;
  // Unit normal to the line, pointing away from the first mark.
  let nn = -(b.e - a.e) / len;
  let ne = (b.n - a.n) / len;
  const first = r.legs[0]!.target;
  if ((first.n - m.n) * nn + (first.e - m.e) * ne > 0) {
    nn = -nn;
    ne = -ne;
  }
  const heading = (Math.atan2(a.e - b.e, a.n - b.n) * 180) / Math.PI;
  const along = 160;
  const p = { n: m.n + nn * 100 + ((b.n - a.n) / len) * along, e: m.e + ne * 100 + ((b.e - a.e) / len) * along, headingDeg: (heading + 360) % 360, speedKn: 3 };
  if (!clear || clear(p.n, p.e)) return p;
  // Not clear there (a river line runs from bank to bank): the first clear starting slot instead.
  const slot = startPositions(r, 1, clear)[0]!;
  return { n: slot.n!, e: slot.e!, headingDeg: slot.headingDeg ?? p.headingDeg, speedKn: 3 };
}

/** A remembered on/off choice in this browser (storage can be unavailable: then the default). */
function readFlag(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Not remembered: storage is unavailable.
  }
}
