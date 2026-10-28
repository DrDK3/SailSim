import { clamp, DEG, smoothstep, wrap2Pi, wrapPi } from './math/angles';
import { hashNumbers } from './hash';
import { hypot2 } from './math/hypot';
import { G, RHO_AIR, RHO_WATER, knToMs } from './units';
import { bodyToWorld, effectiveApparent, windFrom, worldToBody, type NE, type SailForce } from './boat/forces';
import {
  aeroHeelMoment,
  autoTrimSheet,
  byTheLeeAngle,
  computeForces,
  derivatives,
  newForceBreakdown,
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
import { FLATTEN, flattenedParams } from './boat/flatten';
import { greenWaterInflow, sprayInflow, stepWater } from './boat/cockpit';
import { DAMAGE, applyImpact, impactEnergy, newDamage, stepBilge, type Damage, type Impact, type ImpactRegion } from './boat/damage';
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
  /**
   * Sails flattened to depower (cunningham, outhaul and kicker on, leech twisted open), 0 = full power …
   * 1 = as flat as the rig allows (src/sim/boat/flatten.ts). Optional so that older replays still load.
   */
  flatten?: number;
}

export const DEFAULT_INPUT: ControlInput = {
  helm: 0,
  mainSheet: 0.3,
  jibSheet: 0.3,
  autoMain: false,
  autoJib: true,
  crewHike: 0.6,
  autoCrew: true,
  flatten: 0,
};

/**
 * The auto main eases when the boat is overpowered, as a helm dumps the main in a gust: beyond this heel, in
 * proportion (full ease 14° further), at a finite rate; and when the rudder is near hard over against weather
 * helm. The heel limit and rates are estimates (E).
 */
export const OVERPOWERED = {
  heel: 24 * DEG,
  easePerRad: 1 / (14 * DEG),
  /** Sheet travel per second. */
  rate: 0.6,
  /** Rudder (fraction of its travel, bearing away) from which the main is eased, and fully eased. */
  helmFrom: 0.7,
  helmFull: 0.95,
  /** Heel below which weather helm alone does not ease the main (light airs: bearing away is just steering). */
  helmHeelFrom: 10 * DEG,
  helmHeelFull: 20 * DEG,
} as const;

/**
 * In a knockdown the crew let the sheets run (part of the crew assist, autoCrew): beyond `release` of heel the
 * sheets run out at `runRate` (sheet travel per second) whatever they were set to, and come back to the trim at
 * `recoverRate` once she is back under `recover`. Without it a boat with cleated sheets lies pinned, or is
 * knocked down again at every turn through a reach in a blow. Angles and rates are estimates (E).
 */
export const KNOCKDOWN = {
  release: 50 * DEG,
  recover: 35 * DEG,
  runRate: 1.5,
  recoverRate: 0.3,
} as const;

/** The extra ease the auto main wants at heel `phi` with the rudder at `rudder` (main on `mainSide`). */
export function overpoweredEaseTarget(phi: number, rudder: number, maxRudder: number, mainSide: 1 | -1): number {
  const o = OVERPOWERED;
  const heel = Math.max(0, Math.abs(phi) - o.heel) * o.easePerRad;
  // Bearing away turns the bow towards the main's side: rudder < 0 with the main to port (starboard tack).
  const bearAway = Math.max(0, (-rudder * mainSide) / maxRudder);
  const helm = smoothstep(o.helmFrom, o.helmFull, bearAway) * smoothstep(o.helmHeelFrom, o.helmHeelFull, Math.abs(phi));
  return clamp(Math.max(heel, helm), 0, 1);
}

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
  /**
   * Keep the input log (default true). A controller that changes the helm every step (AI, autopilot) adds
   * an entry per step, so turn it off for boats whose inputs need not be replayed (AI boats: a race is
   * reproduced from its seed).
   */
  logInputs?: boolean;
}

