/**
 * Force models. Frames (see docs/PHYSICS.md):
 *  - World: North-East-Down, positions in metres. Velocities as (n, e) components.
 *  - Body: x forward, y starboard. Heading ψ is a compass bearing (clockwise from north).
 *  - Heel φ > 0 means heeled to starboard (mast tip to starboard).
 *  - Boom/sail angle β > 0 means the sail is set to port (as on starboard tack).
 *  - Yaw moment N > 0 turns the bow to starboard.
 */
import { wrapPi } from '../math/angles';
import { hypot2 } from '../math/hypot';
import { interpTable } from '../math/interp';
import { G, NU_WATER } from '../units';
import { foilCoefficients, sailCoefficients, type Coeffs, type SailCoeffs } from './coefficients';
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
  const speed = hypot2(v.n, v.e);
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
export function apparentWind(windGround: NE, boatGround: NE, psi: number, out?: ApparentWind): ApparentWind {
  const n = windGround.n - boatGround.n;
  const e = windGround.e - boatGround.e;
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const x = n * c + e * s;
  const y = -n * s + e * c;
  const aws = hypot2(x, y);
  const awa = Math.atan2(-y, -x);
  if (!out) return { ax: x, ay: y, aws, awa };
  out.ax = x;
  out.ay = y;
  out.aws = aws;
  out.awa = awa;
  return out;
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
  /** Effective apparent wind seen by the heeled sail plane (local, at the CE). */
  aws: number;
  awa: number;
  /** Aerodynamic torque about the mast/forestay axis, > 0 swings the sail towards port (N m). */
  boomTorque: number;
}

const ZERO_SAIL: SailForce = {
  x: 0, y: 0, yPlane: 0, n: 0, incidence: 0, cl: 0, cd: 0, luff: 0, stall: 0, ceX: 0, ceY: 0, aws: 0, awa: 0, boomTorque: 0,
};

/** Effective apparent wind in the heeled sail plane: the athwartships component is reduced by cos φ. */
export function effectiveApparent(aw: ApparentWind, heel: number): { ax: number; ay: number; aws: number; awa: number } {
  const ay = aw.ay * Math.cos(heel);
  return { ax: aw.ax, ay, aws: hypot2(aw.ax, ay), awa: Math.atan2(-ay, -aw.ax) };
}

/** Rates that move a sail's centre of effort relative to the air (rad/s). */
export interface SailMotion {
  /** Sail (boom) swing rate about the mast, > 0 towards port. */
  boomRate: number;
  /** Roll rate, > 0 heeling further to starboard. */
  rollRate: number;
  /** Yaw rate, > 0 turning to starboard. */
  yawRate: number;
}

const NO_MOTION: SailMotion = { boomRate: 0, rollRate: 0, yawRate: 0 };

/** Geometry and local airflow of one sail (a reused scratch object: read it before the next call). */
interface SailFlow {
  cosB: number;
  sinB: number;
  cosH: number;
  arm: number;
  ceX: number;
  ceY: number;
  ax: number;
  ay: number;
  aws: number;
  dx: number;
  dy: number;
  /** Angle from the chord to the airflow, before any interaction shift. */
  geometric: number;
}

const FLOW: SailFlow = { cosB: 0, sinB: 0, cosH: 0, arm: 0, ceX: 0, ceY: 0, ax: 0, ay: 0, aws: 0, dx: 0, dy: 0, geometric: 0 };

function sailFlow(p: SailParams, boom: number, aw: ApparentWind, heel: number, motion: SailMotion): SailFlow {
  const f = FLOW;
  const cosH = Math.cos(heel);
  const cosB = Math.cos(boom);
  const sinB = Math.sin(boom);
  const cx = -cosB;
  const cy = -sinB;
  const arm = p.ceChordFrac * p.foot;
  const ceX = p.pivotX + arm * cx;
  const ceYPlane = arm * cy;
  const ceY = ceYPlane * cosH + p.ceHeight * Math.sin(heel);
  // Velocity of the CE in the sail plane: yaw (r × position), roll (p·h sideways), swing (ω·arm ⟂ chord).
  const vx = -motion.yawRate * ceY + motion.boomRate * arm * sinB;
  const vy = motion.yawRate * ceX * cosH + motion.rollRate * p.ceHeight - motion.boomRate * arm * cosB;
  const ax = aw.ax - vx;
  const ay = aw.ay * cosH - vy;
  const aws = hypot2(ax, ay);
  f.cosB = cosB;
  f.sinB = sinB;
  f.cosH = cosH;
  f.arm = arm;
  f.ceX = ceX;
  f.ceY = ceY;
  f.ax = ax;
  f.ay = ay;
  f.aws = aws;
  if (aws < 1e-9) return f;
  f.dx = ax / aws;
  f.dy = ay / aws;
  f.geometric = wrapPi(Math.atan2(f.dy, f.dx) - Math.atan2(cy, cx));
  return f;
}

