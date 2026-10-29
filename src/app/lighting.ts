import { sunPosition } from '../sim/env/sun';
import type { SkyPreset } from '../sim/env/sky';

/**
 * Lighting presets: a time of day and a sky for the scenario's date at the River Dart, found from the sun's
 * real position (src/sim/env/sun.ts), not from a clock, so they suit any date. Choosing one restarts the
 * scenario at that time: the tide and the light stay together, and the wind is kept.
 */
export type LightingPreset = 'morning' | 'midday' | 'golden' | 'overcast';

export const LIGHTING_PRESETS: { id: LightingPreset; label: string; detail: string }[] = [
  { id: 'morning', label: 'Clear morning', detail: 'sun about 20° up in the east, clear sky' },
  { id: 'midday', label: 'Bright midday', detail: 'sun at its highest, clear sky' },
  { id: 'golden', label: 'Golden hour', detail: 'sun about 6° up in the west, clear sky' },
  { id: 'overcast', label: 'Overcast', detail: 'midday under a grey overcast' },
];

/** The UTC start time and sky for a preset on the date of `startTime` (ISO) at (lat, lon). */
export function lightingStart(startTime: string, preset: LightingPreset, lat: number, lon: number): { startTime: string; sky: SkyPreset } {
  const day = new Date(startTime);
  const d0 = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  // The sun's elevation through the day, a minute at a time (UTC).
  const el = (m: number) => sunPosition(d0 + m * 60_000, lat, lon).elevationDeg;
  let noon = 0;
  let best = -90;
  for (let m = 0; m < 1440; m += 5) {
    const e = el(m);
    if (e > best) {
      best = e;
      noon = m;
    }
  }
  const at = (m: number) => new Date(d0 + Math.round(m) * 60_000).toISOString().replace('.000Z', 'Z');
  // The minute before or after noon when the sun crosses `target` degrees (or noon if it never gets that high).
  const crossing = (target: number, dir: -1 | 1) => {
    let m = noon;
    while (m > 0 && m < 1439 && el(m) > target) m += dir;
    return m;
  };
  switch (preset) {
    case 'morning':
      return { startTime: at(crossing(Math.min(20, best - 1), -1)), sky: 'clear' };
    case 'midday':
      return { startTime: at(noon), sky: 'clear' };
    case 'golden':
      return { startTime: at(crossing(Math.min(6, best - 1), 1)), sky: 'clear' };
    case 'overcast':
      return { startTime: at(noon), sky: 'overcast' };
  }
}
