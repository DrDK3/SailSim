import { DEG } from '../math/angles';
import { knToMs } from '../units';
import { windVelocity, type NE } from '../boat/forces';

/**
 * The boat's surroundings. Phase 1 provides uniform, steady fields; later phases add gusts, shifts,
 * spatial variation, live data and tidal currents behind the same interface.
 */
export interface Environment {
  /** True wind velocity over the ground at a point (where the air moves to), m/s. */
  wind(t: number, n: number, e: number): NE;
  /** Current (water velocity over ground), m/s. */
  current(t: number, n: number, e: number): NE;
  /** Human-readable provenance for the UI, e.g. "Manual scenario". */
  readonly label: string;
}

export interface UniformConditions {
  twsKn: number;
  /** Direction the wind blows FROM, degrees true. */
  twdDeg: number;
  /** Direction the current flows TOWARDS (nautical "set"), degrees true. */
  currentSetDeg?: number;
  currentRateKn?: number;
}

export function uniformEnvironment(c: UniformConditions, label = 'Manual scenario (uniform, steady)'): Environment {
  const wind = windVelocity(knToMs(c.twsKn), c.twdDeg * DEG);
  const rate = knToMs(c.currentRateKn ?? 0);
  const set = (c.currentSetDeg ?? 0) * DEG;
  const current = { n: rate * Math.cos(set), e: rate * Math.sin(set) };
  return { wind: () => wind, current: () => current, label };
}
