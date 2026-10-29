import type { PierFeature } from './marinas';
import { PierGrid, pierPieces } from '../race/piers';
import { boxOutline, placeOutline, polygonContact } from '../race/hull';

/**
 * Where the river boats lie at their landings: alongside the pier at the end of their route, not across it.
 * The OSM routes end on a pier's edge (the South Embankment's Town Jetty takes four routes and the paddle
 * steamer), so a boat stopping at the end point would lie half across the pier, and boats sharing a landing
 * would lie on top of each other. Here each route end (a "claim") is matched to the nearest pier edge facing the
 * way the boat comes in; the boats claiming one edge are laid out along it in order, 2 m apart; a boat that does
 * not fit lies alongside the one nearest its place (rafted, as river boats do). A boat lies parallel to the edge,
 * fendered 0.6 m off it, heading the way nearer its approach. The layout is a rule (E); the landings are OSM's.
 */

export interface LandingClaim {
  /** Unique key (e.g. the service and its end). */
  key: string;
  /** The route's end point (e, n). */
  at: [number, number];
  /** A point the boat comes in from (e.g. the route's second-last point). */
  from: [number, number];
  length: number;
  beam: number;
}

export interface LandingPose {
  n: number;
  e: number;
  /** Compass heading (rad). */
  heading: number;
}

/** How far a route end may be from a pier edge to count as its landing (m, E). */
export const LANDING_REACH_M = 15;
/** Between boats along an edge, and between a boat's side and the pier (m, E). */
const GAP_M = 2;
const FENDER_M = 0.6;

interface Edge {
  a: [number, number];
  len: number;
  /** Unit along the edge (e, n). */
  u: [number, number];
  /** Unit normal to the water side (e, n). */
  w: [number, number];
}

/** The edges boats can lie against, each with its water side: both sides of a line pier, an outline's edges. */
function pierEdges(piers: readonly PierFeature[]): Edge[] {
  const out: Edge[] = [];
  const push = (a: [number, number], b: [number, number], w: [number, number]) => {
    const de = b[0] - a[0];
    const dn = b[1] - a[1];
    const len = Math.hypot(de, dn);
    if (len < 2) return;
    out.push({ a, len, u: [de / len, dn / len], w });
  };
  for (const p of piers) {
    if ('line' in p) {
      const h = p.width / 2;
      for (let k = 1; k < p.line.length; k++) {
        const [a, b] = [p.line[k - 1]!, p.line[k]!];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nrm: [number, number] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        for (const s of [1, -1]) {
          const off = (q: [number, number]): [number, number] => [q[0] + nrm[0] * h * s, q[1] + nrm[1] * h * s];
          push(off(a), off(b), [nrm[0] * s, nrm[1] * s]);
        }
      }
    } else {
      const ring = p.poly;
      // Outward normals: the ring's winding decides which side is outside.
      let area = 0;
      for (let k = 0; k < ring.length; k++) {
        const [a, b] = [ring[k]!, ring[(k + 1) % ring.length]!];
        area += a[0] * b[1] - b[0] * a[1];
      }
      const ccw = area > 0;
      for (let k = 0; k < ring.length; k++) {
        const [a, b] = [ring[k]!, ring[(k + 1) % ring.length]!];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Right of a→b is outside for an anticlockwise ring.
        const right: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        push(a, b, ccw ? right : [-right[0], -right[1]]);
      }
    }
  }
  return out;
}