// Scratch coefficients, read straight after each call (the force functions are not re-entrant).
const K_SAIL: SailCoeffs = { cl: 0, cd: 0, luff: 0, stall: 0 };
const K_FOIL: Coeffs = { cl: 0, cd: 0 };

/** Lift coefficient of a sail on its own (no interaction with the other sail): sailForce(…).cl, without the forces. */
function sailLiftAlone(p: SailParams, boom: number, aw: ApparentWind, heel: number, motion: SailMotion): number {
  const fl = sailFlow(p, boom, aw, heel, motion);
  return fl.aws < 1e-9 ? 0 : sailCoefficients(fl.geometric, p.coeff, K_SAIL).cl;
}

/**
 * Aerodynamic force of one sail. Lift ⟂ to the local airflow, drag along it, from the incidence between the
 * airflow and the sail chord (pivot → clew at angle β).
 * - The airflow is the apparent wind in the heeled sail plane, minus the velocity of the centre of effort
 *   caused by yaw, roll and the sail's own swing (this is what damps roll, yaw and boom motion).
 * - `incidenceShift` (rad) models the other sail: negative = downwash (main behind the jib), positive =
 *   upwash (jib ahead of the main).
 * - `inverted`: the sail has flipped by the lee; the force component normal to the chord is reversed,
 *   driving the boom across (gybe).
 */
export function sailForce(
  p: SailParams,
  boom: number,
  aw: ApparentWind,
  heel: number,
  rhoAir: number,
  effectiveness = 1,
  incidenceShift = 0,
  motion: SailMotion = NO_MOTION,
  inverted = false,
  out?: SailForce,
): SailForce {
  const { cosB, sinB, cosH, arm, ceX, ceY, ax, ay, aws, dx, dy, geometric } = sailFlow(p, boom, aw, heel, motion);
  if (aws < 1e-9) {
    const o = out ? Object.assign(out, ZERO_SAIL) : { ...ZERO_SAIL };
    o.ceX = ceX;
    o.ceY = ceY;
    return o;
  }
  // Interaction with the other sail (up/downwash) shifts the incidence magnitude for luff-first flow.
  const incidence =
    incidenceShift !== 0 && Math.abs(geometric) < Math.PI / 2
      ? Math.sign(geometric) * Math.max(0, Math.abs(geometric) + incidenceShift)
      : geometric;
  const k = sailCoefficients(incidence, p.coeff, K_SAIL);
  const q = 0.5 * rhoAir * aws * aws * p.area * effectiveness;
  const sgn = incidence >= 0 ? 1 : -1;
  const lx = -sgn * dy;
  const ly = sgn * dx;
  let fx = q * (k.cl * lx + k.cd * dx);
  let fyPlane = q * (k.cl * ly + k.cd * dy);
  if (inverted) {
    // Reflect the chord-normal component: n = (sin β, -cos β).
    const nx = sinB;
    const ny = -cosB;
    const fn = fx * nx + fyPlane * ny;
    fx -= 2 * fn * nx;
    fyPlane -= 2 * fn * ny;
  }
  const fy = fyPlane * cosH;
  const o = out ?? { ...ZERO_SAIL };
  o.x = fx;
  o.y = fy;
  o.yPlane = fyPlane;
  o.n = ceX * fy - ceY * fx;
  o.incidence = incidence;
  o.cl = k.cl;
  o.cd = k.cd;
  o.luff = k.luff;
  o.stall = k.stall;
  o.ceX = ceX;
  o.ceY = ceY;
  o.aws = aws;
  o.awa = Math.atan2(-ay, -ax);
  o.boomTorque = arm * (fx * sinB - fyPlane * cosB);
  return o;
}

/** Jib effectiveness when running: blanketed by the main beyond jibBlanketStartAwa. */
export function jibEffectiveness(params: BoatParams, awa: number): number {
  const a = Math.abs(awa);
  if (a <= params.jibBlanketStartAwa) return 1;
  const t = (a - params.jibBlanketStartAwa) / (Math.PI - params.jibBlanketStartAwa);
  return 1 - t * (1 - params.jibBlanketMin);
}

export interface SailPair {
  main: SailForce;
  jib: SailForce;
  jibEffectiveness: number;
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
  mainMotion: SailMotion = NO_MOTION,
  jibMotion: SailMotion = NO_MOTION,
  mainInverted = false,
  out?: SailPair,
): SailPair {
  const jEff = jibEffectiveness(params, aw.awa);
  const w = Math.max(0, Math.cos(aw.awa));
  const mainAloneCl = sailLiftAlone(params.main, boomMain, aw, heel, mainMotion);
  const jib = sailForce(params.jib, boomJib, aw, heel, rhoAir, jEff, w * params.mainUpwashOnJib * Math.max(0, mainAloneCl), jibMotion, false, out?.jib);
  const main = sailForce(params.main, boomMain, aw, heel, rhoAir, 1, -w * params.jibDownwashOnMain * Math.max(0, jib.cl), mainMotion, mainInverted, out?.main);
  if (!out) return { main, jib, jibEffectiveness: jEff };
  out.jibEffectiveness = jEff;
  return out;
}

