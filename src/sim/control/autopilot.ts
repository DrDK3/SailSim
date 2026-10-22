import { clamp, wrapPi } from '../math/angles';
import { bodyToWorld, windFrom } from '../boat/forces';
import type { Simulation } from '../simulation';

/**
 * Simple PD helmsman used by tests, scenarios and (later) AI boats. It only moves the helm; it never
 * touches the boat state directly, so the physics stays in charge.
 *  - heading mode: hold a compass heading (rad).
 *  - twa mode: hold a true wind angle relative to the water (rad, > 0 = wind from starboard).
 */
export interface AutopilotSettings {
  mode: 'heading' | 'twa';
  target: number;
  kp?: number;
  kd?: number;
}

/** True wind angle relative to the water at the boat's current position. */
export function trueWindAngle(sim: Simulation): number {
  const s = sim.state;
  const wind = sim.env.wind(sim.time, s.n, s.e);
  const cur = sim.env.current(sim.time, s.n, s.e);
  return wrapPi(windFrom({ n: wind.n - cur.n, e: wind.e - cur.e }).fromDir - s.psi);
}

export function autopilotHelm(sim: Simulation, ap: AutopilotSettings): number {
  const kp = ap.kp ?? 2.0;
  const kd = ap.kd ?? 1.2;
  const s = sim.state;
  // Heading error: positive means the bow should turn to starboard.
  const err = ap.mode === 'heading' ? wrapPi(ap.target - s.psi) : -wrapPi(ap.target - trueWindAngle(sim));
  return clamp(kp * err - kd * s.r, -1, 1);
}

/** Velocity through the water projected on a compass direction (m/s). */
export function speedAlong(sim: Simulation, dir: number): number {
  const through = bodyToWorld(sim.state.u, sim.state.v, sim.state.psi);
  return through.n * Math.cos(dir) + through.e * Math.sin(dir);
}
