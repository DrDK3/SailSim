import { clamp } from '../math/angles';
import { interpTable } from '../math/interp';
import { G } from '../units';
import {
  apparentWind,
  bodyToWorld,
  effectiveApparent,
  foilForce,
  hullCrossFlow,
  hullResistance,
  sailPairForces,
  windageForce,
  type ApparentWind,
  type BodyForce,
  type FoilForce,
  type HullResistance,
  type NE,
  type SailForce,
} from './forces';
import type { BoatParams, SailParams } from './params';
import { groundContact, NO_CONTACT, type ContactForce, type GroundContext } from './contact';

/**
 * Continuous state integrated by RK4 (4-DOF: surge, sway, yaw, roll). Velocities are through the water, in
 * the body frame. phi = heel (> 0 to starboard), p = roll rate.
 */
export interface RigidState {
  n: number;
  e: number;
  psi: number;
  u: number;
  v: number;
  r: number;
  phi: number;
  p: number;
}

/**
 * Actuator and sail states, updated once per fixed step (held constant within the step).
 * The main boom is a dynamic body (angle + rate); the jib is kinematic.
 */
export interface Actuators {
  rudder: number;
  boomMain: number;
  boomRate: number;
  /** The mainsail has inverted by the lee and is driving the boom across. */
  mainInverted: boolean;
  /** Side the main is set on, derived from the boom angle (+1 = to port, starboard tack). */
  mainSide: 1 | -1;
  boomJib: number;
  jibSide: 1 | -1;
  crewY: number;
}

export interface Fluids {
  rhoAir: number;
  rhoWater: number;
}

export interface ForceBreakdown {
  aw: ApparentWind;
  groundVelocity: NE;
  main: SailForce;
  jib: SailForce;
  jibEffectiveness: number;
  windage: BodyForce;
  lateral: FoilForce;
  rudder: FoilForce;
  hull: HullResistance;
  crossFlow: BodyForce;
  yawDamping: number;
  /** Bottom contact (grounding); NO_CONTACT without a seabed. */
  contact: ContactForce;
  /** Roll moments (N m, > 0 heels to starboard). */
  roll: { sails: number; hydro: number; crew: number; righting: number; damping: number; ground: number; total: number };
  total: BodyForce;
}

/** Righting arm GZ(φ) (m), odd in φ, from the calibration table. */
export function rightingArm(p: BoatParams, phi: number): number {
  return Math.sign(phi) * interpTable(p.gz, Math.abs(phi));
}

/** An empty force breakdown, to pass to computeForces as `out` and reuse step after step. */
export function newForceBreakdown(): ForceBreakdown {
  const sail = (): SailForce => ({ x: 0, y: 0, yPlane: 0, n: 0, incidence: 0, cl: 0, cd: 0, luff: 0, stall: 0, ceX: 0, ceY: 0, aws: 0, awa: 0, boomTorque: 0 });
  const foil = (): FoilForce => ({ x: 0, y: 0, yPlane: 0, n: 0, alpha: 0, cl: 0, cd: 0, speed: 0 });
  return {
    aw: { ax: 0, ay: 0, aws: 0, awa: 0 },
    groundVelocity: { n: 0, e: 0 },
    main: sail(),
    jib: sail(),
    jibEffectiveness: 0,
    windage: { x: 0, y: 0, n: 0 },
    lateral: foil(),
    rudder: foil(),
    hull: { friction: 0, residuary: 0, total: 0, froude: 0, x: 0 },
    crossFlow: { x: 0, y: 0, n: 0 },
    yawDamping: 0,
    contact: { ...NO_CONTACT, points: [] },
    roll: { sails: 0, hydro: 0, crew: 0, righting: 0, damping: 0, ground: 0, total: 0 },
    total: { x: 0, y: 0, n: 0 },
  };
}

// Sail motion records, read straight away by the sail force functions.
const MAIN_MOTION = { rollRate: 0, yawRate: 0, boomRate: 0 };
const JIB_MOTION = { rollRate: 0, yawRate: 0, boomRate: 0 };

/**
 * All forces and moments at a state. With `out` (from newForceBreakdown, never shared between two callers
 * that keep results), the result is written into it instead of new objects: the hot path allocates nothing.
 */
