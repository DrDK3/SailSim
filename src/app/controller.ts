import { DT, Simulation, type BoatSnapshot, type ControlInput } from '../sim/simulation';
import { squibParams } from '../sim/boat/squib';
import { buildConditions, type BuiltConditions, type ConditionsSettings } from '../sim/env/conditions';
import { clamp } from '../sim/math/angles';
import { optimalSheets } from '../sim/control/trim';
import { CAMERA_MODES, SceneView, type CameraMode } from '../render/scene';
import { Telemetry } from './telemetry';
import { loadDartData, type DartData } from './geoLoader';
import { DartScene } from '../render/dart';
import { courseFor, type CourseChoice } from './courseLibrary';
import type { ResolvedCourse } from '../sim/course/course';
import { CourseJudge, hullReferencePoints, startSequence, type RaceEvent } from '../sim/course/judge';
import { validateCourse, DART_LEVELS, type CourseIssue } from '../sim/course/validate';
import { buildRestrictions } from '../sim/course/restrictions';
import type { Course } from '../sim/course/types';
import { DART_PROJECTION } from '../sim/geo/projection';
import { windFrom } from '../sim/boat/forces';

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
  kind: 'live' | 'replay';
  label: string;
  url: string;
  validTime?: string;
  json: unknown;
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
  telemetryVersion: number;
  /** River Dart data: loading, loaded, or unavailable; plus anything that failed to load. */
  dart: { status: 'loading' | 'loaded' | 'unavailable'; issues: DartData['issues'] };
  showLabels: boolean;
  showMinimap: boolean;
  showLayers: boolean;
  showEditor: boolean;
}

type Listener = () => void;

/** Helm and sheet rates for held keys/buttons (fraction of full travel per second). */
const HELM_RATE = 1.4;
const HELM_RETURN = 1.8;
const SHEET_RATE = 0.35;
const MAX_STEPS_PER_FRAME = 12;

