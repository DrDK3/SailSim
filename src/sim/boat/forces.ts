/**
 * Force models. Frames (see docs/PHYSICS.md):
 *  - World: North-East-Down, positions in metres. Velocities as (n, e) components.
 *  - Body: x forward, y starboard. Heading ψ is a compass bearing (clockwise from north).
 *  - Heel φ > 0 means heeled to starboard (mast tip to starboard).
 *  - Boom/sail angle β > 0 means the sail is set to port (as on starboard tack).
 *  - Yaw moment N > 0 turns the bow to starboard.
 */
import { wrapPi } from '../math/angles';
import { interpTable } from '../math/interp';
import { G, NU_WATER } from '../units';
import { foilCoefficients, sailCoefficients } from './coefficients';
import type { BoatParams, FoilParams, SailParams } from './params';

export interface NE {
  n: number;
  e: number;
}

/** True-wind velocity vector (where the air moves to) from speed and the direction it blows FROM. */
export function windVelocity(speed: number, fromDir: number): NE {
  return { n: -speed * Math.cos(fromDir), e: -speed * Math.sin(fromDir) };
}

/** Direction (FROM, compass radians in [0, 2π)) and speed of a wind velocity vector. */
export function windFrom(v: NE): { speed: number; fromDir: number } {
  const speed = Math.hypot(v.n, v.e);
  const dir = Math.atan2(-v.e, -v.n);
  return { speed, fromDir: dir < 0 ? dir + 2 * Math.PI : dir };
}

export function worldToBody(n: number, e: number, psi: number): { x: number; y: number } {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return { x: n * c + e * s, y: -n * s + e * c };
}

export function bodyToWorld(x: number, y: number, psi: number): NE {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return { n: x * c - y * s, e: x * s + y * c };
}

export interface ApparentWind {
  /** Air velocity relative to the boat, body frame (m/s). */
  ax: number;
  ay: number;
  aws: number;
  /** Apparent wind angle, FROM direction relative to the bow, (-π, π]; > 0 = from starboard. */
  awa: number;
}

/**
 * Apparent wind = true wind over ground − boat velocity over ground.
 * (Equivalently: wind over water − boat velocity through water.)
 */
export function apparentWind(windGround: NE, boatGround: NE, psi: number): ApparentWind {
  const { x, y } = worldToBody(windGround.n - boatGround.n, windGround.e - boatGround.e, psi);
  return { ax: x, ay: y, aws: Math.hypot(x, y), awa: Math.atan2(-y, -x) };
}

export interface SailForce {
  /** Horizontal body-frame force (N). */
  x: number;
  y: number;
  /** Side force in the heeled sail plane (N), used for the heeling moment. */
  yPlane: number;
  /** Yaw moment about the CG (N m). */
  n: number;
  incidence: number;
  cl: number;
  cd: number;
  luff: number;
  stall: number;
  ceX: number;
  ceY: number;
  /** Effective apparent wind seen by the heeled sail plane. */
  aws: number;
  awa: number;
}

const ZERO_SAIL: SailForce = {
  x: 0, y: 0, yPlane: 0, n: 0, incidence: 0, cl: 0, cd: 0, luff: 0, stall: 0, ceX: 0, ceY: 0, aws: 0, awa: 0,
};

/** Effective apparent wind in the heeled sail plane: the athwartships component is reduced by cos φ. */
export function effectiveApparent(aw: ApparentWind, heel: number): { ax: number; ay: number; aws: number; awa: number } {
  const ay = aw.ay * Math.cos(heel);
  return { ax: aw.ax, ay, aws: Math.hypot(aw.ax, ay), awa: Math.atan2(-ay, -aw.ax) };
}

/**
 * Aerodynamic force of one sail.
 * `incidenceShift` (rad) models the other sail's influence: negative = downwash (main behind the jib),
 * positive = upwash (jib ahead of the main). Lift ⟂ to the (effective) apparent wind, drag along it, from the
 * incidence between the airflow and the sail chord (mast → clew at angle β).
 */
export function sailForce(
  p: SailParams,
  boom: number,
  aw: ApparentWind,
  heel: number,
  rhoAir: number,
  effectiveness = 1,
  incidenceShift = 0,
): SailForce {
  const eff = effectiveApparent(aw, heel);
  if (eff.aws < 1e-9) return { ...ZERO_SAIL };
  const dx = eff.ax / eff.aws;
  const dy = eff.ay / eff.aws;
  const cx = -Math.cos(boom);
  const cy = -Math.sin(boom);
  const geometric = wrapPi(Math.atan2(dy, dx) - Math.atan2(cy, cx));
  // Interaction with the other sail (up/downwash) shifts the incidence magnitude for luff-first flow.
  const incidence =
    incidenceShift !== 0 && Math.abs(geometric) < Math.PI / 2
      ? Math.sign(geometric) * Math.max(0, Math.abs(geometric) + incidenceShift)
      : geometric;
  const k = sailCoefficients(incidence, p.coeff);
  const q = 0.5 * rhoAir * eff.aws * eff.aws * p.area * effectiveness;
  const sgn = incidence >= 0 ? 1 : -1;
  const lx = -sgn * dy;
  const ly = sgn * dx;
  const fx = q * (k.cl * lx + k.cd * dx);
  const fyPlane = q * (k.cl * ly + k.cd * dy);
  const cosH = Math.cos(heel);
  const fy = fyPlane * cosH;
  const ceX = p.pivotX + p.ceChordFrac * p.foot * cx;
  const ceY = p.ceChordFrac * p.foot * cy * cosH + p.ceHeight * Math.sin(heel);
  return {
    x: fx, y: fy, yPlane: fyPlane, n: ceX * fy - ceY * fx, incidence, cl: k.cl, cd: k.cd, luff: k.luff,
    stall: k.stall, ceX, ceY, aws: eff.aws, awa: eff.awa,
  };
}

