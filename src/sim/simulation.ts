import { clamp, DEG, wrap2Pi, wrapPi } from './math/angles';
import { hashNumbers } from './hash';
import { G, RHO_AIR, RHO_WATER, knToMs } from './units';
import { bodyToWorld, effectiveApparent, windFrom, worldToBody, type NE } from './boat/forces';
import {
  aeroHeelMoment,
  autoTrimSheet,
  byTheLeeAngle,
  computeForces,
  derivatives,
  heelEquilibrium,
  sailTarget,
  sheetLimit,
  stepBoom,
  updateSide,
  type Actuators,
  type ForceBreakdown,
  type Fluids,
  type RigidState,
} from './boat/dynamics';
import type { BoatParams } from './boat/params';
import type { ContactPointState, GroundContext } from './boat/contact';
import type { Seabed } from './geo/dart';
import type { Environment, EnvironmentInfo } from './env/environment';

/** Water level used with a seabed when the environment has no tide (m ODN): about mean sea level (E). */
export const DEFAULT_WATER_LEVEL_ODN = 0.1;

/** Fixed physics timestep (s). */
export const DT = 0.01;

export interface ControlInput {
  /** Helm demand, -1 (full to port) … +1 (full to starboard). Positive turns the bow to starboard. */
  helm: number;
  /** Mainsheet, 0 = hard in … 1 = fully eased. Ignored when autoMain is on. */
  mainSheet: number;
  /** Jib sheet, 0 = hard in … 1 = fully eased. Ignored when autoJib is on. */
  jibSheet: number;
  /** Assist: trim the main to the target incidence automatically. */
  autoMain: boolean;
  /** Assist: trim the jib to the target incidence automatically. */
  autoJib: boolean;
  /** Crew weight out to windward, 0 = sitting inboard … 1 = sitting out. Ignored when autoCrew is on. */
  crewHike: number;
  /** Assist: crew move athwartships to keep the boat near upright (either side, within the cockpit). */
  autoCrew: boolean;
}

export const DEFAULT_INPUT: ControlInput = {
  helm: 0,
  mainSheet: 0.3,
  jibSheet: 0.3,
  autoMain: false,
  autoJib: true,
  crewHike: 0.6,
  autoCrew: true,
};

export interface InitialConditions {
  n?: number;
  e?: number;
  headingDeg: number;
  speedKn?: number;
}

export interface SimulationOptions {
  params: BoatParams;
  env: Environment;
  initial: InitialConditions;
  input?: Partial<ControlInput>;
  fluids?: Partial<Fluids>;
  /** Called at the start of every step; may return input changes (autopilot, scripted tests, AI). */
  controller?: (sim: Simulation) => Partial<ControlInput> | void;
  /**
   * Test rig only: hold the heading fixed (yaw rate forced to zero) while surge and sway stay free, like a
   * captive towing-tank test. Never used in normal sailing.
   */
  lockHeading?: boolean;
  /** Test rig only: constant forward (surge) force in newtons, e.g. to tow the boat at a set speed. */
  testThrust?: number;
  /**
   * Whether this simulation advances the environment's own state (gusts, shifts) each step. Set false when
   * several boats share one environment and a race manager steps it once per tick.
   */
  ownsEnvironment?: boolean;
  /** Bottom elevation for grounding (the River Dart data). Without it the water is bottomless. */
  seabed?: Seabed;
}

/** A boom fetching up hard against the sheet or shrouds (e.g. a crash gybe). */
export interface BoomEvent {
  t: number;
  /** Swing rate just before impact (rad/s). */
  rate: number;
}

/**
 * Force from outside the boat's own model (contact with other boats, marks or moored boats), set by a fleet
 * before each step and held constant over it: world-frame components (N) and yaw moment about the CG (N m,
 * > 0 turns the bow to starboard). It acts in the horizontal plane only (no roll moment).
 */
export interface ExternalForce {
  n: number;
  e: number;
  yaw: number;
}

export interface InputLogEntry {
  step: number;
  input: ControlInput;
}