/** A boom fetching up hard against the sheet or shrouds (e.g. a crash gybe). */
export interface BoomEvent {
  t: number;
  /** Swing rate just before impact (rad/s). */
  rate: number;
}

/**
 * Force from outside the boat's own model (contact with other boats, marks, moored boats, ferries, piers), set
 * by a fleet before each step and held constant over it: world-frame components (N), yaw moment about the CG
 * (N m, > 0 turns the bow to starboard) and roll moment (N m, > 0 heels to starboard: a blow on the topsides
 * above the waterline heels the boat away from it).
 */
export interface ExternalForce {
  n: number;
  e: number;
  yaw: number;
  roll?: number;
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
  /** Where the crew's weight is moving to (m; display: the renderer crouches the sailors only when crossing). */
  crewTo: number;
  /** Water shipped into the cockpit (kg). */
  cockpitWater: number;
  /** Damage so far (hull, rudder, rig, bilge water). */
  damage: Damage;
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
  /** Extra main ease the auto main applies when overpowered (0…1 of the remaining sheet travel). */
  private overEase = 0;
  /** Sheets let run in a knockdown (0 = as trimmed … 1 = fully out), and whether she is knocked down now. */
  private knockEase = 0;
  private knockedDown = false;
  /** How flat the sails are now (0…1): follows `input.flatten` at the crew's pace. */
  private flat = 0;
  readonly ownsEnvironment: boolean;
  readonly seabed?: Seabed;
  readonly logInputs: boolean;
  lastBoomEvent: BoomEvent | null = null;
  /** Damage from collisions and groundings (src/sim/boat/damage.ts), and the impacts so far. */
  readonly damage: Damage = newDamage();
  readonly impacts: Impact[] = [];
  private wasGrounded = false;
  /** Where the crew's weight was last moving to (display only; not part of the state or its hash). */
  private crewTo?: number;
  /** Contact force for the next step (fleet), or null. */
  external: ExternalForce | null = null;
  /** Reused within a step (auto-trim, boom, RK4 stages): forces, stage derivatives and the stage state. */
  private readonly work = {
    forces: newForceBreakdown(),
    k: [0, 1, 2, 3].map((): RigidState => ({ n: 0, e: 0, psi: 0, u: 0, v: 0, r: 0, phi: 0, p: 0 })) as [RigidState, RigidState, RigidState, RigidState],
    stage: { n: 0, e: 0, psi: 0, u: 0, v: 0, r: 0, phi: 0, p: 0 } as RigidState,
  };

  constructor(opts: SimulationOptions) {
    this.params = opts.params;
    this.env = opts.env;
    this.fluids = { rhoAir: opts.fluids?.rhoAir ?? RHO_AIR, rhoWater: opts.fluids?.rhoWater ?? RHO_WATER };
    this.controller = opts.controller;
    this.lockHeading = opts.lockHeading ?? false;
    this.testThrust = opts.testThrust ?? 0;
    this.ownsEnvironment = opts.ownsEnvironment ?? true;
    this.seabed = opts.seabed;
    this.logInputs = opts.logInputs ?? true;
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
    this.act = { rudder: 0, boomMain: 0, boomRate: 0, mainInverted: false, mainSide: 1, boomJib: 0, jibSide: 1, crewY: 0, water: 0, damage: this.damage };
    this.settleActuators();
    this.inputLog.push({ step: 0, input: { ...this.input } });
  }

