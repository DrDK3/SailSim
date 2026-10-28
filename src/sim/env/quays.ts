/**
 * Quay and sea walls along the town waterfronts. The owner's photographs of Dartmouth (the Embankment, Bayard's
 * Cove, South Town) and Kingswear show the houses standing on vertical stone walls straight out of the water;
 * the 4 m LIDAR ground turns every such wall into a bank about 8 m wide (OUTSTANDING_ISSUES 29). Here the walls
 * are put back where the data cannot show them: along the waterline contour (QUAY_FOOT_ODN) wherever houses
 * stand within QUAY_NEAR_M of it and the ground behind rises like a quay, not a beach. Each wall's top is the
 * ground a few metres behind it (between QUAY_TOP_MIN and QUAY_TOP_MAX), and the ground behind is filled level
 * to it. The positions follow the data; the rule, the heights and the band filled are estimates (E).
 *
 * Pure geometry (no rendering): the picture draws the walls and the physics meets them as fixed walls.
 */

export interface TownGrid {
  spec: { cell: number; nx: number; ny: number; e0: number; n0: number };
  /** Ground (m ODN), rows south to north, cell centres at e0 + (i + 0.5)·cell. */
  values: Float32Array;
}

export interface QuayWall {
  /** The wall's face along the water ([e, n], with the land on the left going along it). */
  line: [number, number][];
  /** Top of the wall (m ODN): the quay's level behind it. */
  top: number;
}

/** The contour the walls stand on: about mid-way between mean tide and high water (m ODN, E). */
export const QUAY_FOOT_ODN = 1.0;
/** Houses within this distance of the waterline make it a town waterfront (m, E). */
export const QUAY_NEAR_M = 18;
export const QUAY_TOP_MIN = 2.8;
export const QUAY_TOP_MAX = 5.0;
/** How far behind a wall the ground is filled level to its top (m, E). */
export const QUAY_FILL_M = 7;
/** The face stands this far into the water from the contour (m), so the ground behind never shows in front. */
export const QUAY_FACE_OFFSET_M = 1.0;
/** Shorter runs are left as they are (m). */
const MIN_RUN_M = 12;

/** Bilinear ground on the grid, or undefined outside it. */
export function gridGround(t: TownGrid, e: number, n: number): number | undefined {
  const s = t.spec;
  const x = (e - s.e0) / s.cell - 0.5;
  const y = (n - s.n0) / s.cell - 0.5;
  const i = Math.floor(x);
  const j = Math.floor(y);
  if (i < 0 || j < 0 || i >= s.nx - 1 || j >= s.ny - 1) return undefined;
  const fx = x - i;
  const fy = y - j;
  const v = (a: number, b: number) => t.values[b * s.nx + a]!;
  return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
}

/**
 * The quay walls of the towns, from the 4 m ground and the building footprints. `exclude` keeps walls away from
 * places that are not walls (ferry slipways, the yacht club's own sea wall).
 */