/** Jib effectiveness when running: blanketed by the main beyond jibBlanketStartAwa. */
export function jibEffectiveness(params: BoatParams, awa: number): number {
  const a = Math.abs(awa);
  if (a <= params.jibBlanketStartAwa) return 1;
  const t = (a - params.jibBlanketStartAwa) / (Math.PI - params.jibBlanketStartAwa);
  return 1 - t * (1 - params.jibBlanketMin);
}

/**
 * Main and jib with their mutual interaction: the main's upwash raises the jib's incidence and the jib's
 * downwash lowers the main's, proportionally to each sail's lift coefficient. The effect fades out as the
 * apparent wind moves aft of abeam (cos AWA weighting).
 */
export function sailPairForces(
  params: BoatParams,
  boomMain: number,
  boomJib: number,
  aw: ApparentWind,
  heel: number,
  rhoAir: number,
): { main: SailForce; jib: SailForce; jibEffectiveness: number } {
  const jEff = jibEffectiveness(params, aw.awa);
  const w = Math.max(0, Math.cos(aw.awa));
  const mainAlone = sailForce(params.main, boomMain, aw, heel, rhoAir);
  const jib = sailForce(params.jib, boomJib, aw, heel, rhoAir, jEff, w * params.mainUpwashOnJib * Math.max(0, mainAlone.cl));
  const main = sailForce(params.main, boomMain, aw, heel, rhoAir, 1, -w * params.jibDownwashOnMain * Math.max(0, jib.cl));
  return { main, jib, jibEffectiveness: jEff };
}

export interface BodyForce {
  x: number;
  y: number;
  n: number;
}

/** Windage of hull, rig and crew: drag along the apparent wind. */
export function windageForce(params: BoatParams, aw: ApparentWind, heel: number, rhoAir: number): BodyForce {
  const k = 0.5 * rhoAir * params.windageCdA * aw.aws;
  const fx = k * aw.ax;
  const fy = k * aw.ay;
  const yArm = params.windageHeight * Math.sin(heel);
  return { x: fx, y: fy, n: -yArm * fx };
}

export interface FoilForce extends BodyForce {
  alpha: number;
  cl: number;
  cd: number;
  speed: number;
}

/**
 * Underwater lifting surface at body x = p.x moving with local velocity (u, vLocal) through the water,
 * deflected by `deflection` (rudder angle; > 0 = trailing edge to starboard, turning the boat to starboard).
 * Horizontal force is reduced by cos φ (heeled foil).
 */
export function foilForce(
  p: FoilParams,
  u: number,
  vLocal: number,
  deflection: number,
  heel: number,
  rhoWater: number,
): FoilForce {
  const v2 = u * u + vLocal * vLocal;
  if (v2 < 1e-12) return { x: 0, y: 0, n: 0, alpha: 0, cl: 0, cd: 0, speed: 0 };
  const speed = Math.sqrt(v2);
  const ca = Math.cos(deflection);
  const sa = Math.sin(deflection);
  const alpha = Math.atan2(u * sa + vLocal * ca, u * ca - vLocal * sa);
  const k = foilCoefficients(alpha, p);
  const dx = -u / speed;
  const dy = -vLocal / speed;
  const q = 0.5 * rhoWater * v2 * p.area * Math.cos(heel);
  const fx = q * (k.cl * -dy + k.cd * dx);
  const fy = q * (k.cl * dx + k.cd * dy);
  return { x: fx, y: fy, n: p.x * fy, alpha, cl: k.cl, cd: k.cd, speed };
}

export interface HullResistance {
  friction: number;
  residuary: number;
  total: number;
  froude: number;
  x: number;
}

/**
 * Upright resistance: ITTC-1957 friction on total wetted area x form factor, plus a residuary term
 * R_R = m g f(Fn) from the calibration table; both scaled by (1 + k φ²) for heel.
 */
export function hullResistance(params: BoatParams, u: number, heel: number, rhoWater: number): HullResistance {
  const speed = Math.abs(u);
  if (speed < 1e-9) return { friction: 0, residuary: 0, total: 0, froude: 0, x: 0 };
  const re = Math.max((speed * 0.7 * params.lwl) / NU_WATER, 1e5);
  const lr = Math.log10(re) - 2;
  const cf = 0.075 / (lr * lr);
  const heelFactor = 1 + params.heelResistance * heel * heel;
  const friction = 0.5 * rhoWater * speed * speed * params.wettedArea * cf * params.formFactor * heelFactor;
  const froude = speed / Math.sqrt(G * params.lwl);
  const residuary = params.weight * Math.max(0, interpTable(params.residuary, froude)) * heelFactor;
  const total = friction + residuary;
  return { friction, residuary, total, froude, x: -Math.sign(u) * total };
}

const CROSS_FLOW_STRIPS = 10;

/** Quadratic cross-flow drag of the canoe body, integrated in strips (sway and yaw damping at low speed). */
export function hullCrossFlow(params: BoatParams, v: number, r: number, rhoWater: number): BodyForce {
  const len = params.lwl;
  const dx = len / CROSS_FLOW_STRIPS;
  const k = 0.5 * rhoWater * params.hullCrossFlowCd * params.hullDraft * dx;
  let y = 0;
  let n = 0;
  for (let i = 0; i < CROSS_FLOW_STRIPS; i++) {
    const x = -len / 2 + (i + 0.5) * dx;
    const vl = v + r * x;
    const f = -k * vl * Math.abs(vl);
    y += f;
    n += x * f;
  }
  return { x: 0, y, n };
}
