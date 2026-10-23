import type { LocalPoint } from './types';
import { hypot2 } from '../math/hypot';

/** Plane geometry in the local frame (n north, e east). Orientation: +x = east, +y = north. */

export const sub = (a: LocalPoint, b: LocalPoint): LocalPoint => ({ n: a.n - b.n, e: a.e - b.e });
export const dist = (a: LocalPoint, b: LocalPoint): number => hypot2(a.n - b.n, a.e - b.e);
/** z-component of (b − a) × (p − a) with x = e, y = n: > 0 when p is to the left of a→b. */
export function cross(a: LocalPoint, b: LocalPoint, p: LocalPoint): number {
  return (b.e - a.e) * (p.n - a.n) - (b.n - a.n) * (p.e - a.e);
}

/** Bearing angle from a to b in the math sense (atan2(Δn, Δe)); counter-clockwise positive. */
export const angleTo = (a: LocalPoint, b: LocalPoint): number => Math.atan2(b.n - a.n, b.e - a.e);

/**
 * Where segment p0→p1 crosses segment a→b: the parameter s ∈ [0, 1] along p0→p1, or null. Touching an end of
 * a→b counts; collinear overlaps do not.
 */
export function segmentCrossing(p0: LocalPoint, p1: LocalPoint, a: LocalPoint, b: LocalPoint): number | null {
  const d0 = cross(a, b, p0);
  const d1 = cross(a, b, p1);
  if ((d0 > 0 && d1 > 0) || (d0 < 0 && d1 < 0) || d0 === d1) return null;
  const s = d0 / (d0 - d1);
  const q = { n: p0.n + (p1.n - p0.n) * s, e: p0.e + (p1.e - p0.e) * s };
  // Position of q along a→b.
  const len2 = (b.n - a.n) ** 2 + (b.e - a.e) ** 2;
  const u = len2 > 0 ? ((q.n - a.n) * (b.n - a.n) + (q.e - a.e) * (b.e - a.e)) / len2 : -1;
  return u >= 0 && u <= 1 ? s : null;
}

export function pointSegmentDistance(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const len2 = (b.n - a.n) ** 2 + (b.e - a.e) ** 2;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.n - a.n) * (b.n - a.n) + (p.e - a.e) * (b.e - a.e)) / len2)) : 0;
  return hypot2(p.n - (a.n + (b.n - a.n) * u), p.e - (a.e + (b.e - a.e) * u));
}

export function segmentSegmentDistance(p0: LocalPoint, p1: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  if (segmentCrossing(p0, p1, a, b) !== null) return 0;
  return Math.min(pointSegmentDistance(p0, a, b), pointSegmentDistance(p1, a, b), pointSegmentDistance(a, p0, p1), pointSegmentDistance(b, p0, p1));
}

export function pointInPolygon(p: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.n > p.n !== b.n > p.n && p.e < ((b.e - a.e) * (p.n - a.n)) / (b.n - a.n) + a.e) inside = !inside;
  }
  return inside;
}

/** Does segment a→b enter the polygon (cross an edge or lie inside)? */
export function segmentTouchesPolygon(a: LocalPoint, b: LocalPoint, ring: LocalPoint[]): boolean {
  if (pointInPolygon(a, ring) || pointInPolygon(b, ring)) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segmentCrossing(a, b, ring[j]!, ring[i]!) !== null) return true;
  return false;
}

export function polylineDistance(p: LocalPoint, line: LocalPoint[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, pointSegmentDistance(p, line[i]!, line[i + 1]!));
  return d;
}

export function segmentPolylineDistance(a: LocalPoint, b: LocalPoint, line: LocalPoint[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segmentSegmentDistance(a, b, line[i]!, line[i + 1]!));
  return d;
}

export const midpoint = (a: LocalPoint, b: LocalPoint): LocalPoint => ({ n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 });
