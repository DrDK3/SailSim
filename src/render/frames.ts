/**
 * The only place that knows about Three.js axes.
 * Simulation world: North-East-Down metres. Three.js: y up, x = east, z = south (north is -z).
 * Boat model local frame: x = starboard, y = up, z = aft (bow points to -z).
 */
import type { Object3D } from 'three';

export function nedToThree(n: number, e: number, up = 0): [number, number, number] {
  return [e, up, -n];
}

/** Orient a boat-model object for compass heading ψ (rad) and heel φ (rad, > 0 to starboard). */
export function orientBoat(obj: Object3D, heading: number, heel: number, pitch = 0): void {
  obj.rotation.order = 'YXZ';
  obj.rotation.set(pitch, -heading, -heel);
}

/** Interpolate between two compass angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Heave (m), pitch (rad, > 0 bow up) and wave roll (rad, > 0 to starboard) of a hull on the drawn sea. */
export interface WaveRide {
  heave: number;
  pitch: number;
  roll: number;
}

// Sample points over the waterplane: along the hull (m, > 0 forward) and across it (m, > 0 to starboard).
const RIDE_S = [-2.2, -1.1, 0, 1.1, 2.2];
const RIDE_T = [-0.7, 0, 0.7];
const RIDE_SS = RIDE_T.length * RIDE_S.reduce((a, s) => a + s * s, 0);
const RIDE_TT = RIDE_S.length * RIDE_T.reduce((a, t) => a + t * t, 0);
/** Share of the sea's cross slope a keelboat rolls to (her keel and inertia resist it): a visual choice, E. */
const ROLL_FOLLOW = 0.6;

/**
 * How a hull floats on the drawn sea (visual only: the physics does not see the waves yet, issue 51). The
 * plane fitted by least squares to the surface over the waterplane gives the heave, pitch and cross slope,
 * so the hull rides the waves rather than crests running through it. `height` is the water surface at a
 * Three.js (x, z); `heading` the compass heading (rad).
 */
export function rideWaves(height: (x: number, z: number) => number, x: number, z: number, heading: number, out: WaveRide): WaveRide {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const sx = Math.cos(heading);
  const sz = Math.sin(heading);
  let sum = 0;
  let hs = 0;
  let ht = 0;
  for (const s of RIDE_S) {
    for (const t of RIDE_T) {
      const h = height(x + fx * s + sx * t, z + fz * s + sz * t);
      sum += h;
      hs += h * s;
      ht += h * t;
    }
  }
  out.heave = sum / (RIDE_S.length * RIDE_T.length);
  out.pitch = Math.atan(hs / RIDE_SS);
  // The higher side lifts: water rising to starboard rolls the boat to port.
  out.roll = -ROLL_FOLLOW * Math.atan(ht / RIDE_TT);
  return out;
}

/** Ease a ride towards a new one (a hull's inertia: about a tenth of a second). */
export function easeRide(ride: WaveRide, to: WaveRide, dt: number, first: boolean): void {
  const k = first ? 1 : 1 - Math.exp(-Math.max(0, dt) / 0.12);
  ride.pitch += (to.pitch - ride.pitch) * k;
  ride.roll += (to.roll - ride.roll) * k;
  ride.heave = to.heave;
}