export function computeForces(
  p: BoatParams,
  s: RigidState,
  a: Actuators,
  wind: NE,
  current: NE,
  fluids: Fluids,
  ground?: GroundContext,
  out?: ForceBreakdown,
): ForceBreakdown {
  const o = out ?? newForceBreakdown();
  const c = Math.cos(s.psi);
  const sn = Math.sin(s.psi);
  // Velocity over the ground: through the water (body → world), plus the current.
  const groundVelocity = o.groundVelocity;
  groundVelocity.n = s.u * c - s.v * sn + current.n;
  groundVelocity.e = s.u * sn + s.v * c + current.e;
  const aw = apparentWind(wind, groundVelocity, s.psi, o.aw);
  MAIN_MOTION.rollRate = JIB_MOTION.rollRate = s.p;
  MAIN_MOTION.yawRate = JIB_MOTION.yawRate = s.r;
  MAIN_MOTION.boomRate = a.boomRate;
  JIB_MOTION.boomRate = 0;
  const { main, jib } = sailPairForces(p, a.boomMain, a.boomJib, aw, s.phi, fluids.rhoAir, MAIN_MOTION, JIB_MOTION, a.mainInverted, o);
  const windage = windageForce(p, aw, s.phi, fluids.rhoAir, o.windage);
  // Local sway at each foil: yaw (r·x) and roll (the keel swings opposite to the mast: −p·depth).
  const lateral = foilForce(p.lateral, s.u, s.v + s.r * p.lateral.x - s.p * p.clrDepth, 0, s.phi, fluids.rhoWater, o.lateral);
  // The keel's downwash straightens the flow reaching the rudder: only part of the hull's leeway remains.
  const rudderSway = s.v * (1 - p.rudder.flowStraightening) + s.r * p.rudder.x - s.p * p.rudderDepth;
  const rudder = foilForce(p.rudder, s.u, rudderSway, a.rudder, s.phi, fluids.rhoWater, o.rudder);
  const hull = hullResistance(p, s.u, s.phi, fluids.rhoWater, o.hull);
  const crossFlow = hullCrossFlow(p, s.v, s.r, fluids.rhoWater, o.crossFlow);
  const yawDamping = -p.yawLinearDamping * s.r;
  o.yawDamping = yawDamping;
  let contact: ContactForce = NO_CONTACT;
  if (ground) contact = groundContact(p, s, current, ground, out ? o.contact : undefined);
  else if (out) {
    // No seabed: the reused record holds NO_CONTACT's values (never NO_CONTACT itself, which is shared).
    contact = o.contact;
    contact.x = contact.y = contact.n = contact.roll = 0;
    contact.grounded = false;
    contact.depthAtKeel = Infinity;
    contact.points.length = 0;
  }
  o.contact = contact;
  const total = o.total;
  total.x = main.x + jib.x + windage.x + lateral.x + rudder.x + hull.x + contact.x;
  total.y = main.y + jib.y + windage.y + lateral.y + rudder.y + crossFlow.y + contact.y;
  total.n = main.n + jib.n + windage.n + lateral.n + rudder.n + crossFlow.n + yawDamping + contact.n;
  // Roll about the waterline: sail-plane side forces act above it, keel and rudder forces below it.
  const r = o.roll;
  r.sails = main.yPlane * p.main.ceHeight + jib.yPlane * p.jib.ceHeight + windage.y * p.windageHeight;
  r.hydro = -lateral.yPlane * p.clrDepth - rudder.yPlane * p.rudderDepth;
  r.crew = p.crewMass * G * a.crewY * Math.cos(s.phi);
  r.righting = -p.weight * rightingArm(p, s.phi);
  r.damping = -p.rollLinearDamping * s.p;
  r.ground = contact.roll;
  r.total = r.sails + r.hydro + r.crew + r.righting + r.damping + contact.roll;
  return o;
}

/**
 * Time derivative of the rigid state (4-DOF with added mass and Coriolis terms in surge/sway/yaw), written
 * into `out` when given.
 */
export function derivatives(p: BoatParams, s: RigidState, f: ForceBreakdown, current: NE, out?: RigidState): RigidState {
  const t = f.total;
  const c = Math.cos(s.psi);
  const sn = Math.sin(s.psi);
  const d = out ?? { n: 0, e: 0, psi: 0, u: 0, v: 0, r: 0, phi: 0, p: 0 };
  d.n = s.u * c - s.v * sn + current.n;
  d.e = s.u * sn + s.v * c + current.e;
  d.psi = s.r;
  d.u = (t.x + p.m22 * s.v * s.r) / p.m11;
  d.v = (t.y - p.m11 * s.u * s.r) / p.m22;
  d.r = t.n / p.i66;
  d.phi = s.p;
  d.p = f.roll.total / p.i44;
  return d;
}

/**
 * Static heel equilibrium (diagnostic): the angle at which the heeling moment of the sails (arm = CE height
 * + CLR depth) and the crew balances the righting moment m g GZ(φ). Found by bisection; the dynamic roll
 * state oscillates about and settles to this angle.
 */