/** Everything the UI, tests and scenario runner need about the boat at one instant. SI units. */
export interface BoatSnapshot {
  t: number;
  step: number;
  n: number;
  e: number;
  heading: number;
  u: number;
  v: number;
  r: number;
  stw: number;
  sog: number;
  cog: number;
  leeway: number;
  /** True wind relative to the water (what boat instruments show). */
  tws: number;
  twd: number;
  twa: number;
  /** True wind over the ground. */
  twsGround: number;
  twdGround: number;
  aws: number;
  awa: number;
  awaEffective: number;
  vmg: number;
  current: NE;
  heel: number;
  rollRate: number;
  heelEquilibrium: number;
  /**
   * Rudder angle that would give zero yaw moment at this instant (rad), expressed as helm balance:
   * > 0 = weather helm (rudder needed to bear away), < 0 = lee helm.
   */
  helmBalance: number;
  rudder: number;
  boomRate: number;
  mainInverted: boolean;
  lastBoomEvent: BoomEvent | null;
  boomMain: number;
  boomJib: number;
  mainSide: 1 | -1;
  jibSide: 1 | -1;
  mainSheetLimit: number;
  jibSheetLimit: number;
  crewY: number;
  input: ControlInput;
  forces: ForceBreakdown;
  /** Conditions here: sources, tide, flags (when the environment can describe itself). */
  env?: EnvironmentInfo;
  /** Water level (m ODN) and, with a seabed, the water depth at the keel and the bottom contact state. */
  waterLevel: number;
  depthAtKeel: number;
  grounded: boolean;
  contactPoints: ContactPointState[];
}

export class Simulation {
  readonly params: BoatParams;
  env: Environment;
  readonly fluids: Fluids;
  state: RigidState;
  act: Actuators;
  time = 0;
  step = 0;
  input: ControlInput;
  readonly inputLog: InputLogEntry[] = [];
  controller?: (sim: Simulation) => Partial<ControlInput> | void;
  readonly lockHeading: boolean;
  readonly testThrust: number;
  private mainLimit = 0;
  private jibLimit = 0;
  /** Sheet positions chosen by the auto-trim assist (used only when autoMain/autoJib are on). */
  private autoSheet = { main: 0.3, jib: 0.3 };
  readonly ownsEnvironment: boolean;
  readonly seabed?: Seabed;
  lastBoomEvent: BoomEvent | null = null;
  /** Contact force for the next step (fleet), or null. */
  external: ExternalForce | null = null;

  constructor(opts: SimulationOptions) {
    this.params = opts.params;
    this.env = opts.env;
    this.fluids = { rhoAir: opts.fluids?.rhoAir ?? RHO_AIR, rhoWater: opts.fluids?.rhoWater ?? RHO_WATER };
    this.controller = opts.controller;
    this.lockHeading = opts.lockHeading ?? false;
    this.testThrust = opts.testThrust ?? 0;
    this.ownsEnvironment = opts.ownsEnvironment ?? true;
    this.seabed = opts.seabed;
    this.input = { ...DEFAULT_INPUT, ...opts.input };
    this.state = {
      n: opts.initial.n ?? 0,
      e: opts.initial.e ?? 0,
      psi: wrap2Pi(opts.initial.headingDeg * DEG),
      u: knToMs(opts.initial.speedKn ?? 0),
      v: 0,
      r: 0,
      phi: 0,
      p: 0,
    };
    this.act = { rudder: 0, boomMain: 0, boomRate: 0, mainInverted: false, mainSide: 1, boomJib: 0, jibSide: 1, crewY: 0 };
    this.settleActuators();
    this.inputLog.push({ step: 0, input: { ...this.input } });
  }

  /** Place sails, crew and heel at their steady positions for the initial state (no start-up transient). */
  private settleActuators(): void {
    const awa = this.effectiveAwa();
    const side: 1 | -1 = awa >= 0 ? 1 : -1;
    this.act.mainSide = side;
    this.act.jibSide = side;
    this.autoSheet = { main: autoTrimSheet(this.params.main, awa), jib: autoTrimSheet(this.params.jib, awa) };
    for (let i = 0; i < 300; i++) {
      this.computeSheetLimits(awa);
      this.act.boomMain = sailTarget(side, awa, this.mainLimit);
      this.act.boomJib = sailTarget(side, awa, this.jibLimit);
      this.updateAutoTrim(0.05);
    }
    this.computeSheetLimits(awa);
    this.act.boomMain = sailTarget(side, awa, this.mainLimit);
    this.act.boomJib = sailTarget(side, awa, this.jibLimit);
    for (let i = 0; i < 3; i++) {
      this.act.crewY = this.input.autoCrew ? this.autoCrewTarget() : side * this.crewOffset();
      this.state.phi = heelEquilibrium(this.params, this.state, this.act, this.windHere(), this.currentHere(), this.fluids);
    }
  }

  /** Water level (m ODN) at time t: from the environment's tide, else about mean sea level. */
  waterLevel(t = this.time): number {
    return this.env.waterLevel?.(t) ?? DEFAULT_WATER_LEVEL_ODN;
  }