export function quayWalls(t: TownGrid, buildings: readonly [number, number][][], exclude?: (e: number, n: number) => boolean): QuayWall[] {
  const s = t.spec;
  const L = QUAY_FOOT_ODN;
  // Cells with a house near: building bounding boxes widened by QUAY_NEAR_M.
  const near = new Uint8Array(s.nx * s.ny);
  const pad = Math.ceil(QUAY_NEAR_M / s.cell);
  for (const ring of buildings) {
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const [e, n] of ring) {
      e0 = Math.min(e0, e);
      e1 = Math.max(e1, e);
      n0 = Math.min(n0, n);
      n1 = Math.max(n1, n);
    }
    const i0 = Math.max(0, Math.floor((e0 - s.e0) / s.cell) - pad);
    const i1 = Math.min(s.nx - 1, Math.floor((e1 - s.e0) / s.cell) + pad);
    const j0 = Math.max(0, Math.floor((n0 - s.n0) / s.cell) - pad);
    const j1 = Math.min(s.ny - 1, Math.floor((n1 - s.n0) / s.cell) + pad);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) near[j * s.nx + i] = 1;
  }
  const g = (e: number, n: number) => gridGround(t, e, n);
  // Marching squares on the contour L: segments with the higher ground on their left.
  const segs: [number, number, number, number][] = [];
  const cx = (i: number) => s.e0 + (i + 0.5) * s.cell;
  const cy = (j: number) => s.n0 + (j + 0.5) * s.cell;
  for (let j = 0; j < s.ny - 1; j++) {
    for (let i = 0; i < s.nx - 1; i++) {
      if (!near[j * s.nx + i]) continue;
      const a = t.values[j * s.nx + i]! - L;
      const b = t.values[j * s.nx + i + 1]! - L;
      const c = t.values[(j + 1) * s.nx + i + 1]! - L;
      const d = t.values[(j + 1) * s.nx + i]! - L;
      // Corners anticlockwise: a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1).
      const corners: [number, number, number][] = [
        [cx(i), cy(j), a],
        [cx(i + 1), cy(j), b],
        [cx(i + 1), cy(j + 1), c],
        [cx(i), cy(j + 1), d],
      ];
      const pts: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const [x0, y0, v0] = corners[k]!;
        const [x1, y1, v1] = corners[(k + 1) % 4]!;
        if (v0 >= 0 !== v1 >= 0) {
          const f = v0 / (v0 - v1);
          pts.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
        }
      }
      for (let k = 0; k + 1 < pts.length; k += 2) {
        let [p, q] = [pts[k]!, pts[k + 1]!];
        // Land on the left: the left normal of p→q points uphill.
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const len = Math.hypot(dx, dy) || 1;
        const up = g(mx - (dy / len) * 2, my + (dx / len) * 2);
        const down = g(mx + (dy / len) * 2, my - (dx / len) * 2);
        if (up !== undefined && down !== undefined && up < down) [p, q] = [q, p];
        segs.push([p[0], p[1], q[0], q[1]]);
      }
    }
  }
  // Chain the segments end to start.
  const key = (x: number, y: number) => `${Math.round(x * 20)},${Math.round(y * 20)}`;
  const from = new Map<string, number[]>();
  segs.forEach((sg, k) => {
    const kk = key(sg[0], sg[1]);
    const l = from.get(kk);
    if (l) l.push(k);
    else from.set(kk, [k]);
  });
  const used = new Uint8Array(segs.length);
  const chains: [number, number][][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const chain: [number, number][] = [
      [segs[k]![0], segs[k]![1]],
      [segs[k]![2], segs[k]![3]],
    ];
    for (;;) {
      const last = chain[chain.length - 1]!;
      const next = (from.get(key(last[0], last[1])) ?? []).find((m) => !used[m]);
      if (next === undefined) break;
      used[next] = 1;
      chain.push([segs[next]![2], segs[next]![3]]);
    }
    chains.push(chain);
  }
  // Keep the waterfront stretches: ground rising like a quay behind (not a beach), not excluded; split where not.
  const out: QuayWall[] = [];
  for (const chain of chains) {
    let run: [number, number][] = [];
    const tops: number[] = [];
    const flush = () => {
      if (run.length >= 2 && runLength(run) >= MIN_RUN_M) {
        const sorted = [...tops].sort((a, b) => a - b);
        const top = Math.min(QUAY_TOP_MAX, Math.max(QUAY_TOP_MIN, sorted[Math.floor(sorted.length / 2)]!));
        out.push({ line: offsetLine(simplify(run, 0.6), -QUAY_FACE_OFFSET_M), top });
      }
      run = [];
      tops.length = 0;
    };
    for (let k = 0; k < chain.length; k++) {
      const p = chain[k]!;
      const q = chain[Math.min(k + 1, chain.length - 1)]!;
      const r = chain[Math.max(k - 1, 0)]!;
      const dx = q[0] - r[0];
      const dy = q[1] - r[1];
      const len = Math.hypot(dx, dy) || 1;
      const behind = g(p[0] - (dy / len) * 6, p[1] + (dx / len) * 6);
      const ok = behind !== undefined && behind > L + 1.2 && !(exclude?.(p[0], p[1]) ?? false);
      if (ok) {
        run.push(p);
        tops.push(behind);
      } else flush();
    }
    flush();
  }
  return out;
}

