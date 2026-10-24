import { DT, Simulation, type BoatSnapshot, type ControlInput, type InputLogEntry } from '../sim/simulation';
import { squibParams } from '../sim/boat/squib';
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
import { createRace, practiceLineLength } from '../sim/race/setup';
import { Fleet } from '../sim/race/fleet';
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
import { loadLive, parseLiveIndex, type Freshness, type LiveIndexEntry } from '../sim/env/liveData';
import { CHECKPOINT_STEPS, REPLAY_SCHEMA, decodeInputs, encodeInputs, parseRecording, type Recording, type ReplayStatus } from './replay';
import { TUTORIAL_INPUT, TUTORIAL_SCENARIO, Tutorial, type TutorialState } from './tutorial';
import { sailState } from './sailStatus';

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
  /** The interactive tutorial, while it runs. */
  tutorial?: TutorialState & { finished: boolean };
  /** Reset was asked for during a race: the UI asks before throwing the race away. */
  confirmReset: boolean;
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
}

type Listener = () => void;

/** Helm and sheet rates for held keys/buttons (fraction of full travel per second). */
const HELM_RATE = 1.4;
const HELM_RETURN = 1.8;
const SHEET_RATE = 0.35;
const MAX_STEPS_PER_FRAME = 12;
/** Identifies the build in recordings (Vite's mode and the package version; a commit id when CI provides one). */
const BUILD_ID = `${import.meta.env.MODE}-${import.meta.env.VITE_BUILD_ID ?? 'local'}`;
/** Fills a partial starting input to a full one for the recording. */
const DEFAULT_INPUT_FOR_RECORD: ControlInput = { helm: 0, mainSheet: 0.3, jibSheet: 0.3, autoMain: false, autoJib: true, crewHike: 0.6, autoCrew: true };

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
  private held = new Set<string>();
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
  /** The interactive tutorial, while it runs (src/app/tutorial.ts). */
  private tutorial?: Tutorial;
  private confirmReset = false;
  private lastRecordT = -Infinity;
  private frames = 0;
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
          features: this.dartData?.features,
          course,
          aiCount: Math.max(0, Math.min(20, Math.round(fleet.aiCount))),
          level: fleet.level,
          seed: scenario.conditions.gusts.seed,
          human: {
            controller: () => this.sampleInputs(),
            input: startInput,
            // Sailing the course alone: 100 m behind the line as before; with a fleet, the first starting slot.
            initial: fleet.aiCount > 0 ? undefined : preStartPosition,
          },
          committee: { startAt: Math.round(seq.startInS), sequence: seq.sequence, prepFlag: fleet.prepFlag },
        });
        const session = created.session;
        race = { course, resolved: session.course, session, warnings: created.warnings };
        sim = session.fleet.boat('you')!.sim;
      } catch (err) {
        this.scenarioError = (err as Error).message;
        this.publish(true);
        return false;
      }
    } else {
      // Free sailing: the user's boat alone in a one-boat fleet, so moored boats and ferries are solid.
      sim = new Simulation({
        params: squibParams(),
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
      if (f) fleet.setObstacles({ moored: f.moorings.map((m) => ({ n: m.n, e: m.e, l: m.l, area: m.a })), ferries: f.ferries });
      this.soloFleet = fleet;
    }
    if (race) this.soloFleet = undefined;
    this.scenarioError = undefined;
    this.scenario = structuredClone(scenario);
    this.built = built;
    this.race = race;
    this.sim = sim;
    // Start with sensible manual sheet settings for the starting point of sail.
    if (!startInput) this.sim.setInput(optimalSheets(this.sim));
    this.initialInput = startInput ? { ...DEFAULT_INPUT_FOR_RECORD, ...startInput } : null;
    this.checkpoints = [];
    if (!opts.keepReplay) {
      this.replay = undefined;
      this.timeScale = 1;
    }
    this.confirmReset = false;
    // Starting anything other than the tutorial's own scenario ends the tutorial (Reset keeps it).
    if (this.tutorial && JSON.stringify(scenario) !== JSON.stringify(TUTORIAL_SCENARIO)) this.tutorial = undefined;
    this.currSnap = this.sim.snapshot(false);
    this.prevSnap = this.currSnap;
    this.detailSnap = this.sim.snapshot();
    this.captureFleet();
    this.fleetPrev = this.fleetCurr;
    this.showResults = false;
    this.resultsShown = false;
    this.view?.setCourse(this.race?.resolved, this.race?.course);
    this.view?.setFleet(this.fleetList());
    this.lastWeather = -Infinity; // new conditions: update the sky at the next frame
    this.accumulator = 0;
    this.telemetry.clear();
    this.lastRecordT = -Infinity;
    this.publish(true);
    return true;
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
  }

  /**
   * Reset from the toolbar or R. Once the start signal has gone (and until you finish), ask first: one key
   * would otherwise throw the race away (error prevention). Otherwise reset at once.
   */
  requestReset(): void {
    const judge = this.race?.session.judgeOf('you');
    if (judge && !this.replay && this.sim.time >= judge.startSignalTime && judge.phase !== 'finished') {
      this.confirmReset = true;
      this.publish(true);
      return;
    }
    this.restart();
  }

  answerReset(reset: boolean): void {
    this.confirmReset = false;
    if (reset) this.restart();
    else this.publish(true);
  }

  // ------------------------------------------------------------- tutorial

  /** Start the interactive tutorial: its own open-water scenario, steady breeze, steps checked as you sail. */
  startTutorial(): void {
    if (!this.restart(structuredClone(TUTORIAL_SCENARIO), { initialInput: TUTORIAL_INPUT })) return;
    this.tutorial = new Tutorial();
    this.paused = false;
    this.applyTutorialInput();
    this.publish(true);
  }

  endTutorial(): void {
    this.tutorial = undefined;
    this.publish(true);
  }

  tutorialNext(): void {
    this.tutorial?.next();
    this.applyTutorialInput();
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

  /** Every 0.1 s of simulated time: check the step's goal; move on 2 s after it is met. */
  private updateTutorial(): void {
    const t = this.tutorial!;
    const s = this.sim.snapshot(false);
    const R2D = 180 / Math.PI;
    t.update({
      t: s.t,
      headingDeg: s.heading * R2D,
      twaDeg: Math.abs(s.twa) * R2D,
      stwKn: s.stw / 0.514444,
      mainSide: s.mainSide,
      main: sailState(s.forces.main),
      autoMain: s.input.autoMain,
      autoCrew: s.input.autoCrew,
      crewHike: s.input.crewHike,
    });
    const since = t.sinceDone(s.t);
    if (since !== undefined && since >= 2 && t.state.index < t.state.total - 1) {
      t.next();
      this.applyTutorialInput();
      this.publish(true);
    }
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

  /** Stop the replay here and sail on from this point (the recording continues from the replayed part). */
  takeOver(): void {
    this.replay = undefined;
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
      return `Contact with ${other} at ${e.speed.toFixed(1)} m/s`;
    }
    return undefined;
  }

  /** Contacts in free sailing (moored boats, ferries), newest last. */
  get soloContacts() {
    return this.soloFleet?.events ?? [];
  }

  /** The other boats of the fleet (for the 3D view). */
  private fleetList(): { id: string; label: string; colour: number }[] {
    return (this.race?.session.fleet.boats ?? []).filter((b) => b.id !== 'you').map((b) => ({ id: b.id, label: b.sailNumber, colour: b.colour }));
  }

  /** Poses of the other boats now (kept for the last two physics states, for render interpolation). */
  private captureFleet(): void {
    const m = new Map<string, FleetPose>();
    for (const b of this.race?.session.fleet.boats ?? []) {
      if (b.id === 'you') continue;
      const sn = b.sim.snapshot(false);
      m.set(b.id, {
        id: b.id, n: sn.n, e: sn.e, heading: sn.heading, heel: sn.heel, boomMain: sn.boomMain, boomJib: sn.boomJib,
        mainSide: sn.mainSide, jibSide: sn.jibSide, mainLuff: sn.forces.main.luff, jibLuff: sn.forces.jib.luff,
        mainInverted: Math.abs(sn.forces.main.incidence) > Math.PI / 2, jibInverted: Math.abs(sn.forces.jib.incidence) > Math.PI / 2,
        rudder: sn.rudder, crewY: sn.crewY,
      });
    }
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
        this.dartScene = new DartScene({ manifest: data.manifest, geo: data.geo, features: data.features, drape: data.drape });
        this.view.setDart(this.dartScene, (n, e) => data.geo!.depth(n, e, this.sim.waterLevel()));
      } catch (err) {
        data.issues.push({ asset: '3D scene', message: (err as Error).message, effect: 'River Dart not drawn; the physics still uses it.' });
      }
    }
    // A scenario that needed the Dart (channel stream) may not have started: rebuild either way.
    this.restart(this.scenario);
  }

  attach(container: HTMLElement): void {
    // Start downloading the River Dart data first: building the view compiles shaders for a second or more,
    // and the download runs meanwhile (the scene is added when both are ready).
    void this.loadDart();
    try {
      this.view = new SceneView(container, this.sim.params);
    } catch (err) {
      this.webglError = `3D view unavailable: ${(err as Error).message}. The simulation still runs; instruments remain live.`;
    }
    this.view?.setCourse(this.race?.resolved, this.race?.course);
    this.view?.setFleet(this.fleetList());
    this.lastWeather = -Infinity; // new conditions: update the sky at the next frame
    this.lastFrame = performance.now();
    this.fpsT0 = this.lastFrame;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    void this.discoverSources();
    this.publish(true);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
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

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      const t0 = performance.now();
      this.accumulator += dt * this.timeScale;
      let steps = 0;
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
    }
    const alpha = this.paused ? 1 : clamp(this.accumulator / DT, 0, 1);
    const info = this.detailSnap.env;
    const sim = this.sim;
    if (now - this.lastWeather > 1000) {
      this.lastWeather = now;
      this.view?.setWeather(this.sceneWeather());
    }
    this.view?.render(this.prevSnap, this.currSnap, alpha, this.renderTime, dt, {
      puffs: sim.env.windField?.puffs() ?? [],
      windAgainstTide: info?.windAgainstTide ?? false,
      dart: this.dartScene
        ? {
            waterLevel: sim.waterLevel(),
            epochMs: (sim.env.startEpochMs ?? Date.parse(this.scenario.conditions.startTime)) + sim.time * 1000,
            stream: (n, e) => sim.env.current(sim.time, n, e),
            windFromDir: this.currSnap.twdGround,
            showLabels: this.showLabels,
          }
        : undefined,
      course: this.race ? { nextLeg: this.race.session.judgeOf('you').legIndex, phase: this.race.session.judgeOf('you').phase, showLabels: this.showLabels } : undefined,
      fleet: this.race ? { prev: this.fleetPrev, curr: this.fleetCurr, showLabels: this.showLabels } : undefined,
    });
    this.frames++;
    if (now - this.fpsT0 > 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT0);
      this.frames = 0;
      this.fpsT0 = now;
    }
    if (now - this.lastPublish > 100) this.publish();
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
    const left = this.held.has('helmLeft');
    const right = this.held.has('helmRight');
    if (left !== right) change.helm = clamp(i.helm + (right ? 1 : -1) * HELM_RATE * DT, -1, 1);
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

  togglePause(): void {
    if (this.replay?.ended) return; // the recording is over: "Take over" sails on
    this.paused = !this.paused;
    this.lastFrame = performance.now();
    this.publish(true);
  }

  cycleCamera(): void {
    if (!this.view) return;
    const i = CAMERA_MODES.indexOf(this.view.cameraMode);
    this.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]!);
  }

  setCamera(mode: CameraMode): void {
    this.view?.setCameraMode(mode);
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

  private static readonly KEYMAP: Record<string, string> = {
    ArrowLeft: 'helmLeft', KeyA: 'helmLeft', ArrowRight: 'helmRight', KeyD: 'helmRight',
    ArrowUp: 'mainIn', KeyW: 'mainIn', ArrowDown: 'mainOut', KeyS: 'mainOut',
    KeyE: 'jibIn', KeyQ: 'jibOut', ShiftLeft: 'helmHold', ShiftRight: 'helmHold',
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const held = SimController.KEYMAP[ev.code];
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
      case 'KeyP': this.togglePause(); break;
      case 'KeyR': this.requestReset(); break;
      case 'KeyC': this.cycleCamera(); break;
      case 'KeyF': this.toggleForces(); break;
      case 'KeyG': this.toggleDebug(); break;
      case 'KeyV': this.toggleDashboard(); break;
      case 'KeyL': this.toggleLabels(); break;
      case 'KeyN': this.toggleMinimap(); break;
      case 'KeyH': case 'Slash': this.toggleHelp(); break;
      case 'Escape': this.toggleHelp(false); this.togglePolar(false); this.toggleLayers(false); break;
      default: return;
    }
    ev.preventDefault();
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    const held = SimController.KEYMAP[ev.code];
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
      tutorial: this.tutorial ? { ...this.tutorial.state, finished: this.tutorial.finished } : undefined,
      confirmReset: this.confirmReset,
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
    };
    for (const l of this.listeners) l();
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
export function preStartPosition(r: ResolvedCourse): { n: number; e: number; headingDeg: number; speedKn: number } {
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
  return { n: m.n + nn * 100 + ((b.n - a.n) / len) * along, e: m.e + ne * 100 + ((b.e - a.e) / len) * along, headingDeg: (heading + 360) % 360, speedKn: 3 };
}