  private groundAt(t: number): GroundContext | undefined {
    return this.seabed ? { waterLevel: this.waterLevel(t), seabed: this.seabed } : undefined;
  }

  private windHere(): NE {
    return this.env.wind(this.time, this.state.n, this.state.e);
  }

  private currentHere(): NE {
    return this.env.current(this.time, this.state.n, this.state.e);
  }

  private autoCrewTarget(): number {
    const p = this.params;
    const m = aeroHeelMoment(p, this.state, this.act, this.windHere(), this.currentHere(), this.fluids, this.state.phi);
    return clamp(-m / (p.crewMass * G * Math.cos(this.state.phi)), -p.crewOut, p.crewOut);
  }

  private crewOffset(): number {
    const p = this.params;
    return p.crewIn + clamp(this.input.crewHike, 0, 1) * (p.crewOut - p.crewIn);
  }

  /** Apparent wind angle seen by the heeled sail plane at the current state. */
  effectiveAwa(): number {
    const s = this.state;
    const through = bodyToWorld(s.u, s.v, s.psi);
    const cur = this.currentHere();
    const wind = this.windHere();
    const rel = worldToBody(wind.n - through.n - cur.n, wind.e - through.e - cur.e, s.psi);
    return effectiveApparent({ ax: rel.x, ay: rel.y, aws: Math.hypot(rel.x, rel.y), awa: 0 }, this.state.phi).awa;
  }

  private computeSheetLimits(_awa: number): void {
    const p = this.params;
    this.mainLimit = sheetLimit(p.main, this.currentSheet('main'));
    this.jibLimit = sheetLimit(p.jib, this.currentSheet('jib'));
  }

  /** The auto-trim assist's current choice for a sail (kept up to date while either assist is on). */
  autoSheetValue(sail: 'main' | 'jib'): number {
    return this.autoSheet[sail];
  }

  /** Sheet actually in use for a sail: the assist's choice when auto-trim is on, otherwise the input. */
  currentSheet(sail: 'main' | 'jib'): number {
    if (sail === 'main') return this.input.autoMain ? this.autoSheet.main : this.input.mainSheet;
    return this.input.autoJib ? this.autoSheet.jib : this.input.jibSheet;
  }

  /**
   * Auto-trim assist, behaving like a crew watching the telltales: ease when the sail is over-sheeted
   * (incidence above target), trim when it starts to luff (below target). Works on the effective incidence,
   * i.e. including the jib's downwash on the main. Rate: full sheet range in about 3 s.
   */
  private updateAutoTrim(dt: number): void {
    const p = this.params;
    const wind = this.windHere();
    const cur = this.currentHere();
    const f = computeForces(p, this.state, this.act, wind, cur, this.fluids, this.groundAt(this.time));
    const step = (sail: 'main' | 'jib'): void => {
      const sf = sail === 'main' ? f.main : f.jib;
      const target = p[sail].autoTrimAlpha;
      const inc = Math.abs(sf.incidence);
      // Leech-first flow (by the lee) or no wind: let the sheet run.
      const error = inc > Math.PI / 2 || sf.aws < 0.05 ? 1 : (inc - target) / (5 * DEG);
      this.autoSheet[sail] = clamp(this.autoSheet[sail] + clamp(error, -1, 1) * (dt / 3), 0, 1);
    };
    step('main');
    step('jib');
  }

  /** Change control inputs; takes effect at the next step and is recorded in the input log. */
  setInput(change: Partial<ControlInput>): void {
    const next = { ...this.input, ...change };
    next.helm = clamp(next.helm, -1, 1);
    next.mainSheet = clamp(next.mainSheet, 0, 1);
    next.jibSheet = clamp(next.jibSheet, 0, 1);
    next.crewHike = clamp(next.crewHike, 0, 1);
    const changed = (Object.keys(next) as (keyof ControlInput)[]).some((k) => next[k] !== this.input[k]);
    if (!changed) return;
    this.input = next;
    const last = this.inputLog[this.inputLog.length - 1];
    if (last && last.step === this.step) last.input = { ...next };
    else this.inputLog.push({ step: this.step, input: { ...next } });
  }

