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

/**
 * The flattening controls one by one (review #25, package B3), for the Expert level: the outhaul (the foot's depth),
 * the cunningham (luff tension, the draft forward) and the kicker (the leech closed or open, the mast bent). Their
 * shares add up to FLATTEN exactly, so all three at the same setting are the "Flat" control, and that case returns
 * `flattenedParams` itself: runs that never use them are bit-identical. The shares and the jib lead's effect are
 * estimates (E), like FLATTEN (docs/PHYSICS.md §23, docs/PARAMETERS.md).
 */
export const SPLIT = {
  outhaul: { clMaxDrop: 0.15, cd0Drop: 0.1, ceHeightDrop: 0 },
  cunningham: { clMaxDrop: 0.1, cd0Drop: 0.05, ceHeightDrop: 0 },
  kicker: { clMaxDrop: 0.05, cd0Drop: 0.05, ceHeightDrop: 0.1 },
  /** Jib lead aft (+1) twists the jib open (less power, lower centre of effort); forward (−1) closes it (E). */
  jibLead: { clMaxPerUnit: 0.06, ceHeightPerUnit: 0.06 },
} as const;

const splitCache = new WeakMap<BoatParams, Map<string, BoatParams>>();

/** The boat's parameters with each flattening control set on its own (0…1) and the jib lead (−1…1). */
export function splitParams(p: BoatParams, flat: number, kicker: number, cunningham: number, outhaul: number, jibLead: number): BoatParams {
  if (kicker === flat && cunningham === flat && outhaul === flat && jibLead === 0) return flattenedParams(p, flat);
  const k = Math.round(clamp(kicker, 0, 1) * 100);
  const c = Math.round(clamp(cunningham, 0, 1) * 100);
  const o = Math.round(clamp(outhaul, 0, 1) * 100);
  const l = Math.round(clamp(jibLead, -1, 1) * 10);
  const key = `${k},${c},${o},${l}`;
  let byKey = splitCache.get(p);
  if (!byKey) splitCache.set(p, (byKey = new Map()));
  let q = byKey.get(key);
  if (!q) {
    const kf = k / 100;
    const cf = c / 100;
    const of = o / 100;
    const lf = l / 10;
    const clDrop = SPLIT.outhaul.clMaxDrop * of + SPLIT.cunningham.clMaxDrop * cf + SPLIT.kicker.clMaxDrop * kf;
    const cdDrop = SPLIT.outhaul.cd0Drop * of + SPLIT.cunningham.cd0Drop * cf + SPLIT.kicker.cd0Drop * kf;
    const ceDrop = SPLIT.kicker.ceHeightDrop * kf;
    const main: SailParams = { ...p.main, ceHeight: p.main.ceHeight * (1 - ceDrop), coeff: { ...p.main.coeff, clMax: p.main.coeff.clMax * (1 - clDrop), cd0: p.main.coeff.cd0 * (1 - cdDrop) } };
    // The jib has no outhaul or kicker of its own: it flattens with the three together (their mean), and its lead.
    const jf = flattenSail(p.jib, Math.round((k + c + o) / 3) / 100);
    const jib: SailParams = {
      ...jf,
      ceHeight: jf.ceHeight * (1 - SPLIT.jibLead.ceHeightPerUnit * lf),
      coeff: { ...jf.coeff, clMax: jf.coeff.clMax * (1 - SPLIT.jibLead.clMaxPerUnit * lf) },
    };
    q = { ...p, main, jib };
    byKey.set(key, q);
  }
  return q;
}

