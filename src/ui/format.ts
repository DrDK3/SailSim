import { msToKn } from '../sim/units';

export const kn = (ms: number, d = 1): string => msToKn(ms).toFixed(d);
export const deg = (rad: number, d = 0): string => ((rad * 180) / Math.PI).toFixed(d);
/** Compass bearing as 000–359. */
export const bearing = (rad: number): string => {
  const v = Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360) % 360;
  return v.toString().padStart(3, '0');
};
/** Signed angle with side, e.g. "45° stbd". Positive = from starboard. */
export const sideAngle = (rad: number): string => {
  const d = Math.round((rad * 180) / Math.PI);
  if (d === 0 || Math.abs(d) === 180) return `${Math.abs(d)}°`;
  return `${Math.abs(d)}° ${d > 0 ? 'stbd' : 'port'}`;
};
export const pct = (x: number): string => `${Math.round(x * 100)}%`;