  /** Place sails, crew and heel at their steady positions for the initial state (no start-up transient). */
  private settleActuators(): void {
    this.flat = clamp(this.input.flatten ?? 0, 0, 1);
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
      this.act.crewY = this.input.autoCrew ? this.autoCrewTarget(this.windHere(), this.currentHere()) : side * this.crewOffset();
      this.state.phi = heelEquilibrium(this.forceParams, this.state, this.act, this.windHere(), this.currentHere(), this.fluids);
    }
  }

  /** Water level (m ODN) at time t: from the environment's tide, else about mean sea level. */
  waterLevel(t = this.time): number {
    return this.env.waterLevel?.(t) ?? DEFAULT_WATER_LEVEL_ODN;
  }

  /** Water level and seabed at time t (one reused record: read it before the next call). */
  private groundAt(t: number): GroundContext | undefined {
    if (!this.seabed) return undefined;
    const g = (this.groundCtx ??= { waterLevel: 0, seabed: this.seabed });
    g.waterLevel = this.waterLevel(t);
    return g;
  }

  private groundCtx?: GroundContext;

  private windHere(): NE {
    return this.env.wind(this.time, this.state.n, this.state.e);
  }

  private currentHere(): NE {
    return this.env.current(this.time, this.state.n, this.state.e);
  }

  private autoCrewTarget(wind: NE, cur: NE): number {
    const p = this.forceParams;
    const m = aeroHeelMoment(p, this.state, this.act, wind, cur, this.fluids, this.state.phi);
    return clamp(-m / (p.crewMass * G * Math.cos(this.state.phi)), -p.crewOut, p.crewOut);
  }

  private crewOffset(): number {
    const p = this.params;
    return p.crewIn + clamp(this.input.crewHike, 0, 1) * (p.crewOut - p.crewIn);
  }

  /** Apparent wind angle seen by the heeled sail plane at the current state (wind and current here, if known). */
  effectiveAwa(wind: NE = this.windHere(), cur: NE = this.currentHere()): number {
    const s = this.state;
    const through = bodyToWorld(s.u, s.v, s.psi);
    const rel = worldToBody(wind.n - through.n - cur.n, wind.e - through.e - cur.e, s.psi);
    return effectiveApparent({ ax: rel.x, ay: rel.y, aws: hypot2(rel.x, rel.y), awa: 0 }, this.state.phi).awa;
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
    const trimmed = sail === 'main'
      ? this.input.autoMain ? this.autoSheet.main + this.overEase * (1 - this.autoSheet.main) : this.input.mainSheet
      : this.input.autoJib ? this.autoSheet.jib : this.input.jibSheet;
    // Let run in a knockdown (KNOCKDOWN).
    return trimmed + this.knockEase * (1 - trimmed);
  }

  /** How far the crew have let the sheets run in a knockdown (0 … 1). */
  get knockdownEase(): number {
    return this.knockEase;
  }

  /** The parameters the forces are computed with: the boat's, with the sails flattened as set now. */
  get forceParams(): BoatParams {
    return flattenedParams(this.params, this.flat);
  }

  /** How flat the sails are now (0 = full power … 1 = fully flattened); follows the flatten input. */
  get flattening(): number {
    return this.flat;
  }

  /** Extra main ease the auto main is applying because the boat is overpowered (0…1). */
  get overpoweredEase(): number {
    return this.overEase;
  }

  /**
   * Auto-trim assist, behaving like a crew watching the telltales: ease when the sail is over-sheeted
   * (incidence above target), trim when it starts to luff (below target). Works on the effective incidence,
   * i.e. including the jib's downwash on the main. Rate: full sheet range in about 3 s.
   */
  private updateAutoTrim(
    dt: number,
    wind: NE = this.windHere(),
    cur: NE = this.currentHere(),
    ground: GroundContext | undefined = this.groundAt(this.time),
  ): ForceBreakdown {
    const f = computeForces(this.forceParams, this.state, this.act, wind, cur, this.fluids, ground, this.work.forces);
    // While the main is eased for a gust, its luff lifts: the assist does not sheet in against that.
    this.autoSheet.main = this.trimmedSheet(this.autoSheet.main, f.main, this.params.main.autoTrimAlpha, dt, this.overEase > 0.02);
    this.autoSheet.jib = this.trimmedSheet(this.autoSheet.jib, f.jib, this.params.jib.autoTrimAlpha, dt);
    return f;
  }

  /** One auto-trim step for a sail: ease when over-sheeted, trim when luffing (unless `holdIn`). */
  private trimmedSheet(sheet: number, sf: SailForce, target: number, dt: number, holdIn = false): number {
    const inc = Math.abs(sf.incidence);
    // Leech-first flow (by the lee) or no wind: let the sheet run.
    let error = inc > Math.PI / 2 || sf.aws < 0.05 ? 1 : (inc - target) / (5 * DEG);
    if (holdIn) error = Math.max(error, 0);
    return clamp(sheet + clamp(error, -1, 1) * (dt / 3), 0, 1);
  }

  /** Change control inputs; takes effect at the next step and is recorded in the input log. */
  setInput(change: Partial<ControlInput>): void {
    if (this.inputUnchanged(change)) return;
    const next = { ...this.input, ...change };
    next.helm = clamp(next.helm, -1, 1);
    next.mainSheet = clamp(next.mainSheet, 0, 1);
    next.jibSheet = clamp(next.jibSheet, 0, 1);
    next.crewHike = clamp(next.crewHike, 0, 1);
    next.flatten = clamp(next.flatten ?? 0, 0, 1);
    const changed = (Object.keys(next) as (keyof ControlInput)[]).some((k) => next[k] !== this.input[k]);
    if (!changed) return;
    this.input = next;
    if (!this.logInputs) return;
    const last = this.inputLog[this.inputLog.length - 1];
    if (last && last.step === this.step) last.input = { ...next };
    else this.inputLog.push({ step: this.step, input: { ...next } });
  }

  /**
   * True when `change` would leave the input as it is (the usual case for a controller called every step):
   * the same test as setInput's, without building the new input. The current values must be in range,
   * since setInput would otherwise clamp them.
   */
  private inputUnchanged(change: Partial<ControlInput>): boolean {
    const cur = this.input;
    if (!(cur.helm >= -1 && cur.helm <= 1 && cur.mainSheet >= 0 && cur.mainSheet <= 1)) return false;
    if (!(cur.jibSheet >= 0 && cur.jibSheet <= 1 && cur.crewHike >= 0 && cur.crewHike <= 1)) return false;
    for (const k in change) {
      const key = k as keyof ControlInput;
      let v = change[key];
      if (key === 'helm') v = clamp(v as number, -1, 1);
      else if (key === 'mainSheet' || key === 'jibSheet' || key === 'crewHike' || key === 'flatten') v = clamp((v as number) ?? 0, 0, 1);
      if (v !== cur[key]) return false;
    }
    return true;
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
    const a = this.act;
    const dt = DT;
    // Wind, current and water level at the boat for this step (the state does not change until integration).
    const wind = this.windHere();
    const cur = this.currentHere();
    const ground = this.groundAt(this.time);

    // Sails flattened or powered up at the crew's pace; the forces this step use the result.
    const flatTarget = clamp(this.input.flatten ?? 0, 0, 1);
    this.flat += clamp(flatTarget - this.flat, -FLATTEN.ratePerS * dt, FLATTEN.ratePerS * dt);
    const p = this.forceParams;

    // Helm: tiller moves at a finite rate towards the demanded angle.
    const rudderTarget = this.input.helm * p.rudder.maxAngle;
    a.rudder += clamp(rudderTarget - a.rudder, -p.rudder.rate * dt, p.rudder.rate * dt);

    // Auto main: eased when overpowered (heel, or weather helm the rudder can barely hold), sheeted back after.
    if (this.input.autoMain) {
      const want = overpoweredEaseTarget(this.state.phi, a.rudder, p.rudder.maxAngle, a.mainSide);
      this.overEase += clamp(want - this.overEase, -OVERPOWERED.rate * dt, OVERPOWERED.rate * dt);
    } else this.overEase = 0;

    // Knocked down: the crew let the sheets run until she comes back up (crew assist only).
    const heelNow = Math.abs(this.state.phi);
    if (this.input.autoCrew) {
      if (heelNow > KNOCKDOWN.release) this.knockedDown = true;
      else if (heelNow < KNOCKDOWN.recover) this.knockedDown = false;
      const want = this.knockedDown ? 1 : 0;
      this.knockEase += clamp(want - this.knockEase, -KNOCKDOWN.recoverRate * dt, KNOCKDOWN.runRate * dt);
    } else {
      this.knockedDown = false;
      this.knockEase = 0;
    }

    const wasInverted = a.mainInverted;
    const trimForces = this.input.autoMain || this.input.autoJib ? this.updateAutoTrim(dt, wind, cur, ground) : undefined;
    const awa = this.effectiveAwa(wind, cur);
    this.computeSheetLimits(awa);

    // Main: a hinged body. By the lee beyond the threshold, a rigid flat sail would still be pressed further
    // out (forward) by wind from astern; the real twisted sail flips and drives the boom across. Model that
    // by reversing the chord-normal force only in that case (when the plain force pushes the boom outwards).
    // The auto-trim's forces were computed from the same state and actuators unless the main was inverted.
    a.mainInverted = false;
    let f = trimForces && !wasInverted ? trimForces : computeForces(p, this.state, a, wind, cur, this.fluids, ground, this.work.forces);
    if (byTheLeeAngle(a.boomMain, awa) > p.main.byTheLee && f.main.boomTorque * a.boomMain > 0) {
      a.mainInverted = true;
      f = computeForces(p, this.state, a, wind, cur, this.fluids, ground, this.work.forces);
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
    const crewTarget = this.input.autoCrew ? this.autoCrewTarget(wind, cur) : a.mainSide * this.crewOffset();
    a.crewY += clamp(crewTarget - a.crewY, -p.crewSpeed * dt, p.crewSpeed * dt);
    this.crewTo = crewTarget;

    // Water over the rail or in spray; out through the transom (self-draining) or bailed.
    a.water = stepWater(p.cockpit, a.water, this.waterInflow(), dt);
    // A leak fills the bilge; the crew pump.
    stepBilge(this.damage, dt);

    this.integrate(dt, wind, cur);
    // Running aground hard (the keel or rudder meeting the bottom at speed) damages her.
    // (Not on the first step: a boat placed aground has not run aground.)
    const contact = this.work.forces.contact;
    const grounded = contact.grounded;
    if (grounded && !this.wasGrounded && this.step > 0) {
      const g = this.work.forces.groundVelocity;
      const speed = Math.hypot(g.n, g.e);
      const stern = contact.points.some((cp) => cp.name === 'stern' && cp.clearance < 0);
      if (speed > DAMAGE.groundingSpeed) this.impact('the bottom', stern ? 'stern' : 'keel', speed, impactEnergy(speed, p.mass));
    }
    this.wasGrounded = grounded;
    this.time = (this.step + 1) * dt;
    this.step += 1;
  }

  /**
   * An impact on the boat (from the fleet's contact, or running aground): damage by its energy and where it
   * struck. Returns what it did, in words (src/sim/boat/damage.ts).
   */
  impact(what: string, region: ImpactRegion, speed: number, energy: number): Impact {
    const ev: Impact = { t: this.time, what, region, speed, energy, effects: applyImpact(this.damage, region, energy) };
    this.impacts.push(ev);
    return ev;
  }

  /**
   * Water coming aboard now (kg/s): green water over the buried rail, and spray when sailing into waves. A
   * self-draining cockpit sheds spray as fast as it arrives, so spray is counted only for the older builds.
   */
  waterInflow(): number {
    const p = this.params;
    let q = greenWaterInflow(p.cockpit, this.state.phi);
    const sea = p.cockpit.selfDraining ? undefined : this.env.seaState?.(this.time, this.state.n, this.state.e);
    if (sea && sea.hs > p.cockpit.sprayStartHs) {
      // Waves travel towards sea.dirTo: head-on when that is opposite the heading.
      q += sprayInflow(p.cockpit, sea.hs, this.state.u, -Math.cos(sea.dirTo - this.state.psi));
    }
    return q;
  }

  /** RK4 over one step; `wind0` and `cur0` are the wind and current at the state at the start of the step. */
  private integrate(dt: number, wind0: NE, cur0: NE): void {
    const s0 = this.state;
    const t0 = this.time;
    const work = this.work;
    const k1 = this.deriv(s0, t0, wind0, cur0, work.k[0]);
    let s = this.stage(s0, k1, dt / 2);
    const k2 = this.deriv(s, t0 + dt / 2, this.env.wind(t0 + dt / 2, s.n, s.e), this.env.current(t0 + dt / 2, s.n, s.e), work.k[1]);
    s = this.stage(s0, k2, dt / 2);
    const k3 = this.deriv(s, t0 + dt / 2, this.env.wind(t0 + dt / 2, s.n, s.e), this.env.current(t0 + dt / 2, s.n, s.e), work.k[2]);
    s = this.stage(s0, k3, dt);
    const k4 = this.deriv(s, t0 + dt, this.env.wind(t0 + dt, s.n, s.e), this.env.current(t0 + dt, s.n, s.e), work.k[3]);
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

  /** Derivative of the rigid state at (s, t) with the actuators held, written into `out`. */
  private deriv(s: RigidState, t: number, wind: NE, cur: NE, out: RigidState): RigidState {
    const p = this.forceParams;
    const f = computeForces(p, s, this.act, wind, cur, this.fluids, this.groundAt(t), this.work.forces);
    if (this.testThrust !== 0) f.total.x += this.testThrust;
    const ext = this.external;
    if (ext) {
      const c = Math.cos(s.psi);
      const sn = Math.sin(s.psi);
      f.total.x += ext.n * c + ext.e * sn;
      f.total.y += -ext.n * sn + ext.e * c;
      f.total.n += ext.yaw;
      if (ext.roll) f.roll.total += ext.roll;
    }
    const d = derivatives(p, s, f, cur, out);
    if (this.lockHeading) {
      d.psi = 0;
      d.r = 0;
    }
    return d;
  }

  /** RK4 stage state s0 + h·k (one reused record, consumed by the next derivative before it is overwritten). */
  private stage(s0: RigidState, k: RigidState, h: number): RigidState {
    const o = this.work.stage;
    o.n = s0.n + k.n * h;
    o.e = s0.e + k.e * h;
    o.psi = s0.psi + k.psi * h;
    o.u = s0.u + k.u * h;
    o.v = s0.v + k.v * h;
    o.r = s0.r + k.r * h;
    o.phi = s0.phi + k.phi * h;
    o.p = s0.p + k.p * h;
    return o;
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
    const forces = computeForces(this.forceParams, s, a, wind, cur, this.fluids, this.groundAt(this.time));
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
      heelEquilibrium: detailed ? heelEquilibrium(this.forceParams, s, a, wind, cur, this.fluids) : NaN,
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
      crewTo: this.crewTo ?? a.crewY,
      cockpitWater: a.water,
      damage: { ...this.damage },
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
    const p = this.forceParams;
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
    const values = [
      this.time, this.step, s.n, s.e, s.psi, s.u, s.v, s.r, s.phi, s.p,
      a.rudder, a.boomMain, a.boomRate, a.mainInverted ? 1 : 0, a.mainSide, a.boomJib, a.jibSide, a.crewY,
    ];
    // Cockpit water joins the hash once there is some (runs that never ship water keep their old hashes);
    // likewise flattened sails and the auto main's gust ease.
    if (a.water !== 0) values.push(a.water);
    if (this.flat !== 0) values.push(this.flat);
    if (this.overEase !== 0) values.push(this.overEase);
    if (this.knockEase !== 0) values.push(this.knockEase);
    return hashNumbers(values);
  }
}