export interface BodyForce {
  x: number;
  y: number;
  n: number;
}

/** Windage of hull, rig and crew: drag along the apparent wind. */
export function windageForce(params: BoatParams, aw: ApparentWind, heel: number, rhoAir: number, out?: BodyForce): BodyForce {
  const k = 0.5 * rhoAir * params.windageCdA * aw.aws;
  const fx = k * aw.ax;
  const fy = k * aw.ay;
  const yArm = params.windageHeight * Math.sin(heel);
  if (!out) return { x: fx, y: fy, n: -yArm * fx };
  out.x = fx;
  out.y = fy;
  out.n = -yArm * fx;
  return out;
}

export interface FoilForce extends BodyForce {
  /** Side force in the heeled plane of the foil (N), for the roll moment. */
  yPlane: number;
  alpha: number;
  cl: number;
  cd: number;
  speed: number;
}

/**
 * Underwater lifting surface at body x = p.x moving with local velocity (u, vLocal) through the water,
 * deflected by `deflection` (rudder angle; > 0 = trailing edge to starboard, turning the boat to starboard).
 * Horizontal force is reduced by cos φ (heeled foil). vLocal must include the sway caused by yaw (r·x) and
 * roll (−p·depth) at the foil.
 */
export function foilForce(
  p: FoilParams,
  u: number,
  vLocal: number,
  deflection: number,
  heel: number,
  rhoWater: number,
  out?: FoilForce,
): FoilForce {
  const o = out ?? { x: 0, y: 0, yPlane: 0, n: 0, alpha: 0, cl: 0, cd: 0, speed: 0 };
  const v2 = u * u + vLocal * vLocal;
  if (v2 < 1e-12) {
    o.x = o.y = o.yPlane = o.n = o.alpha = o.cl = o.cd = o.speed = 0;
    return o;
  }
  const speed = Math.sqrt(v2);
  const ca = Math.cos(deflection);
  const sa = Math.sin(deflection);
  const alpha = Math.atan2(u * sa + vLocal * ca, u * ca - vLocal * sa);
  const k = foilCoefficients(alpha, p, K_FOIL);
  const dx = -u / speed;
  const dy = -vLocal / speed;
  const qPlane = 0.5 * rhoWater * v2 * p.area;
  const cosH = Math.cos(heel);
  const yPlane = qPlane * (k.cl * dx + k.cd * dy);
  const fx = qPlane * cosH * (k.cl * -dy + k.cd * dx);
  const fy = yPlane * cosH;
  o.x = fx;
  o.y = fy;
  o.yPlane = yPlane;
  o.n = p.x * fy;
  o.alpha = alpha;
  o.cl = k.cl;
  o.cd = k.cd;
  o.speed = speed;
  return o;
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
 * R_R = m g f(Fn) from the calibration table; both scaled by (1 + k φ²) for heel. `extraWeight` (N) is water
 * shipped into the cockpit.
 */
export function hullResistance(params: BoatParams, u: number, heel: number, rhoWater: number, out?: HullResistance, extraWeight = 0): HullResistance {
  const o = out ?? { friction: 0, residuary: 0, total: 0, froude: 0, x: 0 };
  const speed = Math.abs(u);
  if (speed < 1e-9) {
    o.friction = o.residuary = o.total = o.froude = o.x = 0;
    return o;
  }
  const re = Math.max((speed * 0.7 * params.lwl) / NU_WATER, 1e5);
  const lr = Math.log10(re) - 2;
  const cf = 0.075 / (lr * lr);
  const heelFactor = 1 + params.heelResistance * heel * heel;
  const friction = 0.5 * rhoWater * speed * speed * params.wettedArea * cf * params.formFactor * heelFactor;
  const froude = speed / Math.sqrt(G * params.lwl);
  const residuary = (extraWeight > 0 ? params.weight + extraWeight : params.weight) * Math.max(0, interpTable(params.residuary, froude)) * heelFactor;
  const total = friction + residuary;
  o.friction = friction;
  o.residuary = residuary;
  o.total = total;
  o.froude = froude;
  o.x = -Math.sign(u) * total;
  return o;
}

const CROSS_FLOW_STRIPS = 10;

/** Quadratic cross-flow drag of the canoe body, integrated in strips (sway and yaw damping at low speed). */
export function hullCrossFlow(params: BoatParams, v: number, r: number, rhoWater: number, out?: BodyForce): BodyForce {
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
  if (!out) return { x: 0, y, n };
  out.x = 0;
  out.y = y;
  out.n = n;
  return out;
}
