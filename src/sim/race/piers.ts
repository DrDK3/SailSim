import type { Vec } from './hull';

/**
 * Piers, jetties and pontoons as solid bodies for the fleet's contact (src/sim/race/fleet.ts). The geodata draws
 * them two ways: a centre line with a width (most pontoons) or an outline (wider jetties and landing stages).
 * Contact needs convex pieces, so a line becomes one rectangle per segment (grown by half the width at each end,
 * so the joints are covered) and an outline is cut into triangles. Each piece keeps its pier's name and whether
 * it floats: a floating pontoon gives a little on its fenders and moorings, a fixed jetty on piles does not (E).
 * Both are solid at every state of the tide (a fixed deck high above the water at low tide still has its piles).
 */

export interface PierInput {
  name: string | null;
  floating: boolean;
  /** Centre line [e, n][] and width (m), or an outline [e, n][]. */
  line?: [number, number][];
  width?: number;
  poly?: [number, number][];
  /** A floating pontoon's gangway from the shore: solid too (a boat cannot pass under it near the wall). */
  gangway?: { shore: [number, number]; pontoon: [number, number] };
}

/** A gangway's width (m, E). */
export const GANGWAY_WIDTH = 1.3;

export interface PierPiece {
  /** Index of the pier it belongs to. */
  pier: number;
  label: string;
  floating: boolean;
  /** Convex, clockwise seen from above (as hull.ts expects). */
  pts: Vec[];
  n: number;
  e: number;
  /** Radius about (n, e) containing the piece (m). */
  radius: number;
}

/** Contact stiffness and damping (N/m, N s/m) of fixed jetties and of floating pontoons on their fenders (E). */
export const PIER_CONTACT = { fixed: { stiffness: 2e5, damping: 5e3 }, floating: { stiffness: 8e4, damping: 4e3 } };

/** Signed area of a ring in (e, n), > 0 counter-clockwise seen from above. */
function signedArea(r: Vec[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p.e * q.n - q.e * p.n;
  }
  return a / 2;
}

function clockwise(r: Vec[]): Vec[] {
  return signedArea(r) > 0 ? [...r].reverse() : r;
}

/** Triangles of a simple polygon (ear clipping), each clockwise. */
export function triangulate(ring: Vec[]): Vec[][] {
  // Work counter-clockwise: an ear is a convex corner with no other vertex inside its triangle.
  const pts = signedArea(ring) < 0 ? [...ring].reverse() : [...ring];
  // Drop a closing duplicate of the first point.
  if (pts.length > 3 && pts[0]!.n === pts[pts.length - 1]!.n && pts[0]!.e === pts[pts.length - 1]!.e) pts.pop();
  const idx = pts.map((_, i) => i);
  const out: Vec[][] = [];
  const cross = (a: Vec, b: Vec, c: Vec) => (b.e - a.e) * (c.n - a.n) - (b.n - a.n) * (c.e - a.e);
  const inside = (p: Vec, a: Vec, b: Vec, c: Vec) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = pts[idx[(k + idx.length - 1) % idx.length]!]!;
      const b = pts[idx[k]!]!;
      const c = pts[idx[(k + 1) % idx.length]!]!;
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => { const p = pts[j]!; return p !== a && p !== b && p !== c && inside(p, a, b, c); })) continue;
      out.push(clockwise([a, b, c]));
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    // Degenerate input (collinear or self-touching): stop rather than loop.
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(clockwise(idx.map((j) => pts[j]!)));
  return out;
}

function piece(pier: number, label: string, floating: boolean, pts: Vec[]): PierPiece {
  const n = pts.reduce((a, p) => a + p.n, 0) / pts.length;
  const e = pts.reduce((a, p) => a + p.e, 0) / pts.length;
  const radius = Math.max(...pts.map((p) => Math.hypot(p.n - n, p.e - e)));
  return { pier, label, floating, pts, n, e, radius };
}

/** Convex pieces for every pier in the data. */
export function pierPieces(piers: readonly PierInput[]): PierPiece[] {
  const out: PierPiece[] = [];
  /** One rectangle along a segment, `h` either side, grown by `grow` at each end. */
  const rectangle = (e0: number, n0: number, e1: number, n1: number, h: number, grow: number): Vec[] | undefined => {
    const L = Math.hypot(e1 - e0, n1 - n0);
    if (L < 1e-6) return undefined;
    const ue = (e1 - e0) / L;
    const un = (n1 - n0) / L;
    // Across the segment (to its right), and along it grown at each end.
    const xe = un;
    const xn = -ue;
    const a = { e: e0 - ue * grow, n: n0 - un * grow };
    const b = { e: e1 + ue * grow, n: n1 + un * grow };
    return clockwise([
      { e: a.e + xe * h, n: a.n + xn * h },
      { e: b.e + xe * h, n: b.n + xn * h },
      { e: b.e - xe * h, n: b.n - xn * h },
      { e: a.e - xe * h, n: a.n - xn * h },
    ]);
  };
  piers.forEach((p, i) => {
    const label = p.name ? p.name : p.floating ? 'a pontoon' : 'a jetty';
    if (p.line && p.line.length >= 2) {
      const h = Math.max(0.5, (p.width ?? 2) / 2);
      for (let k = 1; k < p.line.length; k++) {
        const [e0, n0] = p.line[k - 1]!;
        const [e1, n1] = p.line[k]!;
        const rect = rectangle(e0, n0, e1, n1, h, h);
        if (rect) out.push(piece(i, label, p.floating, rect));
      }
    } else if (p.poly && p.poly.length >= 3) {
      for (const t of triangulate(p.poly.map(([e, n]) => ({ e, n })))) out.push(piece(i, label, p.floating, t));
    }
    if (p.gangway) {
      const { shore, pontoon } = p.gangway;
      const rect = rectangle(shore[0], shore[1], pontoon[0], pontoon[1], GANGWAY_WIDTH / 2, 0);
      if (rect) out.push(piece(i, `${label} gangway`, false, rect));
    }
  });
  return out;
}

/** Pieces near a point, from a grid of 25 m cells (each piece listed in every cell its bounds touch). */
export class PierGrid {
  private readonly cells = new Map<string, number[]>();
  private static readonly CELL = 25;

  constructor(readonly pieces: readonly PierPiece[]) {
    const C = PierGrid.CELL;
    pieces.forEach((pc, k) => {
      for (let i = Math.floor((pc.n - pc.radius) / C); i <= Math.floor((pc.n + pc.radius) / C); i++) {
        for (let j = Math.floor((pc.e - pc.radius) / C); j <= Math.floor((pc.e + pc.radius) / C); j++) {
          const key = `${i},${j}`;
          const list = this.cells.get(key) ?? [];
          list.push(k);
          this.cells.set(key, list);
        }
      }
    });
  }

  /** Indices of pieces whose cells are within `reach` (m) of (n, e), each once. */
  near(n: number, e: number, reach: number, out: number[] = []): number[] {
    out.length = 0;
    const C = PierGrid.CELL;
    for (let i = Math.floor((n - reach) / C); i <= Math.floor((n + reach) / C); i++) {
      for (let j = Math.floor((e - reach) / C); j <= Math.floor((e + reach) / C); j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list) for (const k of list) if (!out.includes(k)) out.push(k);
      }
    }
    return out;
  }
}