function runLength(line: [number, number][]): number {
  let l = 0;
  for (let k = 1; k < line.length; k++) l += Math.hypot(line[k]![0] - line[k - 1]![0], line[k]![1] - line[k - 1]![1]);
  return l;
}

/** Douglas–Peucker. */
function simplify(line: [number, number][], tol: number): [number, number][] {
  if (line.length <= 2) return line;
  const [a, b] = [line[0]!, line[line.length - 1]!];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let at = 0;
  for (let k = 1; k < line.length - 1; k++) {
    const d = Math.abs((line[k]![0] - a[0]) * dy - (line[k]![1] - a[1]) * dx) / len;
    if (d > worst) {
      worst = d;
      at = k;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(line.slice(0, at + 1), tol).slice(0, -1), ...simplify(line.slice(at), tol)];
}

/** The line moved sideways by `d` (positive to the left, the land). */
function offsetLine(line: [number, number][], d: number): [number, number][] {
  return line.map((p, k) => {
    const q = line[Math.min(k + 1, line.length - 1)]!;
    const r = line[Math.max(k - 1, 0)]!;
    const dx = q[0] - r[0];
    const dy = q[1] - r[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / len) * d, p[1] + (dx / len) * d];
  });
}

/**
 * The ground filled level to each wall's top for QUAY_FILL_M behind it (a copy of the values): the quay the
 * houses stand on. Ground already higher is left alone.
 */
export function fillBehindQuays(t: TownGrid, walls: readonly QuayWall[]): Float32Array {
  const s = t.spec;
  const out = Float32Array.from(t.values);
  for (const w of walls) {
    for (let k = 1; k < w.line.length; k++) {
      const [ax, ay] = w.line[k - 1]!;
      const [bx, by] = w.line[k]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len;
      const uy = dy / len;
      // The band behind the face: from the face to QUAY_FILL_M + the face offset inland (left).
      const depth = QUAY_FILL_M + QUAY_FACE_OFFSET_M;
      const xs = [ax, bx, ax - uy * depth, bx - uy * depth];
      const ys = [ay, by, ay + ux * depth, by + ux * depth];
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - s.e0) / s.cell));
      const i1 = Math.min(s.nx - 1, Math.ceil((Math.max(...xs) - s.e0) / s.cell));
      const j0 = Math.max(0, Math.floor((Math.min(...ys) - s.n0) / s.cell));
      const j1 = Math.min(s.ny - 1, Math.ceil((Math.max(...ys) - s.n0) / s.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = s.e0 + (i + 0.5) * s.cell - ax;
          const y = s.n0 + (j + 0.5) * s.cell - ay;
          const along = x * ux + y * uy;
          const left = -x * uy + y * ux;
          // Cells whose centre is behind the face (a little margin each way so neighbouring segments join).
          if (along < -1 || along > len + 1 || left < 0.3 || left > depth) continue;
          const v = j * s.nx + i;
          if (out[v]! < w.top) out[v] = w.top;
        }
      }
    }
  }
  return out;
}

/** The walls as fixed obstacles for the fleet (src/sim/race/piers.ts): a wall 1.2 m thick along each face. */
export function quayPiers(walls: readonly QuayWall[]): { name: string; floating: false; line: [number, number][]; width: number }[] {
  return walls.map((w) => ({ name: 'quay wall', floating: false as const, line: offsetLine(w.line, 0.6), width: 1.2 }));
}
