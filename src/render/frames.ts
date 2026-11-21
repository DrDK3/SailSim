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
 * Three.js (x, z); `heading` the compass heading (rad). `size` stretches the sampled waterplane for a hull longer
 * than a Squib's (1: a Squib's), so short chop pitches a long hull less.
 */
export function rideWaves(height: (x: number, z: number) => number, x: number, z: number, heading: number, out: WaveRide, size = 1): WaveRide {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const sx = Math.cos(heading);
  const sz = Math.sin(heading);
  let sum = 0;
  let hs = 0;
  let ht = 0;
  for (const s of RIDE_S) {
    for (const t of RIDE_T) {
      const h = height(x + fx * s * size + sx * t * size, z + fz * s * size + sz * t * size);
      sum += h;
      hs += h * s;
      ht += h * t;
    }
  }
  out.heave = sum / (RIDE_S.length * RIDE_T.length);
  out.pitch = Math.atan(hs / (RIDE_SS * size));
  // The higher side lifts: water rising to starboard rolls the boat to port.
  out.roll = -ROLL_FOLLOW * Math.atan(ht / (RIDE_TT * size));
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

/**
 * Chase framing that keeps the masthead clear of the interface (review #1–#3, 20 Nov 2026: the burgee at the masthead
 * is the sailor's wind indicator, and the toolbar, notices and labels were covering it). The chase camera sits `dist`
 * behind the boat at `chaseHeight(dist)` and looks at a point `lookH` above the water at the boat. In a view `viewH`
 * px tall with a vertical field of view `fovDeg`, a point at height z and horizontal distance d appears at
 * y = viewH/2 · (1 − tan(a − p) / tan(fov/2)) from the top, where a is the point's elevation from the camera and p the
 * camera's pitch.
 *
 * Returns the look-at height and distance to use: the natural framing (`lookH` as given) when the masthead already
 * lies at least `topPx` from the top and the hull's nearest point no lower than `bottomPx`; else the pitch is raised just enough to bring the masthead down to `topPx`, but never so far
 * that the hull drops below `bottomPx`; if no pitch does both, the camera draws back (the boat smaller) until one
 * does, up to three times the distance. Geometry only: the boat's motion is unchanged.
 */
export function chaseFraming(o: {
  dist: number;
  lookH: number;
  /** Height of the masthead above the water (m). */
  mastH: number;
  fovDeg: number;
  viewH: number;
  /** The masthead must appear at least this far from the top (px). */
  topPx: number;
  /** The hull's nearest point must appear no lower than this (px from the top). */
  bottomPx: number;
  /** How much nearer the camera the hull's nearest point is than the mast (m): the stern, about 3 m. */
  hullNearer?: number;
}): { lookH: number; dist: number; fits: boolean } {
  const T = Math.tan(((o.fovDeg / 2) * Math.PI) / 180);
  const H = o.viewH;
  const near = o.hullNearer ?? 3;
  const sTop = (1 - (2 * o.topPx) / H) * T;
  const sBot = (1 - (2 * o.bottomPx) / H) * T;
  for (let k = 0, d = o.dist; k < 16; k++, d = Math.min(o.dist * 3, d * 1.08)) {
    const h = chaseHeight(d);
    const p0 = Math.atan2(o.lookH - h, d);
    const aMast = Math.atan2(o.mastH - h, d);
    const aHull = Math.atan2(0.3 - h, Math.max(1, d - near));
    // Pitch at least pMin keeps the masthead below topPx; at most pMax keeps the hull above bottomPx.
    const pMin = aMast - Math.atan(sTop);
    const pMax = aHull - Math.atan(sBot);
    if (pMin <= pMax || d >= o.dist * 3) {
      const p = pMin <= pMax ? Math.min(pMax, Math.max(pMin, p0)) : (pMin + pMax) / 2;
      return { lookH: h + d * Math.tan(p), dist: d, fits: pMin <= pMax };
    }
  }
  return { lookH: o.lookH, dist: o.dist, fits: false };
}

/** Screen position (px from the top) of a point at height `z` (m), horizontal distance `d` (m), for the chase camera. */
export function chaseScreenY(z: number, d: number, lookH: number, fovDeg: number, viewH: number): number {
  const h = chaseHeight(d);
  const T = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const r = Math.atan2(z - h, d) - Math.atan2(lookH - h, d);
  return (viewH / 2) * (1 - Math.tan(r) / T);
}

/**
 * Look up at the masthead (review #1): how far the view has moved towards the masthead (0 … 1) after `dt` seconds of
 * holding (`on`) or letting go. It eases over about 0.35 s; with reduced motion it cuts.
 */
export function lookUpBlend(u: number, on: boolean, dt: number, reduced: boolean): number {
  if (reduced) return on ? 1 : 0;
  const to = on ? 1 : 0;
  return to + (u - to) * Math.exp(-dt / 0.12);
}

/** Two screen boxes (px: left, top, right, bottom) overlap, each grown by `pad`. */
export function boxesOverlap(a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number }, pad = 0): boolean {
  return a.l - pad < b.r && a.r + pad > b.l && a.t - pad < b.b && a.b + pad > b.t;
}
