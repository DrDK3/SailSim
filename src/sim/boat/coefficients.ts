import { smoothstep } from '../math/angles';
import type { FoilParams, SailCoeffParams } from './params';

export interface Coeffs {
  cl: number;
  cd: number;
}

/** Helmbold lift-curve slope (per radian) for a wing of aspect ratio `ar`. */
export function liftSlope(ar: number): number {
  return (2 * Math.PI * ar) / (2 + Math.sqrt(ar * ar + 4));
}

/** Flat-plate normal-force coefficient (Hoerner's empirical form), |sin α| in [0, 1]. */
function plateCn(cn90: number, absSin: number): number {
  return (cn90 * absSin) / (0.56 + 0.44 * absSin);
}

/**
 * Coefficients for an underwater lifting surface (keel + hull, rudder) at any inflow angle α in (-π, π].
 * Attached flow: tanh-saturated linear lift plus induced drag. Post-stall: flat plate. The two are blended
 * smoothly over [stall, stall + stallWidth]. Lift is an odd function of α. Profile drag is accounted for in
 * the hull friction (total wetted area), so no zero-lift drag term here.
 */
export function foilCoefficients(alpha: number, p: FoilParams): Coeffs {
  const s = Math.sin(alpha);
  const c = Math.cos(alpha);
  const a = liftSlope(p.ar);
  const clAtt = p.clMax * Math.tanh((a * s * c) / p.clMax);
  const cdAtt = (clAtt * clAtt) / (Math.PI * p.ar * p.efficiency);
  const absS = Math.abs(s);
  const cn = plateCn(p.cn90, absS);
  const clPlate = cn * c * Math.sign(s);
  const cdPlate = cn * absS;
  const absA = Math.abs(alpha);
  const folded = Math.min(absA, Math.PI - absA);
  const w = smoothstep(p.stall, p.stall + p.stallWidth, folded);
  return { cl: (1 - w) * clAtt + w * clPlate, cd: (1 - w) * cdAtt + w * cdPlate };
}

export interface SailCoeffs extends Coeffs {
  /** 0 = fully luffing (flogging), 1 = fully drawing. */
  luff: number;
  /** 0 = attached flow, 1 = fully stalled (flat-plate behaviour). */
  stall: number;
}

/**
 * Soft-sail coefficients versus incidence magnitude a in [0, π] (angle between the airflow and the sail chord;
 * a > π/2 means the flow reaches the leech first, e.g. by the lee).
 * - Luffing: below alphaLuffStart the sail flogs (no lift, flapping drag); fully drawing above alphaFull.
 * - Drawing: lift rises to clMax at alphaPeak, then blends to flat-plate behaviour (drag device downwind).
 */
export function sailCoefficients(incidence: number, p: SailCoeffParams): SailCoeffs {
  const a = Math.abs(incidence);
  const folded = Math.min(a, Math.PI - a);
  const luff = smoothstep(p.alphaLuffStart, p.alphaFull, folded);
  const t = Math.min(a / p.alphaPeak, 1);
  const clAtt = p.clMax * Math.sin((t * Math.PI) / 2);
  const cdAtt = p.cd0 + (clAtt * clAtt) / (Math.PI * p.effectiveAR);
  const s = Math.sin(a);
  const c = Math.cos(a);
  const cn = plateCn(p.cn90, s);
  const clPlate = cn * c;
  const cdPlate = p.cd0 + cn * s;
  const w = smoothstep(p.alphaPeak, p.alphaPeak + p.stallWidth, a);
  const clDraw = (1 - w) * clAtt + w * clPlate;
  const cdDraw = (1 - w) * cdAtt + w * cdPlate;
  return { cl: luff * clDraw, cd: luff * cdDraw + (1 - luff) * p.cdFlap, luff, stall: w };
}
