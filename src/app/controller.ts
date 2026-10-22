import { DT, Simulation, type BoatSnapshot, type ControlInput } from '../sim/simulation';
import { squibParams } from '../sim/boat/squib';
import { uniformEnvironment, type UniformConditions } from '../sim/env/environment';
import { clamp } from '../sim/math/angles';
import { optimalSheets } from '../sim/control/trim';
import { CAMERA_MODES, SceneView, type CameraMode } from '../render/scene';

export interface ScenarioSettings extends UniformConditions {
  startHeadingDeg: number;
  startSpeedKn: number;
}

export const DEFAULT_SCENARIO: ScenarioSettings = {
  twsKn: 10,
  twdDeg: 225,
  currentSetDeg: 0,
  currentRateKn: 0,
  startHeadingDeg: 140,
  startSpeedKn: 3,
};

export interface UiState {
  snapshot: BoatSnapshot;
  paused: boolean;
  camera: CameraMode;
  showForces: boolean;
  showDebug: boolean;
  showHelp: boolean;
  scenario: ScenarioSettings;
  envLabel: string;
  fps: number;
  physicsMsPerFrame: number;
  webglError?: string;
}

type Listener = () => void;

/** Helm and sheet rates for held keys/buttons (fraction of full travel per second). */
const HELM_RATE = 1.4;
const HELM_RETURN = 1.8;
const SHEET_RATE = 0.35;
const MAX_STEPS_PER_FRAME = 12;

/**
 * Owns the simulation and the render loop. Inputs (keys, buttons) are sampled once per physics step so
 * runs are reproducible from the input log. Publishes a UI snapshot ~10 times a second.
 */
export class SimController {
  sim!: Simulation;
  private view?: SceneView;
  private prevSnap!: BoatSnapshot;
  private currSnap!: BoatSnapshot;
  private accumulator = 0;
  private lastFrame = 0;
  private renderTime = 0;
  private raf = 0;
  private paused = false;
  private held = new Set<string>();
  private listeners = new Set<Listener>();
  private ui!: UiState;
  private lastPublish = 0;
  private frames = 0;
  private fpsT0 = 0;
  private fps = 0;
  private physMs = 0;
  scenario: ScenarioSettings = { ...DEFAULT_SCENARIO };
  private showForces = false;
  private showDebug = false;
  private showHelp = false;
  private webglError?: string;

  constructor() {
    this.restart();
  }

  // ------------------------------------------------------------ lifecycle

  restart(scenario: ScenarioSettings = this.scenario): void {
    this.scenario = { ...scenario };
    const prevInput = this.sim?.input;
    this.sim = new Simulation({
      params: squibParams(),
      env: uniformEnvironment(this.scenario),
      initial: { headingDeg: this.scenario.startHeadingDeg, speedKn: this.scenario.startSpeedKn },
      input: prevInput ? { ...prevInput, helm: 0 } : undefined,
      controller: () => this.sampleInputs(),
    });
    // Start with sensible manual sheet settings for the starting point of sail.
    if (!prevInput) this.sim.setInput(optimalSheets(this.sim));
    this.currSnap = this.sim.snapshot();
    this.prevSnap = this.currSnap;
    this.accumulator = 0;
    this.publish(true);
  }

  attach(container: HTMLElement): void {
    try {
      this.view = new SceneView(container, this.sim.params);
    } catch (err) {
      this.webglError = `3D view unavailable: ${(err as Error).message}. The simulation still runs; instruments remain live.`;
    }
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
        // Keep snapshots of the last two physics states for render interpolation.
        const last = this.accumulator - DT < DT;
        if (last) this.prevSnap = this.sim.snapshot();
        this.sim.stepOnce();
        this.accumulator -= DT;
        steps++;
        if (last) this.currSnap = this.sim.snapshot();
      }
      // Too slow to keep up: drop simulated time rather than spiral.
      if (steps > 0 && this.currSnap.step !== this.sim.step) {
        this.accumulator = 0;
        this.currSnap = this.sim.snapshot();
        this.prevSnap = this.currSnap;
      }
      this.physMs = this.physMs * 0.9 + (performance.now() - t0) * 0.1;
      this.renderTime += dt;
    }
    const alpha = this.paused ? 1 : clamp(this.accumulator / DT, 0, 1);
    this.view?.render(this.prevSnap, this.currSnap, alpha, this.renderTime, dt);
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
    this.sim.advance(seconds);
    this.currSnap = this.sim.snapshot();
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
      case 'KeyH': case 'Slash': this.toggleHelp(); break;
      case 'Escape': this.toggleHelp(false); break;
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

  private publish(force = false): void {
    if (!force && performance.now() - this.lastPublish < 100) return;
    this.lastPublish = performance.now();
    this.ui = {
      snapshot: this.paused ? this.sim.snapshot() : this.currSnap,
      paused: this.paused,
      camera: this.view?.cameraMode ?? 'chase',
      showForces: this.showForces,
      showDebug: this.showDebug,
      showHelp: this.showHelp,
      scenario: this.scenario,
      envLabel: this.sim.env.label,
      fps: this.fps,
      physicsMsPerFrame: this.physMs,
      webglError: this.webglError,
    };
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): UiState => this.ui;
}
