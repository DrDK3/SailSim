import type { BoatParams } from '../boat/params';
import { hypot2 } from '../math/hypot';

/**
 * Hull outlines and contact geometry for the fleet.
 *
 * The Squib's deck plan is ESTIMATED (no lines plan): the same half-breadth curve as the 3D model
 * (src/render/squibModel.ts), bow 2.95 m forward of the centre of gravity, transom at 0.64 × half-beam. The
 * outline is convex, so overlaps are found with the separating-axis test.
 * Body frame: x forward, y to starboard. World frame: n north, e east.
 */
export interface Vec {
  n: number;
  e: number;
}

/** Outline vertices in the body frame, clockwise seen from above (bow, starboard side aft, port side forward). */
export interface Outline {
  x: number[];
  y: number[];
  /** Radius of a circle about the CG containing the outline (m). */
  radius: number;
}

/** Bow position forward of the CG (m), as in the 3D model. */
export const BOW_X = 2.95;

export function squibOutline(p: Pick<BoatParams, 'loa' | 'beam'>): Outline {
  const B = p.beam / 2;
  const half = (t: number) => B * (t < 0.55 ? Math.pow(Math.sin((Math.PI / 2) * (t / 0.55)), 0.75) : 1 - 0.36 * Math.pow((t - 0.55) / 0.45, 2));
  const stations = [0.08, 0.2, 0.38, 0.55, 0.78, 1];
  const x: number[] = [BOW_X];
  const y: number[] = [0];
  for (const t of stations) {
    x.push(BOW_X - t * p.loa);
    y.push(half(t));
  }
  for (let i = stations.length - 1; i >= 0; i--) {
    const t = stations[i]!;
    x.push(BOW_X - t * p.loa);
    y.push(-half(t));
  }
  let radius = 0;
  for (let i = 0; i < x.length; i++) radius = Math.max(radius, hypot2(x[i]!, y[i]!));
  return { x, y, radius };
}

/** A rectangle outline (ferries, committee boats): length along x, centred on the origin. */
export function boxOutline(length: number, beam: number): Outline {
  const a = length / 2;
  const b = beam / 2;
  return { x: [a, -a, -a, a], y: [b, b, -b, -b], radius: hypot2(a, b) };
}

/** World-frame vertices of an outline at a pose (heading = compass bearing of the body x axis). */
export function placeOutline(o: Outline, n: number, e: number, heading: number, out?: Vec[]): Vec[] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const pts = out ?? [];
  for (let i = 0; i < o.x.length; i++) {
    const x = o.x[i]!;
    const y = o.y[i]!;
    const p = pts[i] ?? (pts[i] = { n: 0, e: 0 });
    p.n = n + x * c - y * s;
    p.e = e + x * s + y * c;
  }
  pts.length = o.x.length;
  return pts;
}

export interface Contact {
  /** Penetration depth (m), > 0 when touching. */
  depth: number;
  /** Unit normal pointing from A towards B. */
  normal: Vec;
  /** Contact point (world). */
  point: Vec;
}

function project(pts: Vec[], an: number, ae: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const d = p.n * an + p.e * ae;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function insideConvex(poly: Vec[], q: Vec): boolean {
  // Vertices are clockwise seen from above (n up, e right): a point inside is to the right of every edge.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((b.e - a.e) * (q.n - a.n) - (b.n - a.n) * (q.e - a.e) > 1e-12) return false;
  }
  return true;
}

/**
 * Separating-axis test for two convex polygons (world vertices). Returns null when they do not overlap,
 * otherwise the minimum-overlap axis (pointing from A to B), the depth along it, and a contact point (the
 * mean of the vertices of each polygon that lie inside the other).
 */
export function polygonContact(A: Vec[], B: Vec[]): Contact | null {
  let best = Infinity;
  let bn = 0;
  let be = 0;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      let an = -(q.e - p.e);
      let ae = q.n - p.n;
      const len = hypot2(an, ae);
      if (len < 1e-12) continue;
      an /= len;
      ae /= len;
      const [a0, a1] = project(A, an, ae);
      const [b0, b1] = project(B, an, ae);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        bn = an;
        be = ae;
      }
    }
  }
  const ca = centroid(A);
  const cb = centroid(B);
  if ((cb.n - ca.n) * bn + (cb.e - ca.e) * be < 0) {
    bn = -bn;
    be = -be;
  }
  let sn = 0;
  let se = 0;
  let k = 0;
  for (const p of A) if (insideConvex(B, p)) { sn += p.n; se += p.e; k++; }
  for (const p of B) if (insideConvex(A, p)) { sn += p.n; se += p.e; k++; }
  const point = k > 0 ? { n: sn / k, e: se / k } : { n: (ca.n + cb.n) / 2, e: (ca.e + cb.e) / 2 };
  return { depth: best, normal: { n: bn, e: be }, point };
}

/** Contact between a convex polygon (A) and a circle (B). Normal points from the polygon towards the circle. */
export function circleContact(A: Vec[], c: Vec, r: number): Contact | null {
  // Closest point of the polygon's boundary to the centre.
  let bestD2 = Infinity;
  let cp: Vec = A[0]!;
  for (let i = 0; i < A.length; i++) {
    const a = A[i]!;
    const b = A[(i + 1) % A.length]!;
    const dn = b.n - a.n;
    const de = b.e - a.e;
    const l2 = dn * dn + de * de;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((c.n - a.n) * dn + (c.e - a.e) * de) / l2)) : 0;
    const p = { n: a.n + t * dn, e: a.e + t * de };
    const d2 = (c.n - p.n) ** 2 + (c.e - p.e) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      cp = p;
    }
  }
  const d = Math.sqrt(bestD2);
  const inside = insideConvex(A, c);
  if (!inside && d >= r) return null;
  let nn = c.n - cp.n;
  let ne = c.e - cp.e;
  const len = hypot2(nn, ne);
  if (len > 1e-9) {
    nn /= len;
    ne /= len;
  } else {
    const g = centroid(A);
    const l = hypot2(c.n - g.n, c.e - g.e) || 1;
    nn = (c.n - g.n) / l;
    ne = (c.e - g.e) / l;
  }
  if (inside) {
    nn = -nn;
    ne = -ne;
  }
  return { depth: inside ? r + d : r - d, normal: { n: nn, e: ne }, point: cp };
}

/** Smallest distance between two convex polygons (0 if they overlap). */
export function polygonDistance(A: Vec[], B: Vec[]): number {
  if (polygonContact(A, B)) return 0;
  let best = Infinity;
  const seg = (p: Vec, a: Vec, b: Vec) => {
    const dn = b.n - a.n;
    const de = b.e - a.e;
    const l2 = dn * dn + de * de;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.n - a.n) * dn + (p.e - a.e) * de) / l2)) : 0;
    return hypot2(p.n - a.n - t * dn, p.e - a.e - t * de);
  };
  for (const [P, Q] of [[A, B], [B, A]] as const) {
    for (const p of P) {
      for (let i = 0; i < Q.length; i++) best = Math.min(best, seg(p, Q[i]!, Q[(i + 1) % Q.length]!));
    }
  }
  return best;
}

function centroid(P: Vec[]): Vec {
  let n = 0;
  let e = 0;
  for (const p of P) {
    n += p.n;
    e += p.e;
  }
  return { n: n / P.length, e: e / P.length };
}
