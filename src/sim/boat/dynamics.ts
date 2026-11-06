import { clamp, smoothstep, wrapPi } from '../math/angles';
import { interpTable } from '../math/interp';
import { G } from '../units';
import { rigFactor, rudderDamage, type Damage } from './damage';
import { FLOOD, floodHeelMoment, wreckForces } from './flooding';
import {
  apparentWind,
  bodyToWorld,
  effectiveApparent,
  foilForce,
  rudderGrip,
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
import { waterHeelMoment } from './cockpit';

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
  /** Water shipped into the cockpit (kg; src/sim/boat/cockpit.ts). */
  water: number;
  /** Damage from collisions and groundings (src/sim/boat/damage.ts); none when absent. */
  damage?: Damage;
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
  /** Water in the cockpit (kg) the forces were computed with: it moves with the boat (derivatives). */
  water: number;
  /** Water inside the hull from a breach (kg), counted the same way while she is still afloat. */
  flood: number;
  /** Roll moments (N m, > 0 heels to starboard). `water`: the shipped water running to the low side. */
  roll: { sails: number; hydro: number; crew: number; righting: number; damping: number; ground: number; water: number; total: number };
  total: BodyForce;
}

/**
 * Righting arm GZ(φ) (m), odd in φ, from the calibration table. Beyond the table's last angle (120°) it runs
 * linearly to zero at 180° (upside down), and the angle is taken round the circle: the table is never
 * extrapolated. (Linear extrapolation made the capsizing arm grow without limit past 120°, so a boat knocked
 * that far rolled faster and faster until the numbers overflowed: review, 3 Nov 2026.)
 */
export function rightingArm(p: BoatParams, phi: number): number {
  const a = Math.abs(wrapPi(phi));
  const last = p.gz[p.gz.length - 1]!;
  const arm = a <= last[0] ? interpTable(p.gz, a) : last[1] * Math.max(0, (Math.PI - a) / (Math.PI - last[0]));
  return Math.sign(wrapPi(phi)) * arm;
}

/**
 * Knocked down, the rig reaches the water (E): the sails and windage fade from 75° to nothing at 90° of heel,
 * and the roll damping rises to `1 + extraDamping` times its value as the mast and sails drag through the water.
 */
export const RIG_IN_WATER = { fromRad: (75 * Math.PI) / 180, toRad: Math.PI / 2, extraDamping: 20 };