/** Data files the app looks for next to itself (see public/live/README.md). */
const WEATHER_FILES: { url: string; kind: 'live' | 'replay' }[] = [
  { url: 'live/latest.json', kind: 'live' },
  { url: 'live/metoffice-replay-2026-10-22T0715Z.json', kind: 'replay' },
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
  dartData?: DartData;
  private dartStatus: UiState['dart']['status'] = 'loading';
  private dartScene?: DartScene;
  private showLabels = true;
  /** The course being sailed, its judge and the validator's warnings. */
  race?: { course: Course; resolved: ResolvedCourse; judge: CourseJudge; warnings: CourseIssue[] };
  private showMinimap = true;
  private showLayers = false;
  private showEditor = false;

  constructor() {
    this.restart();
  }

  // ------------------------------------------------------------ lifecycle

  /** Start (or restart) a run. On invalid settings the previous run continues and the error is shown. */
  restart(scenario: AppScenario = this.scenario): boolean {
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
    let race: SimController['race'];
    let initial: { n: number; e: number; headingDeg: number; speedKn: number } = { n: loc.n, e: loc.e, headingDeg: scenario.startHeadingDeg, speedKn: scenario.startSpeedKn };
    if (scenario.course) {
      try {
        const w = windFrom(built.env.wind(0, loc.n, loc.e));
        const course = courseFor(scenario.course, { n: loc.n, e: loc.e }, (w.fromDir * 180) / Math.PI);
        const v = validateCourse(course, this.validationContext());
        const errors = v.issues.filter((i) => i.severity === 'error');
        if (!v.ok || !v.resolved) throw new Error(`course "${course.name}" is not valid: ${errors.map((e) => e.message).join(' ')}`);
        const seq = scenario.race ?? { sequence: 'one-minute', startInS: 90 };
        const params = squibParams();
        const judge = new CourseJudge(v.resolved, hullReferencePoints(params.loa, params.beam), startSequence(Math.round(seq.startInS), seq.sequence));
        race = { course, resolved: v.resolved, judge, warnings: v.issues.filter((i) => i.severity === 'warning') };
        initial = { ...preStartPosition(v.resolved), speedKn: scenario.startSpeedKn };
      } catch (err) {
        this.scenarioError = (err as Error).message;
        this.publish(true);
        return false;
      }
    }
    this.scenarioError = undefined;
    this.scenario = structuredClone(scenario);
    this.built = built;
    this.race = race;
    const prevInput = this.sim?.input;
    this.sim = new Simulation({
      params: squibParams(),
      env: built.env,
      seabed: geo,
      initial,
      input: prevInput ? { ...prevInput, helm: 0 } : undefined,
      controller: () => this.sampleInputs(),
    });
    // Start with sensible manual sheet settings for the starting point of sail.
    if (!prevInput) this.sim.setInput(optimalSheets(this.sim));
    this.currSnap = this.sim.snapshot(false);
    this.prevSnap = this.currSnap;
    this.detailSnap = this.sim.snapshot();
    this.race?.judge.update(0, { n: this.sim.state.n, e: this.sim.state.e, heading: this.sim.state.psi });
    this.view?.setCourse(this.race?.resolved, this.race?.course);
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

  /** One physics step plus the course judge. */
  private stepSim(): void {
    this.sim.stepOnce();
    this.race?.judge.update(this.sim.time, { n: this.sim.state.n, e: this.sim.state.e, heading: this.sim.state.psi });
  }

  /** Look for live and replay weather files served with the app. Missing files are simply not offered. */
  async discoverSources(): Promise<void> {
    const found: DataSource[] = [];
    for (const f of WEATHER_FILES) {
      try {
        const res = await fetch(f.url, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = (await res.json()) as { model?: { valid?: string; available?: boolean } };
        if (!json.model?.available) continue;
        found.push({
          id: f.url,
          kind: f.kind,
          url: f.url,
          validTime: json.model.valid,
          label: `${f.kind === 'live' ? 'Live' : 'Replay'}: Met Office UKV, valid ${json.model.valid ?? '?'}`,
          json,
        });
      } catch {
        // Not available (offline, not deployed yet, or malformed): skip.
      }
    }
    this.weatherSources = found;
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
    try {
      this.view = new SceneView(container, this.sim.params);
    } catch (err) {
      this.webglError = `3D view unavailable: ${(err as Error).message}. The simulation still runs; instruments remain live.`;
    }
    this.view?.setCourse(this.race?.resolved, this.race?.course);
    void this.loadDart();
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

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      const t0 = performance.now();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
        // Keep (light) snapshots of the last two physics states for render interpolation.
        const last = this.accumulator - DT < DT;
        if (last) this.prevSnap = this.sim.snapshot(false);
        this.stepSim();
        this.accumulator -= DT;
        steps++;
        if (last) this.currSnap = this.sim.snapshot(false);
      }
      // Too slow to keep up: drop simulated time rather than spiral.
      if (steps > 0 && this.currSnap.step !== this.sim.step) {
        this.accumulator = 0;
        this.currSnap = this.sim.snapshot(false);
        this.prevSnap = this.currSnap;
      }
      this.physMs = this.physMs * 0.9 + (performance.now() - t0) * 0.1;
      this.renderTime += dt;
    }
    const alpha = this.paused ? 1 : clamp(this.accumulator / DT, 0, 1);
    const info = this.detailSnap.env;
    const sim = this.sim;
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
      course: this.race ? { nextLeg: this.race.judge.legIndex, phase: this.race.judge.phase, showLabels: this.showLabels } : undefined,
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
    this.publish(true);
  }

  setInput(change: Partial<ControlInput>): void {
    this.sim.setInput(change);
    this.publish(true);
  }

  releaseSheets(): void {
    this.sim.setInput({ autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1 });
    this.publish(true);
  }

  centreHelm(): void {
    this.sim.setInput({ helm: 0 });
  }

  togglePause(): void {
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
      case 'KeyR': this.restart(); break;
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
    // One detailed snapshot per publish (10 Hz) feeds the UI and the telemetry.
    this.detailSnap = this.sim.snapshot();
    if (!this.paused) this.recordTelemetry(this.detailSnap);
    this.ui = {
      snapshot: this.detailSnap,
      paused: this.paused,
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
      telemetryVersion: this.telemetry.version,
      dart: { status: this.dartStatus, issues: this.dartData?.issues ?? [] },
      showLabels: this.showLabels,
      showMinimap: this.showMinimap,
      showLayers: this.showLayers,
      showEditor: this.showEditor,
    };
    for (const l of this.listeners) l();
  }

  private raceUi(): RaceUi | undefined {
    const r = this.race;
    if (!r) return undefined;
    const t = this.sim.time;
    const st = r.judge.state(t);
    const leg = r.resolved.legs[st.legIndex];
    const s = this.sim.state;
    const target = leg?.target ?? (st.phase === 'racing' ? { n: (r.resolved.finish[0].n + r.resolved.finish[1].n) / 2, e: (r.resolved.finish[0].e + r.resolved.finish[1].e) / 2 } : undefined);
    return {
      courseName: r.course.name,
      courseStatus: r.course.status,
      phase: st.phase,
      toStart: st.startSignalTime - t,
      nextSignal: st.nextSignal?.name,
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
    };
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): UiState => this.ui;
}

/**
 * Where to put the boat before the start: 100 m behind the start line on the pre-start side and 160 m along it
 * towards the committee-boat end (the second end), heading along the line towards the pin. From there, turning
 * up to close-hauled on starboard crosses the line near its middle.
 */
function preStartPosition(r: ResolvedCourse): { n: number; e: number; headingDeg: number } {
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
  return { n: m.n + nn * 100 + ((b.n - a.n) / len) * along, e: m.e + ne * 100 + ((b.e - a.e) / len) * along, headingDeg: (heading + 360) % 360 };
}
