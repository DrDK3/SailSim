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