/** The poses of all claims that have a landing (claims with no pier edge near their end are left out). */
export function landingBerths(claims: readonly LandingClaim[], piers: readonly PierFeature[]): Map<string, LandingPose> {
  const edges = pierEdges(piers);
  const grid = new PierGrid(pierPieces(piers.map((p) => ({ ...p, name: p.name }))));
  // Each claim's edge: within reach of its end, facing the way it comes in; the nearest.
  const byEdge = new Map<number, { c: LandingClaim; t: number }[]>();
  for (const c of claims) {
    let best = -1;
    let bestD = LANDING_REACH_M;
    let bestT = 0;
    edges.forEach((ed, i) => {
      const x = c.at[0] - ed.a[0];
      const y = c.at[1] - ed.a[1];
      const t = Math.min(ed.len, Math.max(0, x * ed.u[0] + y * ed.u[1]));
      const d = Math.hypot(c.at[0] - (ed.a[0] + ed.u[0] * t), c.at[1] - (ed.a[1] + ed.u[1] * t));
      const facing = (c.from[0] - ed.a[0]) * ed.w[0] + (c.from[1] - ed.a[1]) * ed.w[1];
      if (facing > 0 && d < bestD) {
        bestD = d;
        best = i;
        bestT = t;
      }
    });
    if (best < 0) continue;
    const list = byEdge.get(best) ?? [];
    list.push({ c, t: bestT });
    byEdge.set(best, list);
  }
  const out = new Map<string, LandingPose>();
  for (const [i, list] of byEdge) {
    const ed = edges[i]!;
    // In order along the edge; boats claiming the same place, the longest first (smaller boats raft outside it).
    list.sort((p, q) => p.t - q.t || q.c.length - p.c.length || p.c.key.localeCompare(q.c.key));
    // Along the edge in order: each at its place or just past the one before. One that would run off the end
    // moves the boats before it back if there is room; otherwise it lies outside the boat nearest its place.
    const at: { t: number; side: number; host?: number }[] = [];
    const fitted: number[] = [];
    /** Outermost side used at each fitted boat (rafts stack outwards). */
    const outer = new Map<number, number>();
    for (let k = 0; k < list.length; k++) {
      const { c, t: want0 } = list[k]!;
      const L = c.length;
      const last = fitted[fitted.length - 1];
      let want = Math.max(want0, L / 2, last === undefined ? 0 : at[last]!.t + list[last]!.c.length / 2 + GAP_M + L / 2);
      const over = want + L / 2 - ed.len;
      const first = fitted[0];
      const room = first === undefined ? want - L / 2 : at[first]!.t - list[first]!.c.length / 2;
      if (over <= 1e-6 || (over <= room && first !== undefined)) {
        if (over > 1e-6) {
          for (const f of fitted) at[f]!.t -= over;
          want -= over;
        }
        at[k] = { t: want, side: FENDER_M + c.beam / 2 };
        fitted.push(k);
        outer.set(k, at[k]!.side + c.beam / 2);
      } else if (first === undefined) {
        // Alone and longer than the edge: centred on it.
        at[k] = { t: ed.len / 2, side: FENDER_M + c.beam / 2 };
        fitted.push(k);
        outer.set(k, at[k]!.side + c.beam / 2);
      } else {
        let host = first;
        for (const f of fitted) if (Math.abs(at[f]!.t - want0) < Math.abs(at[host]!.t - want0)) host = f;
        const side = outer.get(host)! + FENDER_M + c.beam / 2;
        at[k] = { t: at[host]!.t, side, host };
        outer.set(host, side + c.beam / 2);
      }
    }
    // The poses; each boat moved out from the edge, if need be, until it clears every pier (a jetty along the
    // landing's edge, a corner sticking out), with the boats rafted outside it moved out with it.
    const pose = (k: number, side: number): LandingPose => {
      const { c } = list[k]!;
      const t = at[k]!.t;
      // Heading along the edge, the way nearer the boat's approach.
      const app = [c.at[0] - c.from[0], c.at[1] - c.from[1]];
      const fwd = app[0]! * ed.u[0] + app[1]! * ed.u[1] >= 0;
      return { e: ed.a[0] + ed.u[0] * t + ed.w[0] * side, n: ed.a[1] + ed.u[1] * t + ed.w[1] * side, heading: Math.atan2(fwd ? ed.u[0] : -ed.u[0], fwd ? ed.u[1] : -ed.u[1]) };
    };
    const outer2 = new Map<number, number>();
    const order = [...fitted, ...list.map((_, k) => k).filter((k) => at[k]!.host !== undefined)];
    for (const k of order) {
      const { c } = list[k]!;
      const host = at[k]!.host;
      let side = host === undefined ? FENDER_M + c.beam / 2 : outer2.get(host)! + FENDER_M + c.beam / 2;
      for (let step = 0; step < 16 && !clearOfPiers(grid, pose(k, side), c.length, c.beam); step++) side += 0.5;
      outer2.set(host ?? k, side + c.beam / 2);
      out.set(c.key, pose(k, side));
    }
  }
  return out;
}

/** A boat at this pose clear of every pier piece (overlap under 5 cm). */
function clearOfPiers(grid: PierGrid, p: LandingPose, length: number, beam: number): boolean {
  const box = placeOutline(boxOutline(length, beam), p.n, p.e, p.heading);
  for (const k of grid.near(p.n, p.e, length)) {
    const c = polygonContact(box, grid.pieces[k]!.pts);
    if (c && c.depth > 0.05) return false;
  }
  return true;
}

/** Smooth weight for blending into a landing over the last `reach` metres (1 at the landing, 0 beyond). */
export function landingWeight(distance: number, reach = 40): number {
  const x = Math.min(1, Math.max(0, distance / reach));
  return 1 - x * x * (3 - 2 * x);
}

/** A pose blended towards another (position linearly, heading the short way round). */
export function blendPose(a: LandingPose, b: LandingPose, w: number): LandingPose {
  let dh = b.heading - a.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { n: a.n + (b.n - a.n) * w, e: a.e + (b.e - a.e) * w, heading: a.heading + dh * w };
}