export function heelEquilibrium(p: BoatParams, s: RigidState, a: Actuators, wind: NE, current: NE, fluids: Fluids): number {
  const f = (phi: number) => aeroHeelMoment(p, s, a, wind, current, fluids, phi) + p.crewMass * G * a.crewY * Math.cos(phi) - p.weight * rightingArm(p, phi);
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  if (f(lo) < 0 && f(hi) < 0) return lo;
  if (f(lo) > 0 && f(hi) > 0) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Scratch records for aeroHeelMoment (it returns a number, so nothing it fills escapes).
const HEEL_WORK = (() => {
  const f = newForceBreakdown();
  return { ground: { n: 0, e: 0 }, aw: f.aw, pair: { main: f.main, jib: f.jib, jibEffectiveness: 0 }, windage: f.windage };
})();

/**
 * Heeling moment (N m, > 0 heels to starboard) of the sails and windage at heel angle phi, about the centre
 * of lateral resistance: sail-plane side force x (CE height + CLR depth).
 */
export function aeroHeelMoment(
  p: BoatParams,
  s: RigidState,
  a: Actuators,
  wind: NE,
  current: NE,
  fluids: Fluids,
  phi: number,
): number {
  const through = bodyToWorld(s.u, s.v, s.psi);
  const ground = HEEL_WORK.ground;
  ground.n = through.n + current.n;
  ground.e = through.e + current.e;
  const aw = apparentWind(wind, ground, s.psi, HEEL_WORK.aw);
  const { main, jib } = sailPairForces(p, a.boomMain, a.boomJib, aw, phi, fluids.rhoAir, undefined, undefined, a.mainInverted, HEEL_WORK.pair);
  const windage = windageForce(p, aw, phi, fluids.rhoAir, HEEL_WORK.windage);
  return (
    main.yPlane * (p.main.ceHeight + p.clrDepth) +
    jib.yPlane * (p.jib.ceHeight + p.clrDepth) +
    windage.y * (p.windageHeight + p.clrDepth)
  );
}

/**
 * Which side a sail is set on, with hysteresis. When the apparent wind moves to the sail's side the sail
 * switches over (a tack), except when the wind is within `byTheLee` of dead astern, where the boom stays
 * out until the wind is further by the lee (a gybe).
 */
export function updateSide(side: 1 | -1, awa: number, byTheLee: number): 1 | -1 {
  if (side * awa > 0) return side;
  const mag = Math.abs(awa);
  if (mag < 1e-9) return side;
  if (mag > Math.PI - byTheLee) return side;
  return side === 1 ? -1 : 1;
}

/** Maximum sail angle allowed by the sheet: 0 = hard in, 1 = fully eased. */
export function sheetLimit(sp: SailParams, sheet: number): number {
  return sp.sheetMin + clamp(sheet, 0, 1) * (sp.sheetMax - sp.sheetMin);
}

/** Inverse of sheetLimit. */
export function sheetForLimit(sp: SailParams, limit: number): number {
  return clamp((limit - sp.sheetMin) / (sp.sheetMax - sp.sheetMin), 0, 1);
}

/**
 * Angle the sail settles at: it blows out to leeward until the sheet stops it; if the sheet is eased beyond
 * the wind, it streams with the wind (luffing). When the wind is on the sail's side (by the lee) it is
 * pushed out against the sheet.
 */
export function sailTarget(side: 1 | -1, awaEff: number, limit: number): number {
  const free = side * awaEff > 0 ? Math.abs(awaEff) : Math.PI;
  return side * Math.min(free, limit);
}

/** Sheet setting that gives the auto-trim target incidence at this apparent wind angle. */
export function autoTrimSheet(sp: SailParams, awaEff: number): number {
  return sheetForLimit(sp, clamp(Math.abs(awaEff) - sp.autoTrimAlpha, sp.sheetMin, sp.sheetMax));
}

/**
 * How far by the lee the apparent wind is relative to the main boom: > 0 when the wind comes from the
 * boom's side and from abaft the beam (0 at dead astern), else ≤ 0.
 */
export function byTheLeeAngle(boom: number, awa: number): number {
  const boomSide = boom >= 0 ? 1 : -1;
  if (boomSide * awa >= 0 || Math.abs(awa) < Math.PI / 2) return -1;
  return Math.PI - Math.abs(awa);
}

/**
 * Hinged main boom, one fixed step (semi-implicit Euler in sub-steps). Torques: the sail's aerodynamic
 * torque (computed at the step start, which already includes aerodynamic damping through the swing rate),
 * gravity when heeled (swings it to leeward), and gooseneck damping. Constraints: |β| ≤ sheet limit
 * (one-sided: the sheet only stops the boom going further out) with a small bounce.
 */
export function stepBoom(
  p: BoatParams,
  boom: number,
  rate: number,
  aeroTorque: number,
  heel: number,
  limit: number,
  dt: number,
): { boom: number; rate: number; fetchedUp: boolean } {
  const sub = 4;
  const h = dt / sub;
  let b = boom;
  let w = rate;
  let fetchedUp = false;
  for (let i = 0; i < sub; i++) {
    const gravity = -p.boomMassMoment * G * Math.sin(heel) * Math.cos(b);
    const acc = (aeroTorque + gravity - p.boomDamping * w) / p.boomInertia;
    w += acc * h;
    b += w * h;
    if (Math.abs(b) > limit) {
      b = Math.sign(b) * limit;
      if (Math.sign(w) === Math.sign(b)) {
        w = -p.boomRestitution * w;
        fetchedUp = true;
      }
    }
  }
  return { boom: b, rate: w, fetchedUp };
}

export { effectiveApparent };