/** The share of the rig still above the water at heel `phi` (1 upright … 0 with the mast in the water). */
export function rigAboveWater(phi: number): number {
  const c = Math.abs(Math.cos(phi));
  // |cos| falls from cos 75° to 0 at 90°; past 90° the rig is under (the boat is beyond the knockdown).
  if (Math.abs(wrapPi(phi)) >= RIG_IN_WATER.toRad) return 0;
  return smoothstep(0, Math.cos(RIG_IN_WATER.fromRad), c);
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
    water: 0,
    flood: 0,
    roll: { sails: 0, hydro: 0, crew: 0, righting: 0, damping: 0, ground: 0, water: 0, total: 0 },
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
  // A damaged rig drives less (a slack forestay, a bent or broken mast). Knocked down past 75° the sails reach
  // the water and stop driving (none past 90°): see RIG_IN_WATER.
  const rig = rigFactor(a.damage) * rigAboveWater(s.phi);
  if (rig < 1) for (const sf of [main, jib]) {
    sf.x *= rig;
    sf.y *= rig;
    sf.yPlane *= rig;
    sf.n *= rig;
    sf.boomTorque *= rig;
  }
  const windage = windageForce(p, aw, s.phi, fluids.rhoAir, o.windage);
  const above = rigAboveWater(s.phi);
  if (above < 1) {
    windage.x *= above;
    windage.y *= above;
  }
  // Local sway at each foil: yaw (r·x) and roll (the keel swings opposite to the mast: −p·depth).
  const lateral = foilForce(p.lateral, s.u, s.v + s.r * p.lateral.x - s.p * p.clrDepth, 0, s.phi, fluids.rhoWater, o.lateral);
  // The keel's downwash straightens the flow reaching the rudder: only part of the hull's leeway remains.
  const rudderSway = s.v * (1 - p.rudder.flowStraightening) + s.r * p.rudder.x - s.p * p.rudderDepth;
  // A damaged rudder grips less, and a bent blade pulls to one side.
  const rd = rudderDamage(a.damage);
  const rudder = foilForce(p.rudder, s.u, rudderSway, a.rudder + rd.bias, s.phi, fluids.rhoWater, o.rudder, rudderGrip(p.rudder, s.phi) * rd.grip);
  const water = a.water;
  // Water inside from a breach is extra weight: more resistance (its free surface and mass are added below).
  const bilge = a.damage?.bilge ?? 0;
  o.water = water;
  // Shipped water adds weight: more residuary resistance (and more displacement in the righting moment below).
  const hull = hullResistance(p, s.u, s.phi, fluids.rhoWater, o.hull, water + bilge > 0 ? (water + bilge) * G : 0);
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
  // A fallen rig dragging in the water, and a drowned hull (src/sim/boat/flooding.ts).
  const dmg = a.damage;
  const wreck = dmg && (dmg.rigParts.down || dmg.state === 'awash' || dmg.state === 'sinking') ? wreckForces(dmg, s.u, s.v, s.r, fluids.rhoWater) : undefined;
  if (wreck) {
    total.x += wreck.x;
    total.y += wreck.y;
    total.n += wreck.n;
  }
  // Roll about the waterline: sail-plane side forces act above it, keel and rudder forces below it.
  const r = o.roll;
  r.sails = main.yPlane * p.main.ceHeight + jib.yPlane * p.jib.ceHeight + windage.y * p.windageHeight;
  r.hydro = -lateral.yPlane * p.clrDepth - rudder.yPlane * p.rudderDepth;
  r.crew = p.crewMass * G * a.crewY * Math.cos(s.phi);
  r.righting = -p.weight * rightingArm(p, s.phi);
  // The mast and sails dragging through the water once knocked down that far damp the roll strongly (E).
  r.damping = -p.rollLinearDamping * (1 + RIG_IN_WATER.extraDamping * (1 - rigAboveWater(s.phi))) * s.p;
  r.ground = contact.roll;
  r.water = 0;
  r.total = r.sails + r.hydro + r.crew + r.righting + r.damping + contact.roll;
  if (wreck) r.total += wreck.roll;
  if (water > 0) {
    // The hull carries the extra displacement at the same righting arm; the water's weight acts at its own
    // centre, above the CG and run to leeward (free surface), so the net effect is a loss of stability.
    const extra = -water * G * rightingArm(p, s.phi);
    r.water = waterHeelMoment(p.cockpit, water, s.phi);
    r.righting += extra;
    r.total += extra + r.water;
  }
  // Water from a breach in the main hull: carried by the extra displacement at her righting arm; its weight low
  // down but running to the low side (free surface). Awash, the sea carries it: nothing extra.
  const afloat = !dmg || dmg.state === 'afloat' || dmg.state === 'low';
  o.flood = afloat && bilge > 0 ? bilge : 0;
  if (o.flood > 0 && dmg) {
    const extra = -bilge * G * rightingArm(p, s.phi);
    const free = floodHeelMoment(dmg, s.phi);
    r.righting += extra;
    r.water += free;
    r.total += extra + free;
  }
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
  if (f.water > 0 || f.flood > 0) {
    // Shipped water moves with the hull in surge, sway and yaw: spread over the cockpit floor, centred near
    // the crew (crewX); water from a breach likewise, over the main hull.
    const w = f.water + f.flood;
    const m11 = p.m11 + w;
    const m22 = p.m22 + w;
    d.u = (t.x + m22 * s.v * s.r) / m11;
    d.v = (t.y - m11 * s.u * s.r) / m22;
    d.r = t.n / (p.i66 + f.water * (p.crewX * p.crewX + (p.cockpit.soleLength * p.cockpit.soleLength) / 12) + f.flood * (FLOOD.slabLength * FLOOD.slabLength) / 12);
  } else {
    d.u = (t.x + p.m22 * s.v * s.r) / p.m11;
    d.v = (t.y - p.m11 * s.u * s.r) / p.m22;
    d.r = t.n / p.i66;
  }
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
  const w = a.water;
  const f = (phi: number) =>
    aeroHeelMoment(p, s, a, wind, current, fluids, phi) + p.crewMass * G * a.crewY * Math.cos(phi) - (p.weight + w * G) * rightingArm(p, phi) +
    waterHeelMoment(p.cockpit, w, phi);
  // The equilibrium a boat reaches heeling over from upright: the first change of sign from 0 towards the
  // side the moment heels it. Near ±90° the heeled-plane sail model is outside its range and can balance
  // spuriously, so a search over the whole range could start a boat on its side (with the crew to leeward).
  const f0 = f(0);
  const dir = f0 >= 0 ? 1 : -1;
  const STEP = 2 * (Math.PI / 180);
  let xPrev = 0;
  let fPrev = f0;
  let bracket: [number, number] | undefined;
  for (let x1 = dir * STEP; Math.abs(x1) <= Math.PI / 2 + 1e-12; x1 += dir * STEP) {
    const f1 = f(x1);
    if (f1 === 0 || Math.sign(f1) !== Math.sign(fPrev)) {
      bracket = [Math.min(xPrev, x1), Math.max(xPrev, x1)];
      break;
    }
    xPrev = x1;
    fPrev = f1;
  }
  if (!bracket) return (dir * Math.PI) / 2;
  // The usual case (one equilibrium): the bisection over the whole range, as before, so results are unchanged.
  const whole = bisect(f, -Math.PI / 2, Math.PI / 2);
  if (whole !== undefined && whole >= bracket[0] - 1e-9 && whole <= bracket[1] + 1e-9) return whole;
  return bisect(f, bracket[0], bracket[1]) ?? (bracket[0] + bracket[1]) / 2;
}

/** A root of f between lo and hi by 40 halvings, or undefined if f has the same sign at both ends. */
function bisect(f: (x: number) => number, lo: number, hi: number): number | undefined {
  const flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return undefined;
  const up = flo > 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0 === up) lo = mid;
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
