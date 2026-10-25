import { G, RHO_WATER } from '../units';
import type { CockpitParams } from './params';

/**
 * Water in the cockpit (kg). Squibs differ here by build: since the Rondar build the cockpit is self-draining
 * (water runs out through the transom), while Hunter and Parker boats keep it until the crew bails it
 * (docs/SOURCES.md C9, C10). Shipped water makes the boat heavier and, because it runs to the low side, more
 * tender. All rates and dimensions are estimates (data/boats/squib/calibration.json, section cockpit).
 */

/** Depth of a point of the hull section (y outboard, z above the waterline) below the water at heel phi (m, > 0 = under). */
function immersion(y: number, z: number, phi: number): number {
  return y * Math.sin(Math.abs(phi)) - z * Math.cos(phi);
}

/** Height of the water over the leeward rail (m, > 0 when the rail is under) at heel phi. */
export function railImmersion(c: CockpitParams, phi: number): number {
  return immersion(c.deckEdgeY, c.deckEdgeZ, phi);
}

/** Heel at which the leeward rail reaches the water (rad). */
export function railUnderHeel(c: CockpitParams): number {
  return Math.atan2(c.deckEdgeZ, c.deckEdgeY);
}

/** Heel at which the leeward edge of the cockpit reaches the water (rad): beyond it the cockpit floods. */
export function cockpitEdgeUnderHeel(c: CockpitParams): number {
  return Math.atan2(c.cockpitEdgeZ, c.cockpitEdgeY);
}

/** Flow over a broad-crested weir of length L at head h (kg/s): Q = C·L·h^1.5. */
function weir(c: CockpitParams, h: number): number {
  return h > 0 ? RHO_WATER * c.weirCoefficient * c.inflowLength * h * Math.sqrt(h) : 0;
}

/**
 * Green water coming into the cockpit (kg/s): over its leeward edge once that is under (a knockdown), and,
 * while only the rail is buried, a fraction of what runs onto the side deck slopping on into the cockpit.
 */
export function greenWaterInflow(c: CockpitParams, phi: number): number {
  const rail = railImmersion(c, phi) - c.toeRail;
  if (rail <= 0) return 0;
  return weir(c, immersion(c.cockpitEdgeY, c.cockpitEdgeZ, phi)) + c.railSlop * weir(c, rail);
}

/**
 * Spray and slop shipped when sailing into waves (kg/s): grows with the significant wave height above a
 * threshold and with speed, and only when the waves come from ahead of the beam (cosHead > 0: 1 = head-on).
 */
export function sprayInflow(c: CockpitParams, hs: number, stw: number, cosHead: number): number {
  const over = hs - c.sprayStartHs;
  if (over <= 0 || cosHead <= 0 || stw <= 0) return 0;
  return c.sprayRate * over * (stw / 2) * cosHead;
}

/**
 * Water leaving (kg/s): through the transom outlets of a self-draining cockpit (orifice flow driven by the
 * depth of water on the floor), or bailed by the crew once there is enough to be worth it.
 */
export function outflow(c: CockpitParams, water: number): number {
  if (water <= 0) return 0;
  if (c.selfDraining) {
    const depth = water / RHO_WATER / (c.soleWidth * c.soleLength);
    return RHO_WATER * 0.61 * c.drainArea * Math.sqrt(2 * G * depth);
  }
  return water > c.bailStart ? c.bailRate : 0;
}

/** One explicit step of the water in the boat (kg), clamped to [0, capacity]. */
export function stepWater(c: CockpitParams, water: number, inflow: number, dt: number): number {
  const into = water < c.capacity ? inflow : 0;
  const next = water + (into - outflow(c, water)) * dt;
  return Math.min(c.capacity, Math.max(0, next));
}

/**
 * Lateral position (m, > 0 to starboard) of the centre of the shipped water at heel phi. Its surface stays
 * level, so it runs to the low side of the floor: a tilted slab while it still covers the floor
 * (offset b² tanφ / 12h), then a wedge against the side (offset b/2 − w/3, w = √(2hb / tanφ)).
 */
export function waterOffset(c: CockpitParams, water: number, phi: number): number {
  if (water <= 0) return 0;
  const b = c.soleWidth;
  const h = water / RHO_WATER / (b * c.soleLength);
  const t = Math.abs(Math.tan(Math.max(-1.4, Math.min(1.4, phi))));
  if (t < 1e-9) return 0;
  const y = t * b < 2 * h ? (b * b * t) / (12 * h) : b / 2 - Math.sqrt((2 * h * b) / t) / 3;
  return Math.sign(phi) * Math.min(b / 2, y);
}

/**
 * Heeling moment (N m, same sign as the heel) of the shipped water's weight about the dry boat's centre of
 * gravity: it sits above the CG on the cockpit floor and runs to the low side. (The hull carries the extra
 * displacement at the same righting arm; that part is added where the righting moment is.)
 */
export function waterHeelMoment(c: CockpitParams, water: number, phi: number): number {
  if (water <= 0) return 0;
  return water * G * (waterOffset(c, water, phi) * Math.cos(phi) + c.soleAboveCG * Math.sin(phi));
}
