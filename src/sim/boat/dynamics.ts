import { clamp } from '../math/angles';
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

/** Continuous state integrated by RK4. Velocities are through the water, in the body frame. */
export interface RigidState {
  n: number;
  e: number;
  psi: number;
  u: number;
  v: number;
  r: number;
}

/** Actuator and quasi-static states, updated once per fixed step (held constant within the step). */
export interface Actuators {
  rudder: number;
  boomMain: number;
  boomJib: number;
  /** +1: sail set to port (starboard tack), -1: set to starboard (port tack). */
  mainSide: 1 | -1;
  jibSide: 1 | -1;
  heel: number;
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
  total: BodyForce;
}

export function computeForces(
  p: BoatParams,
  s: RigidState,
  a: Actuators,
  wind: NE,
  current: NE,
  fluids: Fluids,
): ForceBreakdown {
  const through = bodyToWorld(s.u, s.v, s.psi);
  const groundVelocity = { n: through.n + current.n, e: through.e + current.e };
  const aw = apparentWind(wind, groundVelocity, s.psi);
  const { main, jib, jibEffectiveness: jEff } = sailPairForces(p, a.boomMain, a.boomJib, aw, a.heel, fluids.rhoAir);
  const windage = windageForce(p, aw, a.heel, fluids.rhoAir);
  const lateral = foilForce(p.lateral, s.u, s.v + s.r * p.lateral.x, 0, a.heel, fluids.rhoWater);
  const rudder = foilForce(p.rudder, s.u, s.v + s.r * p.rudder.x, a.rudder, a.heel, fluids.rhoWater);
  const hull = hullResistance(p, s.u, a.heel, fluids.rhoWater);
  const crossFlow = hullCrossFlow(p, s.v, s.r, fluids.rhoWater);
  const yawDamping = -p.yawLinearDamping * s.r;
  const total = {
    x: main.x + jib.x + windage.x + lateral.x + rudder.x + hull.x,
    y: main.y + jib.y + windage.y + lateral.y + rudder.y + crossFlow.y,
    n: main.n + jib.n + windage.n + lateral.n + rudder.n + crossFlow.n + yawDamping,
  };
  return { aw, groundVelocity, main, jib, jibEffectiveness: jEff, windage, lateral, rudder, hull, crossFlow, yawDamping, total };
}

/** Time derivative of the rigid state (3-DOF surge-sway-yaw with added mass and Coriolis terms). */
export function derivatives(p: BoatParams, s: RigidState, f: ForceBreakdown, current: NE): RigidState {
  const t = f.total;
  const through = bodyToWorld(s.u, s.v, s.psi);
  return {
    n: through.n + current.n,
    e: through.e + current.e,
    psi: s.r,
    u: (t.x + p.m22 * s.v * s.r) / p.m11,
    v: (t.y - p.m11 * s.u * s.r) / p.m22,
    r: t.n / p.i66,
  };
}

/**
 * Quasi-static heel: the angle at which the heeling moment of the sail-plane side force (arm = CE height +
 * CLR depth) plus the crew moment balances the righting moment m g GM sin φ. Solved by fixed-point
 * iteration because the sail force itself depends on φ.
 */
export function heelEquilibrium(p: BoatParams, s: RigidState, a: Actuators, wind: NE, current: NE, fluids: Fluids): number {
  const maxSin = Math.sin(p.maxHeel);
  let phi = a.heel;
  for (let i = 0; i < 4; i++) {
    const moment = aeroHeelMoment(p, s, a, wind, current, fluids, phi) + p.crewMass * G * a.crewY * Math.cos(phi);
    phi = Math.asin(clamp(moment / (p.weight * p.gm), -maxSin, maxSin));
  }
  return phi;
}

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
  const aw = apparentWind(wind, { n: through.n + current.n, e: through.e + current.e }, s.psi);
  const { main, jib } = sailPairForces(p, a.boomMain, a.boomJib, aw, phi, fluids.rhoAir);
  const windage = windageForce(p, aw, phi, fluids.rhoAir);
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

export { effectiveApparent };
