import { G } from '../units';
import type { Seabed } from '../geo/dart';
import type { BoatParams } from './params';
import type { NE } from './forces';

/**
 * Contact with the bottom (grounding) at three points: keel tip, forefoot and rudder heel.
 *
 * A point touches when the water is shallower than its depth below the waterline (× cos φ when heeled):
 * penetration pen = depth·cos φ − (water level − bed). At each touching point:
 *  - the ground carries part of the weight, N = ρ g A_wp·pen·share (capped);
 *  - Coulomb friction μN opposes the point's velocity over the ground (smoothed near zero speed);
 *  - a viscous term C·min(pen / 0.05 m, 1) ploughs into soft mud;
 *  - on a slope, N·slope pushes the boat down-slope (back towards deeper water).
 * Forces act horizontally at the point; they give yaw and roll moments (roll arm = depth below the
 * waterline). There is no heave or pitch, so the boat does not lift as it grounds. Rising water floats it off.
 */
export interface GroundContext {
  /** Water level, m above Ordnance Datum Newlyn. */
  waterLevel: number;
  seabed: Seabed;
}

export interface ContactPointState {
  name: 'keel' | 'bow' | 'stern';
  /** Water depth minus the point's depth (m): > 0 clear, < 0 touching. */
  clearance: number;
}

export interface ContactForce {
  x: number;
  y: number;
  n: number;
  roll: number;
  grounded: boolean;
  /** Water depth at the keel position (m). */
  depthAtKeel: number;
  points: ContactPointState[];
}

export const NO_CONTACT: ContactForce = { x: 0, y: 0, n: 0, roll: 0, grounded: false, depthAtKeel: Infinity, points: [] };

const SHARE: Record<ContactPointState['name'], number> = { keel: 0.5, bow: 0.25, stern: 0.25 };
const RHO_WATER = 1025;

export function groundContact(
  p: BoatParams,
  s: { n: number; e: number; psi: number; u: number; v: number; r: number; phi: number; p: number },
  current: NE,
  ground: GroundContext,
): ContactForce {
  const c = Math.cos(s.psi);
  const sn = Math.sin(s.psi);
  // Current in the body frame (the ground moves at −current relative to the water).
  const cx = current.n * c + current.e * sn;
  const cy = -current.n * sn + current.e * c;
  let fx = 0;
  let fy = 0;
  let yaw = 0;
  let roll = 0;
  let grounded = false;
  let depthAtKeel = Infinity;
  const points: ContactPointState[] = [];
  for (const cp of p.contactPoints) {
    const ly = -cp.depth * Math.sin(s.phi); // the keel tip swings to windward as the boat heels
    const pn = s.n + cp.x * c - ly * sn;
    const pe = s.e + cp.x * sn + ly * c;
    const water = ground.waterLevel - ground.seabed.bedElevation(pn, pe);
    if (cp.name === 'keel') depthAtKeel = water;
    const pen = cp.depth * Math.cos(s.phi) - water;
    points.push({ name: cp.name, clearance: -pen });
    if (pen <= 0) continue;
    grounded = true;
    // Velocity of the point over the ground, body frame.
    const vx = s.u + cx;
    const vy = s.v + s.r * cp.x - s.p * cp.depth + cy;
    const sp = Math.hypot(vx, vy);
    const load = Math.min(RHO_WATER * G * p.waterplaneArea * pen * SHARE[cp.name], 2 * p.weight * SHARE[cp.name]);
    const fric = sp > 1e-9 ? (p.contactFriction * load * Math.tanh(sp / 0.05)) / sp : 0;
    const damp = p.contactDamping * Math.min(pen / 0.05, 1);
    let px = -(fric + damp) * vx;
    let py = -(fric + damp) * vy;
    const g = ground.seabed.bedGradient(pn, pe);
    const slope = Math.hypot(g.n, g.e);
    if (slope > 1e-6) {
      const push = (load * Math.min(slope, p.contactSlopeLimit)) / slope;
      // Down-slope = −∇bed, rotated into the body frame.
      px += push * (-g.n * c - g.e * sn);
      py += push * (g.n * sn - g.e * c);
    }
    fx += px;
    fy += py;
    yaw += cp.x * py;
    roll += -py * cp.depth;
  }
  return { x: fx, y: fy, n: yaw, roll, grounded, depthAtKeel, points };
}
