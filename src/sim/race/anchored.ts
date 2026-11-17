import { wrapPi, smoothstep } from '../math/angles';
import { hypot2 } from '../math/hypot';
import { windFrom } from '../boat/forces';
import type { Environment } from '../env/environment';
import { hullOutline, type Outline } from './hull';
import { trotHeading } from '../env/trots';

/**
 * Boats that lie to an anchor or a mooring: the committee boat at the end of the starting line and the boats
 * on moorings (swinging, or fore and aft on the trots). One set of pose functions serves both the physics (contact) and the picture, so what is drawn
 * is what a boat hits (comprehensive review, CO-3 and CO-4).
 *
 * How such a boat lies (E): head to the stream when it runs, head to the wind in slack water, blended between
 * the two as the stream rises from 0.03 to 0.15 m/s. "The wind" here is the base wind (the forecast or the
 * set wind, without gusts and oscillating shifts): a boat at anchor answers the mean wind, not each puff.
 * Everything is a pure function of time, so the renderer and the physics agree at any moment.
 */

/** The committee boat: SAMARITAN, a Southerly 110 (owner's photograph; LOA and beam from listings). */
export const COMMITTEE_BOAT = { name: 'SAMARITAN', loa: 10.82, beam: 3.57 };

/** Stream speeds (m/s) between which a boat turns from lying to the wind to lying to the stream (E). */
export const LIE_TO_STREAM = { from: 0.03, to: 0.15 };

/** The committee boat's hull outline, centred on the mark (the end of the line), bow along +x. */
export const COMMITTEE_OUTLINE: Outline = hullOutline(COMMITTEE_BOAT.loa, COMMITTEE_BOAT.beam);

/**
 * Where the base wind comes from at a point (rad, compass). Uses the wind field's base when there is one
 * (gusts and shifts excluded), else the environment's wind (uniform and steady environments).
 */
export function baseWindFrom(env: Environment, t: number, n: number, e: number): number {
  const base = env.windField?.base;
  if (base) return base.at(n, e, t).fromDir;
  return windFrom(env.wind(t, n, e)).fromDir;
}

/**
 * Heading (rad, compass) of a boat lying to an anchor or a mooring at (n, e), at time t. `swing` (rad) turns
 * her from the wind in slack water, as boats on a trot never lie quite parallel.
 */
export function lyingHeading(env: Environment, t: number, n: number, e: number, swing = 0): number {
  const toWind = baseWindFrom(env, t, n, e) + swing;
  const c = env.current(t, n, e);
  const w = smoothstep(LIE_TO_STREAM.from, LIE_TO_STREAM.to, hypot2(c.n, c.e));
  if (w <= 0) return wrapPi(toWind);
  const toStream = Math.atan2(-c.e, -c.n);
  return wrapPi(toWind + w * wrapPi(toStream - toWind));
}

/** The swing (deg) of the boat on a mooring in slack water, from the layout's per-mooring number `h`. */
export function mooringSwingDeg(h: number): number {
  return (h % 30) - 15;
}

/**
 * Where a moored boat lies. On a swinging mooring: on her heading, downstream (or downwind) of her buoy, at the end of
 * her chain. On a trot (`area` one of src/sim/env/trots.ts TROT_AREAS, from Dart Haven Marina up to the Higher
 * Ferry): fore and aft between her two buoys, centred on her mooring, along her row whatever the wind and stream.
 */
export function mooredBoatPose(m: { n: number; e: number; l: number; swingDeg?: number; area?: string }, env: Environment, t: number): { n: number; e: number; heading: number } {
  const trot = trotHeading(m.area);
  if (trot !== undefined) return { n: m.n, e: m.e, heading: trot };
  const heading = lyingHeading(env, t, m.n, m.e, ((m.swingDeg ?? 0) * Math.PI) / 180);
  const back = m.l * 0.5 + 2;
  return { n: m.n - Math.cos(heading) * back, e: m.e - Math.sin(heading) * back, heading };
}

/** The committee boat's heading at time t (she pivots about the mark at the end of the line, E). */
export function committeeHeading(env: Environment, t: number, n: number, e: number): number {
  return lyingHeading(env, t, n, e);
}
