import { sunPosition } from '../sim/env/sun';

/**
 * When a yacht club flies its ensign (colours): hoisted at 0800 from 25 March to 20 September and at 0900 the
 * rest of the year, local time, and lowered at sunset (PBO and club flag etiquette, docs/SOURCES.md). Local
 * time in Devon is GMT, or BST (GMT+1) from 01:00 GMT on the last Sunday in March to 01:00 GMT on the last
 * Sunday in October.
 */

/** Last Sunday of a month (0-based) in a year, as a UTC day of the month. */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** Hours UK local time is ahead of UTC at an instant: 1 in British Summer Time, else 0. */
export function ukUtcOffsetHours(epochMs: number): 0 | 1 {
  const y = new Date(epochMs).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return epochMs >= start && epochMs < end ? 1 : 0;
}

/** The hoisting time (local hours) for the day: 8 from 25 March to 20 September, else 9. */
export function coloursHour(epochMs: number): number {
  const local = new Date(epochMs + ukUtcOffsetHours(epochMs) * 3600e3);
  const md = (local.getUTCMonth() + 1) * 100 + local.getUTCDate();
  return md >= 325 && md <= 920 ? 8 : 9;
}

/** Is the ensign flying at this instant, at this place (lat, lon in degrees)? */
export function coloursFlying(epochMs: number, latDeg: number, lonDeg: number): boolean {
  const local = new Date(epochMs + ukUtcOffsetHours(epochMs) * 3600e3);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (hour < coloursHour(epochMs)) return false;
  // Lowered at sunset: the sun's upper limb on the horizon (its centre 0.27° below; refraction is in the elevation).
  if (hour >= 12 && sunPosition(epochMs, latDeg, lonDeg).elevationDeg < -0.27) return false;
  // A sunset before the hoisting time (deep winter in the far north) never happens here, but stay down after it.
  return !(hour < 12 && sunPosition(epochMs, latDeg, lonDeg).elevationDeg < -0.27);
}