  /**
   * Advance one fixed step: environment → controller → actuators and sails (explicit, from the state at the
   * start of the step) → RK4 on the 4-DOF rigid state with actuators held.
   */
  stepOnce(): void {
    if (this.ownsEnvironment) this.env.step?.(this.time, DT);
    if (this.controller) {
      const change = this.controller(this);
      if (change) this.setInput(change);
    }
    const p = this.params;
    const a = this.act;
    const dt = DT;

    // Helm: tiller moves at a finite rate towards the demanded angle.
    const rudderTarget = this.input.helm * p.rudder.maxAngle;
    a.rudder += clamp(rudderTarget - a.rudder, -p.rudder.rate * dt, p.rudder.rate * dt);

    if (this.input.autoMain || this.input.autoJib) this.updateAutoTrim(dt);
    const awa = this.effectiveAwa();
    this.computeSheetLimits(awa);

    // Main: a hinged body. By the lee beyond the threshold, a rigid flat sail would still be pressed further
    // out (forward) by wind from astern; the real twisted sail flips and drives the boom across. Model that
    // by reversing the chord-normal force only in that case (when the plain force pushes the boom outwards).
    a.mainInverted = false;
    let f = computeForces(p, this.state, a, this.windHere(), this.currentHere(), this.fluids, this.groundAt(this.time));
    if (byTheLeeAngle(a.boomMain, awa) > p.main.byTheLee && f.main.boomTorque * a.boomMain > 0) {
      a.mainInverted = true;
      f = computeForces(p, this.state, a, this.windHere(), this.currentHere(), this.fluids, this.groundAt(this.time));
    }
    const boom = stepBoom(p, a.boomMain, a.boomRate, f.main.boomTorque, this.state.phi, this.mainLimit, dt);
    if (boom.fetchedUp && Math.abs(a.boomRate) > 1.0) this.lastBoomEvent = { t: this.time, rate: a.boomRate };
    a.boomMain = boom.boom;
    a.boomRate = boom.rate;
    if (a.boomMain > 0.5 * DEG) a.mainSide = 1;
    else if (a.boomMain < -0.5 * DEG) a.mainSide = -1;

    // Jib: kinematic (it changes side quickly through the foretriangle), sheet-limited.
    a.jibSide = updateSide(a.jibSide, awa, p.jib.byTheLee);
    const maxStep = p.boomMaxRate * dt;
    a.boomJib += clamp(p.boomGain * 2 * (sailTarget(a.jibSide, awa, this.jibLimit) - a.boomJib) * dt, -maxStep, maxStep);

    // Crew: manual = sit to windward (opposite the main) at the chosen hike; auto = move to cancel the
    // heeling moment. Either way they move across at a finite speed.
    const crewTarget = this.input.autoCrew ? this.autoCrewTarget() : a.mainSide * this.crewOffset();
    a.crewY += clamp(crewTarget - a.crewY, -p.crewSpeed * dt, p.crewSpeed * dt);

    this.integrate(dt);
    this.time = (this.step + 1) * dt;
    this.step += 1;
  }

  private integrate(dt: number): void {
    const s0 = this.state;
    const t0 = this.time;
    const deriv = (s: RigidState, t: number): RigidState => {
      const wind = this.env.wind(t, s.n, s.e);
      const cur = this.env.current(t, s.n, s.e);
      const f = computeForces(this.params, s, this.act, wind, cur, this.fluids, this.groundAt(t));
      if (this.testThrust !== 0) f.total.x += this.testThrust;
      const ext = this.external;
      if (ext) {
        const c = Math.cos(s.psi);
        const sn = Math.sin(s.psi);
        f.total.x += ext.n * c + ext.e * sn;
        f.total.y += -ext.n * sn + ext.e * c;
        f.total.n += ext.yaw;
      }
      const d = derivatives(this.params, s, f, cur);
      if (this.lockHeading) {
        d.psi = 0;
        d.r = 0;
      }
      return d;
    };
    const add = (s: RigidState, k: RigidState, h: number): RigidState => ({
      n: s.n + k.n * h,
      e: s.e + k.e * h,
      psi: s.psi + k.psi * h,
      u: s.u + k.u * h,
      v: s.v + k.v * h,
      r: s.r + k.r * h,
      phi: s.phi + k.phi * h,
      p: s.p + k.p * h,
    });
    const k1 = deriv(s0, t0);
    const k2 = deriv(add(s0, k1, dt / 2), t0 + dt / 2);
    const k3 = deriv(add(s0, k2, dt / 2), t0 + dt / 2);
    const k4 = deriv(add(s0, k3, dt), t0 + dt);
    const w = dt / 6;
    this.state = {
      n: s0.n + w * (k1.n + 2 * k2.n + 2 * k3.n + k4.n),
      e: s0.e + w * (k1.e + 2 * k2.e + 2 * k3.e + k4.e),
      psi: wrap2Pi(s0.psi + w * (k1.psi + 2 * k2.psi + 2 * k3.psi + k4.psi)),
      u: s0.u + w * (k1.u + 2 * k2.u + 2 * k3.u + k4.u),
      v: s0.v + w * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
      r: s0.r + w * (k1.r + 2 * k2.r + 2 * k3.r + k4.r),
      phi: s0.phi + w * (k1.phi + 2 * k2.phi + 2 * k3.phi + k4.phi),
      p: s0.p + w * (k1.p + 2 * k2.p + 2 * k3.p + k4.p),
    };
  }

