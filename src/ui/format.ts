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

/**
 * VMG as shown (review #19): progress straight up the wind (true wind forward of the beam) or straight down it (abaft),
 * always a positive number; the side follows the wind angle, so a beam reach does not flicker between the two.
 */
export function vmgShown(vmg: number, twa: number): { label: string; kn: number; title: string } {
  const up = Math.abs(twa) < Math.PI / 2;
  return {
    label: up ? 'VMG upwind' : 'VMG downwind',
    kn: Math.max(0, up ? vmg : -vmg),
    title: up ? 'Velocity made good upwind: how fast you are getting straight towards the wind' : 'Velocity made good downwind: how fast you are getting straight away from the wind',
  };
}

/** Where the wind comes from, in words (Learn): "40° to starboard", "dead ahead", "dead behind". */
export function windFromWords(rad: number): string {
  const d = Math.round(Math.abs((rad * 180) / Math.PI));
  if (d <= 2) return 'dead ahead';
  if (d >= 178) return 'dead behind';
  return `${d}° to ${rad > 0 ? 'starboard' : 'port'}`;
}
