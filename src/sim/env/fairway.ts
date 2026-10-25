/**
 * Routes through deep water for river traffic: A* on a 16 m grid over the bed, preferring the channel
 * (cost rises as the water shoals and near moorings) and keeping off the drying banks. The result is
 * smoothed and thinned. Deterministic: a pure function of the bed, the water level and the end points.
 */
export interface FairwayInput {
  bedElevation(n: number, e: number): number;
  inDomain(n: number, e: number): boolean;
  /** Water level (m ODN) the route must work at (low water for a route used at every state of tide). */
  waterLevelOdn: number;
  /** Points to stay clear of (moorings), with the clearance (m). */
  avoid?: { n: number; e: number }[];
  avoidRadius?: number;
  /** Least depth to use (m). */
  minDepth?: number;
}

const CELL = 16;

class Heap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0]!;
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l]! < k[m]!) m = l;
        if (r < k.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** A deep-water route from `from` to `to` (n, e), as a polyline of [e, n] points; undefined if none. */
export function fairwayRoute(g: FairwayInput, from: { n: number; e: number }, to: { n: number; e: number }, box?: { nMin: number; nMax: number; eMin: number; eMax: number }): [number, number][] | undefined {
  const b = box ?? {
    nMin: Math.min(from.n, to.n) - 1500,
    nMax: Math.max(from.n, to.n) + 1500,
    eMin: Math.min(from.e, to.e) - 1500,
    eMax: Math.max(from.e, to.e) + 1500,
  };
  const nx = Math.ceil((b.eMax - b.eMin) / CELL);
  const ny = Math.ceil((b.nMax - b.nMin) / CELL);
  const minDepth = g.minDepth ?? 1.2;
  const cost = new Float32Array(nx * ny);
  const avoid = g.avoid ?? [];
  const ar = g.avoidRadius ?? 12;
  // Moorings mark cells as costly (binned for speed).
  const near = new Uint8Array(nx * ny);
  for (const a of avoid) {
    const i0 = Math.floor((a.e - ar - b.eMin) / CELL);
    const i1 = Math.floor((a.e + ar - b.eMin) / CELL);
    const j0 = Math.floor((a.n - ar - b.nMin) / CELL);
    const j1 = Math.floor((a.n + ar - b.nMin) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) near[j * nx + i] = 1;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const e = b.eMin + (i + 0.5) * CELL;
      const n = b.nMin + (j + 0.5) * CELL;
      if (!g.inDomain(n, e)) {
        cost[j * nx + i] = Infinity;
        continue;
      }
      const d = g.waterLevelOdn - g.bedElevation(n, e);
      cost[j * nx + i] = d < minDepth ? Infinity : 1 + 3 * Math.exp(-(d - minDepth) / 2.5) + (near[j * nx + i] ? 4 : 0);
    }
  }
  const cellOf = (p: { n: number; e: number }) => {
    let i = Math.min(nx - 1, Math.max(0, Math.floor((p.e - b.eMin) / CELL)));
    let j = Math.min(ny - 1, Math.max(0, Math.floor((p.n - b.nMin) / CELL)));
    // Start and end on the nearest navigable cell.
    if (!Number.isFinite(cost[j * nx + i]!)) {
      let best = -1;
      let bd = Infinity;
      for (let r = 1; r < 40 && best < 0; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || !Number.isFinite(cost[jj * nx + ii]!)) continue;
            const dd = di * di + dj * dj;
            if (dd < bd) {
              bd = dd;
              best = jj * nx + ii;
            }
          }
        }
      }
      if (best < 0) return -1;
      i = best % nx;
      j = Math.floor(best / nx);
    }
    return j * nx + i;
  };
  const s = cellOf(from);
  const t = cellOf(to);
  if (s < 0 || t < 0) return undefined;
  const gScore = new Float32Array(nx * ny).fill(Infinity);
  const came = new Int32Array(nx * ny).fill(-1);
  const closed = new Uint8Array(nx * ny);
  const ti = t % nx;
  const tj = Math.floor(t / nx);
  const h = (c: number) => Math.hypot((c % nx) - ti, Math.floor(c / nx) - tj);
  const open = new Heap();
  gScore[s] = 0;
  open.push(h(s), s);
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
  while (open.size) {
    const c = open.pop();
    if (c === t) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const ci = c % nx;
    const cj = Math.floor(c / nx);
    for (const [di, dj, len] of steps) {
      const ii = ci + di;
      const jj = cj + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const k = jj * nx + ii;
      const w = cost[k]!;
      if (!Number.isFinite(w) || closed[k]) continue;
      const gs = gScore[c]! + len * (w + cost[c]!) * 0.5;
      if (gs < gScore[k]!) {
        gScore[k] = gs;
        came[k] = c;
        open.push(gs + h(k), k);
      }
    }
  }
  if (came[t]! < 0 && s !== t) return undefined;
  const cells: number[] = [];
  for (let c = t; c >= 0; c = came[c]!) {
    cells.push(c);
    if (c === s) break;
  }
  cells.reverse();
  let pts: [number, number][] = cells.map((c) => [b.eMin + ((c % nx) + 0.5) * CELL, b.nMin + (Math.floor(c / nx) + 0.5) * CELL]);
  pts[0] = [from.e, from.n];
  pts[pts.length - 1] = [to.e, to.n];
  // Smooth (Chaikin, twice) and thin to about one point every 30 m.
  for (let r = 0; r < 2; r++) {
    const out: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, c] = [pts[i]!, pts[i + 1]!];
      out.push([0.75 * a[0] + 0.25 * c[0], 0.75 * a[1] + 0.25 * c[1]], [0.25 * a[0] + 0.75 * c[0], 0.25 * a[1] + 0.75 * c[1]]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  const thin: [number, number][] = [pts[0]!];
  for (const p of pts.slice(1, -1)) {
    const q = thin[thin.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 30) thin.push(p);
  }
  thin.push(pts[pts.length - 1]!);
  return thin.map(([e, n]) => [Math.round(e * 10) / 10, Math.round(n * 10) / 10]);
}