  /** Run whole steps covering `seconds` of simulated time. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  /**
   * Full state for UI, tests and logging. `detailed = false` skips the costlier diagnostics (static heel
   * equilibrium, helm balance, environment description), which are then NaN/undefined; the renderer uses
   * that every frame.
   */
  snapshot(detailed = true): BoatSnapshot {
    const s = this.state;
    const a = this.act;
    const wind = this.windHere();
    const cur = this.currentHere();
    const forces = computeForces(this.params, s, a, wind, cur, this.fluids, this.groundAt(this.time));
    const ground = forces.groundVelocity;
    const windOverWater = { n: wind.n - cur.n, e: wind.e - cur.e };
    const ww = windFrom(windOverWater);
    const wg = windFrom(wind);
    const stw = Math.hypot(s.u, s.v);
    const twa = wrapPi(ww.fromDir - s.psi);
    const through = bodyToWorld(s.u, s.v, s.psi);
    const vmg = ww.speed > 1e-9 ? -(through.n * windOverWater.n + through.e * windOverWater.e) / ww.speed : 0;
    return {
      t: this.time,
      step: this.step,
      n: s.n,
      e: s.e,
      heading: s.psi,
      u: s.u,
      v: s.v,
      r: s.r,
      stw,
      sog: Math.hypot(ground.n, ground.e),
      cog: wrap2Pi(Math.atan2(ground.e, ground.n)),
      leeway: stw > 1e-6 ? Math.atan2(s.v, s.u) : 0,
      tws: ww.speed,
      twd: ww.fromDir,
      twa,
      twsGround: wg.speed,
      twdGround: wg.fromDir,
      aws: forces.aw.aws,
      awa: forces.aw.awa,
      awaEffective: forces.main.aws > 0 ? forces.main.awa : forces.aw.awa,
      vmg,
      current: cur,
      heel: s.phi,
      rollRate: s.p,
      heelEquilibrium: detailed ? heelEquilibrium(this.params, s, a, wind, cur, this.fluids) : NaN,
      helmBalance: detailed ? this.helmBalance(forces.aw.awa) : NaN,
      rudder: a.rudder,
      boomRate: a.boomRate,
      mainInverted: a.mainInverted,
      lastBoomEvent: this.lastBoomEvent,
      boomMain: a.boomMain,
      boomJib: a.boomJib,
      mainSide: a.mainSide,
      jibSide: a.jibSide,
      mainSheetLimit: this.mainLimit,
      jibSheetLimit: this.jibLimit,
      crewY: a.crewY,
      input: { ...this.input },
      forces,
      env: detailed ? this.env.describe?.(this.time, s.n, s.e) : undefined,
      waterLevel: this.waterLevel(),
      depthAtKeel: forces.contact.depthAtKeel,
      grounded: forces.contact.grounded,
      contactPoints: forces.contact.points,
    };
  }

  /**
   * Rudder angle giving zero yaw moment at the current state (bisection), as helm balance: > 0 weather helm.
   * Returns NaN when no balancing angle exists within the rudder's travel.
   */
  private helmBalance(awa: number): number {
    const p = this.params;
    const wind = this.windHere();
    const cur = this.currentHere();
    const yaw = (d: number) => computeForces(p, this.state, { ...this.act, rudder: d }, wind, cur, this.fluids, this.groundAt(this.time)).total.n;
    let lo = -p.rudder.maxAngle;
    let hi = p.rudder.maxAngle;
    const flo = yaw(lo);
    const fhi = yaw(hi);
    if (Math.sign(flo) === Math.sign(fhi)) return NaN;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (Math.sign(yaw(mid)) === Math.sign(flo)) lo = mid;
      else hi = mid;
    }
    const delta = (lo + hi) / 2;
    return awa >= 0 ? -delta : delta;
  }

  /** Bit-exact hash of the full simulation state, for reproducibility checks. */
  stateHash(): string {
    const s = this.state;
    const a = this.act;
    return hashNumbers([
      this.time, this.step, s.n, s.e, s.psi, s.u, s.v, s.r, s.phi, s.p,
      a.rudder, a.boomMain, a.boomRate, a.mainInverted ? 1 : 0, a.mainSide, a.boomJib, a.jibSide, a.crewY,
    ]);
  }
}
