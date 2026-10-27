import { clamp } from '../math/angles';
import type { BoatParams, SailParams } from './params';

/**
 * Flattening the sails to depower in a breeze: cunningham and outhaul on, kicker on hard so the mast bends,
 * and the leech allowed to twist open at the head. One control, 0 = full power (as set for light and moderate
 * winds) … 1 = as flat as the rig allows. A flatter, twisted sail gives less lift at every incidence, a little
 * less profile drag, and carries its force lower down, so it heels the boat less for the drive it gives.
 *
 * The three effects at full flattening are estimates (E): there are no Squib sail data
 * (docs/MISSING_INFORMATION.md B4), and the amounts are of the order a sail designer would expect from
 * taking a mainsail from deep to flat, not measurements.
 */
export const FLATTEN = {
  /** Fraction of maximum lift lost when fully flat (E). */
  clMaxDrop: 0.3,
  /** Fraction of profile drag lost when fully flat (E). */
  cd0Drop: 0.2,
  /** Fraction by which the centre of effort comes down when fully flat and twisted (E). */
  ceHeightDrop: 0.1,
  /** How fast the crew can flatten or power up: full travel in about 4 s (E). */
  ratePerS: 0.25,
} as const;

function flattenSail(p: SailParams, f: number): SailParams {
  return {
    ...p,
    ceHeight: p.ceHeight * (1 - FLATTEN.ceHeightDrop * f),
    coeff: { ...p.coeff, clMax: p.coeff.clMax * (1 - FLATTEN.clMaxDrop * f), cd0: p.coeff.cd0 * (1 - FLATTEN.cd0Drop * f) },
  };
}

const cache = new WeakMap<BoatParams, Map<number, BoatParams>>();

/**
 * The boat's parameters with the sails flattened by `f` (0…1). `f` is taken in steps of 1% so that the result
 * can be cached (one object per step, per boat type) and runs stay bit-reproducible; 0 returns `p` itself.
 */
export function flattenedParams(p: BoatParams, f: number): BoatParams {
  const k = Math.round(clamp(f, 0, 1) * 100);
  if (k === 0) return p;
  let byStep = cache.get(p);
  if (!byStep) cache.set(p, (byStep = new Map()));
  let q = byStep.get(k);
  if (!q) {
    q = { ...p, main: flattenSail(p.main, k / 100), jib: flattenSail(p.jib, k / 100) };
    byStep.set(k, q);
  }
  return q;
}
