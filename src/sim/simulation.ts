import { clamp, DEG, wrap2Pi, wrapPi } from './math/angles';
import { hashNumbers } from './hash';
import { G, RHO_AIR, RHO_WATER, knToMs } from './units';
import { bodyToWorld, effectiveApparent, windFrom, worldToBody, type NE } from './boat/forces';
import {
  aeroHeelMoment,
  autoTrimSheet,
  computeForces,
  derivatives,
  heelEquilibrium,
  sailTarget,
  sheetLimit,
  updateSide,
  type Actuators,
  type ForceBreakdown,
  type Fluids,
  type RigidState,
} from './boat/dynamics';
import type { BoatParams } from './boat/params';
import type { Environment } from './env/environment';

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
  heelEquilibrium: number;
  rudder: number;
  boomMain: number;
  boomJib: number;
  mainSide: 1 | -1;
  jibSide: 1 | -1;
  mainSheetLimit: number;
  jibSheetLimit: number;
  crewY: number;
  input: ControlInput;
  forces: ForceBreakdown;
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
  private heelEq = 0;

  constructor(opts: SimulationOptions) {
    this.params = opts.params;
    this.env = opts.env;
    this.fluids = { rhoAir: opts.fluids?.rhoAir ?? RHO_AIR, rhoWater: opts.fluids?.rhoWater ?? RHO_WATER };
    this.controller = opts.controller;
    this.lockHeading = opts.lockHeading ?? false;
    this.testThrust = opts.testThrust ?? 0;
    this.input = { ...DEFAULT_INPUT, ...opts.input };
    this.state = {
      n: opts.initial.n ?? 0,
      e: opts.initial.e ?? 0,
      psi: wrap2Pi(opts.initial.headingDeg * DEG),
      u: knToMs(opts.initial.speedKn ?? 0),
      v: 0,
      r: 0,
    };
    this.act = { rudder: 0, boomMain: 0, boomJib: 0, mainSide: 1, jibSide: 1, heel: 0, crewY: 0 };
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
    this.act.crewY = this.input.autoCrew ? this.autoCrewTarget() : side * this.crewOffset();
    for (let i = 0; i < 3; i++) {
      this.act.heel = heelEquilibrium(this.params, this.state, this.act, this.windHere(), this.currentHere(), this.fluids);
    }
    this.heelEq = this.act.heel;
  }

  private windHere(): NE {
    return this.env.wind(this.time, this.state.n, this.state.e);
  }

  private currentHere(): NE {
    return this.env.current(this.time, this.state.n, this.state.e);
  }

  private autoCrewTarget(): number {
    const p = this.params;
    const m = aeroHeelMoment(p, this.state, this.act, this.windHere(), this.currentHere(), this.fluids, this.act.heel);
    return clamp(-m / (p.crewMass * G * Math.cos(this.act.heel)), -p.crewOut, p.crewOut);
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
    return effectiveApparent({ ax: rel.x, ay: rel.y, aws: Math.hypot(rel.x, rel.y), awa: 0 }, this.act.heel).awa;
  }

  private computeSheetLimits(_awa: number): void {
    const p = this.params;
    this.mainLimit = sheetLimit(p.main, this.currentSheet('main'));
    this.jibLimit = sheetLimit(p.jib, this.currentSheet('jib'));
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
    const f = computeForces(p, this.state, this.act, wind, cur, this.fluids);
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

  /** Advance one fixed step: controller → actuators (explicit) → RK4 on the rigid state. */
  stepOnce(): void {
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

    // Sails: side (tack/gybe) with hysteresis, then sheet limit, then the sail swings towards its target.
    if (this.input.autoMain || this.input.autoJib) this.updateAutoTrim(dt);
    const awa = this.effectiveAwa();
    a.mainSide = updateSide(a.mainSide, awa, p.main.byTheLee);
    a.jibSide = updateSide(a.jibSide, awa, p.jib.byTheLee);
    this.computeSheetLimits(awa);
    const maxStep = p.boomMaxRate * dt;
    a.boomMain += clamp(p.boomGain * (sailTarget(a.mainSide, awa, this.mainLimit) - a.boomMain) * dt, -maxStep, maxStep);
    a.boomJib += clamp(p.boomGain * 2 * (sailTarget(a.jibSide, awa, this.jibLimit) - a.boomJib) * dt, -maxStep, maxStep);

    // Crew: manual = sit to windward (opposite the main) at the chosen hike; auto = move to cancel the
    // heeling moment. Either way they move across at a finite speed.
    const crewTarget = this.input.autoCrew ? this.autoCrewTarget() : a.mainSide * this.crewOffset();
    a.crewY += clamp(crewTarget - a.crewY, -p.crewSpeed * dt, p.crewSpeed * dt);

    // Quasi-static heel with a first-order lag.
    this.heelEq = heelEquilibrium(p, this.state, a, this.windHere(), this.currentHere(), this.fluids);
    a.heel += ((this.heelEq - a.heel) * dt) / p.heelTau;

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
      const f = computeForces(this.params, s, this.act, wind, cur, this.fluids);
      if (this.testThrust !== 0) f.total.x += this.testThrust;
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
    };
  }

  /** Run whole steps covering `seconds` of simulated time. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  snapshot(): BoatSnapshot {
    const s = this.state;
    const a = this.act;
    const wind = this.windHere();
    const cur = this.currentHere();
    const forces = computeForces(this.params, s, a, wind, cur, this.fluids);
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
      heel: a.heel,
      heelEquilibrium: this.heelEq,
      rudder: a.rudder,
      boomMain: a.boomMain,
      boomJib: a.boomJib,
      mainSide: a.mainSide,
      jibSide: a.jibSide,
      mainSheetLimit: this.mainLimit,
      jibSheetLimit: this.jibLimit,
      crewY: a.crewY,
      input: { ...this.input },
      forces,
    };
  }

  /** Bit-exact hash of the full simulation state, for reproducibility checks. */
  stateHash(): string {
    const s = this.state;
    const a = this.act;
    return hashNumbers([
      this.time, this.step, s.n, s.e, s.psi, s.u, s.v, s.r,
      a.rudder, a.boomMain, a.boomJib, a.mainSide, a.jibSide, a.heel, a.crewY,
    ]);
  }
}
