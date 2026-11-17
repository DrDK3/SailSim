/**
 * How the scene's flags and vanes answer the wind (owner, 17 Nov 2026: "All flags and weather vanes should move
 * with the wind"). Presentation only: the wind is read from the simulation's wind field, never written.
 *
 *  - Direction: every flag flies downwind and every vane points into the wind *where it is* (the wind is spatial,
 *    with puffs): on a moving boat the apparent wind (the true wind less her own way), on anything moored, at
 *    anchor or ashore the true wind at that spot.
 *  - Flutter: grows with the wind's speed, near none in a calm, where a flag hangs limp (vane.ts flagDroop). With
 *    the reader's "reduce motion" setting the direction still follows the wind; the flutter is cut to a fifth and
 *    slowed. The shape of the flutter is illustrative (E).
 */
import { windFrom } from '../sim/boat/forces';

/** The true wind (velocity of the air over the ground, m/s, n and e: where it moves to) at a point now. */
export type WindAt = (n: number, e: number) => { n: number; e: number };

/** A wind as flags read it: where it comes from (rad, compass) and its speed (m/s). */
export interface FlagWind {
  fromDir: number;
  speed: number;
}

let reduced = false;

/** The reader's "reduce motion" setting (src/render/scene.ts sets it from the media query). */
export function setFlagMotionReduced(on: boolean): void {
  reduced = on;
}

export function flagMotionReduced(): boolean {
  return reduced;
}

/** The share of full flutter kept with reduced motion. */
export const REDUCED_FLUTTER = 0.2;

/**
 * Flutter for a wind (apparent, for a moving boat) of `speed` m/s: `amp`, a share of each flag's full flutter
 * (0 in a calm, about 0.06 at 1 m/s, 0.6 at 4 m/s, nearly 1 from 8 m/s), and `freq` (Hz), quickening with the wind.
 */
export function flagFlutter(speed: number, reduce = reduced): { amp: number; freq: number } {
  const s = Math.max(0, speed);
  const amp = 1 - Math.exp(-((s / 4) ** 2));
  const freq = 0.5 + 0.22 * Math.min(s, 20);
  return reduce ? { amp: amp * REDUCED_FLUTTER, freq: freq * 0.5 } : { amp, freq };
}

/**
 * A rigid flag's swing about its staff (rad): `max` at full flutter, a mix of two waves so it never looks
 * mechanical; `phase` sets flags apart.
 */
export function flagSwing(speed: number, time: number, phase: number, max = 0.12): number {
  const { amp, freq } = flagFlutter(speed);
  const w = 2 * Math.PI * freq;
  return max * amp * (0.75 * Math.sin(w * time + phase) + 0.25 * Math.sin(1.7 * w * time + 2.3 * phase));
}

/** The true wind at (n, e) from `windAt`, else the one wind given for the whole scene. */
export function trueWindAt(windAt: WindAt | undefined, n: number, e: number, fallback: FlagWind): FlagWind {
  if (!windAt) return fallback;
  return windFrom(windAt(n, e));
}

/**
 * The apparent wind on a boat moving over the ground at `sog` m/s along `heading` (rad), in a true wind `w`: where
 * it comes from (rad, compass) and its speed.
 */
export function apparentWind(w: FlagWind, heading: number, sog: number): FlagWind {
  const an = -w.speed * Math.cos(w.fromDir) - sog * Math.cos(heading);
  const ae = -w.speed * Math.sin(w.fromDir) - sog * Math.sin(heading);
  return windFrom({ n: an, e: ae });
}

/** The compass bearing (rad, 0..2π) a flag's fly points in a wind from `fromDir`: downwind. */
export function downwind(fromDir: number): number {
  const d = (fromDir + Math.PI) % (2 * Math.PI);
  return d < 0 ? d + 2 * Math.PI : d;
}
