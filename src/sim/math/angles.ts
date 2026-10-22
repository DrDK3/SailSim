export const DEG = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

/** Wrap an angle to (-π, π]. */
export function wrapPi(a: number): number {
  let x = a % TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  else if (x > Math.PI) x -= TWO_PI;
  return x;
}

/** Wrap an angle to [0, 2π). */
export function wrap2Pi(a: number): number {
  const x = a % TWO_PI;
  return x < 0 ? x + TWO_PI : x;
}

export const toDeg = (rad: number): number => rad / DEG;
export const toRad = (deg: number): number => deg * DEG;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Hermite smoothstep: 0 below e0, 1 above e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
