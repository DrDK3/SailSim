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

/** Where the helm view may look: yaw ±150° (over either shoulder), pitch from the cockpit floor to the masthead. */
export const HELM_LOOK = { maxYaw: (150 * Math.PI) / 180, minPitch: (-50 * Math.PI) / 180, maxPitch: (60 * Math.PI) / 180 };

/** Clamp a helm-view look direction (yaw > 0 to starboard, pitch > 0 up) to what a seated helm can see. */
export function clampHelmLook(yaw: number, pitch: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.max(-HELM_LOOK.maxYaw, Math.min(HELM_LOOK.maxYaw, yaw)),
    pitch: Math.max(HELM_LOOK.minPitch, Math.min(HELM_LOOK.maxPitch, pitch)),
  };
}

/**
 * Unit look direction in the boat model's frame (x starboard, y up, z aft) for a head turned by `yaw`
 * (> 0 towards starboard) and tilted by `pitch` (> 0 up): straight ahead is (0, 0, -1).
 */
export function helmLookDir(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** The lowest a free camera may fly over ground of height `ground` (m): never below the water or a hilltop. */
export function cameraFloor(ground: number, waterLevel = 0): number {
  return Math.max(waterLevel, ground) + 6;
}

/**
 * The height (m) the chase and scenic cameras follow: a slow average of the hull's heave on the waves, with a
 * share `motion` (0 … 1, the settings' camera motion) of the wave-by-wave heave added back. At 0 the horizon
 * stays still while the boat rides the waves in the picture; at 1 the camera rides with her (half of each wave).
 */
export function followHeave(smoothed: number, raw: number, motion: number): number {
  return smoothed + (raw - smoothed) * 0.5 * Math.min(1, Math.max(0, motion));
}

/** Chase camera: how high above the water (m) for a distance behind the boat (m): the same view angle as at 15 m. */
export function chaseHeight(distance: number): number {
  return 5.5 * (distance / 15);
}

/**
 * Scenic camera: a slow circle round the boat (one turn in six minutes), low over the water and well off,
 * swinging in and out a little: bearing from the boat (rad, compass), distance (m) and height (m) at time t (s).
 */
export function scenicPose(t: number): { bearing: number; distance: number; height: number } {
  return {
    bearing: (t * 2 * Math.PI) / 360 + 0.6,
    distance: 30 + 6 * Math.sin(t * 0.021),
    height: 2.6 + 1.2 * (0.5 + 0.5 * Math.sin(t * 0.013 + 1)),
  };
}
