import { createRng } from '../math/rng';

/**
 * Boats berthed in the marinas and on the river's pontoons. The pontoons are OpenStreetMap's (via the geodata);
 * where boats lie on them, which berths are taken and the boats' sizes are estimates (E): no berth plan or
 * occupancy data is published. Each marina pontoon has finger berths down both sides, boats bow-in, about a
 * beam apart (with a finger between); the river's visitor and residents' pontoons take boats alongside. No
 * berth is on land, on another pontoon or overlapping another boat. Pontoons for dinghies, ferries, the
 * lifeboat, fishing boats and hire boats, and the quays and jetties, have none.
 */

export type PierFeature = { name: string | null; floating: boolean } & ({ line: [number, number][]; width: number } | { poly: [number, number][] });

export interface MarinaSite {
  name: string;
  n: number;
  e: number;
}

export interface Berth {
  id: number;
  /** The marina, or the pontoon's name for the river's pontoons. */
  place: string;
  /** In a marina (finger berth) or alongside a river pontoon. */
  style: 'finger' | 'alongside';
  n: number;
  e: number;
  /** Bow direction (rad, compass). */
  heading: number;
  length: number;
  beam: number;
  kind: 'yacht' | 'motor';
  /** Where a boat leaving goes first: astern out of a finger berth into the lane, or off the pontoon's side. */
  exit: { n: number; e: number };
  /** Share of the year the berth is let (0–1); compared with `u` to decide whether a boat is in it. */
  u: number;
}

export interface BerthLayoutInput {
  piers: readonly PierFeature[];
  marinas: readonly MarinaSite[];
  bedElevation(n: number, e: number): number;
  inDomain(n: number, e: number): boolean;
}

/** Pontoons further than this from a marina's centre are river pontoons (E). */
export const MARINA_RADIUS = 250;
/** Ground higher than this (m ODN) is too high for a berth: the LIDAR's drying ground, not dredged berths (E). */
const DRY_ODN = -1.0;
/** Dart Harbour's lettered pontoons (KQ, DA, …) and visitors' pontoons take boats alongside, even near a marina. */
const ALONGSIDE = /^[A-Z]{2} Pontoon|deep water|visitor/i;
/** Boat lengths (m) by marina (E): Noss on Dart takes vessels of 9 to 25 m (noonsite), so larger boats there. */
const SIZES: Record<string, { yacht: [number, number]; motor: [number, number] }> = {
  'Noss on Dart Marina': { yacht: [9.5, 15], motor: [10, 17] },
  'Dart Marina': { yacht: [9, 14], motor: [9, 15] },
};
const DEFAULT_SIZES = { yacht: [8, 13] as [number, number], motor: [8, 14] as [number, number] };
/** Not for yachts and motor boats. */
const NO_BERTHS = /dinghy|steps|landing|rnli|lifeboat|ferry|hire|riverboat|commercial|fishing|depot|toastrack|jetty|scrub|fuel|slip/i;

type Seg = { a: [number, number]; b: [number, number]; w: number; pier: number; k: number };

function segDist(pe: number, pn: number, s: Seg): number {
  const [ae, an] = s.a;
  const [be, bn] = s.b;
  const de = be - ae;
  const dn = bn - an;
  const L2 = de * de + dn * dn;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((pe - ae) * de + (pn - an) * dn) / L2)) : 0;
  return Math.hypot(pe - (ae + de * t), pn - (an + dn * t));
}

/** Oriented boxes overlap (separating axes). */
function boxesOverlap(p: Berth, q: Berth, pad: number): boolean {
  for (const r of [p, q]) {
    for (const ax of [[Math.sin(r.heading), Math.cos(r.heading)], [Math.cos(r.heading), -Math.sin(r.heading)]] as const) {
      const ext = (b: Berth) => {
        const c = b.e * ax[0] + b.n * ax[1];
        const along = Math.abs(Math.sin(b.heading) * ax[0] + Math.cos(b.heading) * ax[1]);
        const across = Math.abs(Math.cos(b.heading) * ax[0] - Math.sin(b.heading) * ax[1]);
        const h = (b.length / 2 + pad) * along + (b.beam / 2 + pad) * across;
        return [c - h, c + h] as const;
      };
      const [a0, a1] = ext(p);
      const [b0, b1] = ext(q);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

/** Lay out the berths (deterministic: the same data gives the same berths and boats). */
export function layoutBerths(input: BerthLayoutInput): Berth[] {
  const segs: Seg[] = [];
  input.piers.forEach((p, i) => {
    const pts = 'line' in p ? p.line : [...p.poly, p.poly[0]!];
    const w = 'line' in p ? p.width : 0.5;
    for (let k = 1; k < pts.length; k++) segs.push({ a: pts[k - 1]!, b: pts[k]!, w, pier: i, k });
  });
  // Spatial bins of pier segments and of placed boats (20 m).
  const BIN = 20;
  const key = (e: number, n: number) => `${Math.floor(e / BIN)},${Math.floor(n / BIN)}`;
  const segBins = new Map<string, Seg[]>();
  for (const s of segs) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    for (let t = 0; t <= len + BIN; t += BIN / 2) {
      const f = Math.min(1, len > 0 ? t / len : 0);
      const k = key(s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f);
      const list = segBins.get(k) ?? [];
      if (!list.includes(s)) list.push(s);
      segBins.set(k, list);
    }
  }
  const nearSegs = (e: number, n: number): Seg[] => {
    const out: Seg[] = [];
    const i0 = Math.floor(e / BIN);
    const j0 = Math.floor(n / BIN);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) for (const s of segBins.get(`${i},${j}`) ?? []) if (!out.includes(s)) out.push(s);
    return out;
  };
  const boatBins = new Map<string, Berth[]>();
  const berths: Berth[] = [];
  const free = (b: Berth): boolean => {
    const i0 = Math.floor(b.e / BIN);
    const j0 = Math.floor(b.n / BIN);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) for (const o of boatBins.get(`${i},${j}`) ?? []) if (boxesOverlap(b, o, 0.25)) return false;
    return true;
  };
  const place = (b: Berth) => {
    const k = key(b.e, b.n);
    boatBins.set(k, [...(boatBins.get(k) ?? []), b]);
    berths.push(b);
  };

  input.piers.forEach((p, pi) => {
    if (!('line' in p) || NO_BERTHS.test(p.name ?? '')) return;
    const mid = p.line[Math.floor(p.line.length / 2)]!;
    let marina: MarinaSite | undefined;
    let best = MARINA_RADIUS;
    for (const m of input.marinas) {
      const d = Math.min(...p.line.map(([e, n]) => Math.hypot(e - m.e, n - m.n)));
      if (d < best) {
        best = d;
        marina = m;
      }
    }
    if (ALONGSIDE.test(p.name ?? '')) marina = undefined;
    // Fixed walkways only carry boats inside a marina; elsewhere they are quays and jetties.
    if (!marina && !p.floating) return;
    const style = marina ? 'finger' : 'alongside';
    const sizes = (marina && SIZES[marina.name]) || DEFAULT_SIZES;
    const place_ = marina?.name ?? p.name ?? 'River pontoon';
    const rng = createRng(0x5eed + pi * 7919 + Math.round(mid[0] * 13 + mid[1] * 7));
    for (let k = 1; k < p.line.length; k++) {
      const [ae, an] = p.line[k - 1]!;
      const [be, bn] = p.line[k]!;
      const len = Math.hypot(be - ae, bn - an);
      if (len < 6) continue;
      const ue = (be - ae) / len;
      const un = (bn - an) / len;
      for (const side of [-1, 1]) {
        // Normal to starboard of a→b times side.
        const ne = un * side;
        const nn = -ue * side;
        let s = 1.5;
        while (s < len - 1.5) {
          const kind: Berth['kind'] = rng.next() < (style === 'finger' ? 0.6 : 0.7) ? 'yacht' : 'motor';
          const [l0, l1] = sizes[kind];
          const length = l0 + (l1 - l0) * rng.next() ** 1.5;
          const beam = (kind === 'yacht' ? 0.3 : 0.33) * length + 0.4;
          const step = style === 'finger' ? beam + 1.0 : length + 2;
          const at = s + step / 2;
          if (at > len - 1) break;
          const pe = ae + ue * at;
          const pn = an + un * at;
          const off = p.width / 2 + (style === 'finger' ? 0.5 + length / 2 : 0.4 + beam / 2);
          const ce = pe + ne * off;
          const cn = pn + nn * off;
          // Finger berths bow-in to the pontoon; alongside, either way round.
          const heading = style === 'finger' ? Math.atan2(-ne, -nn) : Math.atan2(ue, un) + (rng.next() < 0.5 ? 0 : Math.PI);
          const lane = p.width / 2 + (style === 'finger' ? length + 6 : beam + 7);
          const b: Berth = {
            id: berths.length,
            place: place_,
            style,
            n: cn,
            e: ce,
            heading,
            length,
            beam,
            kind,
            exit: { n: pn + nn * lane, e: pe + ne * lane },
            u: rng.next(),
          };
          s += step;
          // Afloat (not on the bank), in the mapped area, clear of other pontoons and of the boats already placed.
          const fwd = { e: Math.sin(heading), n: Math.cos(heading) };
          const probes = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => [ce + fwd.e * f * length, cn + fwd.n * f * length] as const);
          if (probes.some(([e, n]) => !input.inDomain(n, e) || input.bedElevation(n, e) > DRY_ODN)) continue;
          // Every pontoon segment but the one it lies against is an obstacle (other pontoons, and this one's bends).
          const clear = probes.every(([e, n]) => nearSegs(e, n).every((sg) => (sg.pier === pi && sg.k === k) || segDist(e, n, sg) > sg.w / 2 + beam / 2 + 0.3));
          if (!clear || !free(b)) continue;
          place(b);
        }
      }
    }
  });
  return berths;
}

/** Share of berths let (E): marinas are nearly full in summer; the river's visitor pontoons fill in the season. */
export function berthOccupancy(style: Berth['style'], month: number): number {
  const summer = month >= 4 && month <= 8;
  if (style === 'finger') return summer ? 0.88 : 0.72;
  return summer ? 0.6 : month >= 3 && month <= 9 ? 0.35 : 0.12;
}

/**
 * Ways out of a marina. A 2 m grid over the marina where pontoons, berthed boats (with room for a passing
 * boat's beam) and shallow ground are blocked; the entrance is the nearest open water outside it (deep at low
 * water, clear of every berth and pontoon); the distance from the entrance through the grid (8-connected
 * Dijkstra) gives each berth's way out, straightened where the water is clear.
 */
export class MarinaPlanner {
  readonly entrance: { n: number; e: number };
  private readonly e0: number;
  private readonly n0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float64Array;
  private static readonly CELL = 2;

  constructor(input: BerthLayoutInput, berths: readonly Berth[], marina: MarinaSite) {
    const own = berths.filter((b) => b.place === marina.name);
    const C = MarinaPlanner.CELL;
    const cn = own.reduce((a, b) => a + b.n, 0) / Math.max(1, own.length);
    const ce = own.reduce((a, b) => a + b.e, 0) / Math.max(1, own.length);
    // Pontoon segments near the marina.
    const segs: Seg[] = [];
    input.piers.forEach((p, i) => {
      const pts = 'line' in p ? p.line : [...p.poly, p.poly[0]!];
      const w = 'line' in p ? p.width : 1;
      for (let k = 1; k < pts.length; k++) if (Math.hypot(pts[k]![0] - ce, pts[k]![1] - cn) < 700) segs.push({ a: pts[k - 1]!, b: pts[k]!, w, pier: i, k });
    });
    const near = berths.filter((b) => Math.hypot(b.e - ce, b.n - cn) < 700);
    // The entrance: nearest open water to the marina's boats, outside it.
    let entrance = { n: marina.n, e: marina.e };
    search: for (let r = 20; r <= 500; r += 8) {
      let best: { n: number; e: number; d: number } | undefined;
      for (let k = 0; k < 72; k++) {
        const a = (2 * Math.PI * k) / 72;
        const n = cn + r * Math.cos(a);
        const e = ce + r * Math.sin(a);
        if (!input.inDomain(n, e) || input.bedElevation(n, e) > -2.5) continue;
        if (near.some((b) => Math.hypot(b.n - n, b.e - e) < 25)) continue;
        if (segs.some((sg) => segDist(e, n, sg) < 20)) continue;
        const d = Math.hypot(n - marina.n, e - marina.e);
        if (!best || d < best.d) best = { n, e, d };
      }
      if (best) {
        entrance = { n: best.n, e: best.e };
        break search;
      }
    }
    this.entrance = entrance;
    // The grid: the marina's boats and the entrance, with a margin.
    const es = [...own.map((b) => b.e), entrance.e];
    const ns = [...own.map((b) => b.n), entrance.n];
    this.e0 = Math.min(...es) - 60;
    this.n0 = Math.min(...ns) - 60;
    this.nx = Math.ceil((Math.max(...es) + 60 - this.e0) / C);
    this.ny = Math.ceil((Math.max(...ns) + 60 - this.n0) / C);
    const nx = this.nx;
    const ny = this.ny;
    const blocked = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const n = this.n0 + (j + 0.5) * C;
        const e = this.e0 + (i + 0.5) * C;
        if (!input.inDomain(n, e) || input.bedElevation(n, e) > -1.5) blocked[j * nx + i] = 1;
      }
    }
    const PAD = 2.2;
    const mark = (e: number, n: number, r: number, inside: (e: number, n: number) => boolean) => {
      const i0 = Math.max(0, Math.floor((e - r - this.e0) / C));
      const i1 = Math.min(nx - 1, Math.floor((e + r - this.e0) / C));
      const j0 = Math.max(0, Math.floor((n - r - this.n0) / C));
      const j1 = Math.min(ny - 1, Math.floor((n + r - this.n0) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(this.e0 + (i + 0.5) * C, this.n0 + (j + 0.5) * C)) blocked[j * nx + i] = 1;
    };
    for (const sg of segs) {
      const me = (sg.a[0] + sg.b[0]) / 2;
      const mn = (sg.a[1] + sg.b[1]) / 2;
      const r = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) / 2 + sg.w / 2 + PAD;
      mark(me, mn, r, (e, n) => segDist(e, n, sg) < sg.w / 2 + PAD);
    }
    for (const b of near) {
      const fe = Math.sin(b.heading);
      const fn = Math.cos(b.heading);
      mark(b.e, b.n, b.length / 2 + PAD + 1, (e, n) => {
        const x = (e - b.e) * fe + (n - b.n) * fn;
        const y = (e - b.e) * fn - (n - b.n) * fe;
        return Math.abs(x) < b.length / 2 + PAD && Math.abs(y) < b.beam / 2 + PAD;
      });
    }
    this.blocked = blocked;
    // Distance from the entrance (Dijkstra over free cells; a simple binary heap).
    const dist = new Float64Array(nx * ny).fill(Infinity);
    const start = this.cellOf(entrance.e, entrance.n);
    const heap: [number, number][] = [];
    const push = (d: number, c: number) => {
      heap.push([d, c]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    if (start >= 0) {
      dist[start] = 0;
      push(0, start);
    }
    const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
    while (heap.length) {
      const [d, c] = pop();
      if (d > dist[c]!) continue;
      const i = c % nx;
      const j = (c - i) / nx;
      for (const [di, dj, w] of steps) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const k = jj * nx + ii;
        if (blocked[k]) continue;
        const nd = d + w * C;
        if (nd < dist[k]!) {
          dist[k] = nd;
          push(nd, k);
        }
      }
    }
    this.dist = dist;
  }

  private cellOf(e: number, n: number): number {
    const i = Math.floor((e - this.e0) / MarinaPlanner.CELL);
    const j = Math.floor((n - this.n0) / MarinaPlanner.CELL);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }

  private centre(c: number): [number, number] {
    const i = c % this.nx;
    const j = (c - i) / this.nx;
    return [this.e0 + (i + 0.5) * MarinaPlanner.CELL, this.n0 + (j + 0.5) * MarinaPlanner.CELL];
  }

  /** Is the straight line between two points clear (every grid cell along it free)? */
  private clear(a: [number, number], b: [number, number]): boolean {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(L / (MarinaPlanner.CELL / 2));
    for (let k = 0; k <= n; k++) {
      const c = this.cellOf(a[0] + ((b[0] - a[0]) * k) / Math.max(1, n), a[1] + ((b[1] - a[1]) * k) / Math.max(1, n));
      if (c < 0 || this.blocked[c]) return false;
    }
    return true;
  }

  /** The way from a point in the marina (a berth's exit) to the entrance, or undefined if there is none. */
  wayOut(from: { n: number; e: number }): [number, number][] | undefined {
    let c = this.cellOf(from.e, from.n);
    // Start from the nearest reachable cell (the exit may sit in a boat's padding).
    if (c < 0 || !Number.isFinite(this.dist[c]!)) {
      let best = -1;
      let bd = Infinity;
      const i0 = Math.floor((from.e - this.e0) / MarinaPlanner.CELL);
      const j0 = Math.floor((from.n - this.n0) / MarinaPlanner.CELL);
      for (let dj = -4; dj <= 4; dj++) {
        for (let di = -4; di <= 4; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          const k = j * this.nx + i;
          if (Number.isFinite(this.dist[k]!) && Math.hypot(di, dj) < bd) {
            bd = Math.hypot(di, dj);
            best = k;
          }
        }
      }
      if (best < 0) return undefined;
      c = best;
    }
    const cells: [number, number][] = [[from.e, from.n], this.centre(c)];
    for (let guard = 0; guard < this.nx * this.ny && this.dist[c]! > 0; guard++) {
      const i = c % this.nx;
      const j = (c - i) / this.nx;
      let next = c;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
          const k = jj * this.nx + ii;
          if (this.dist[k]! < this.dist[next]!) next = k;
        }
      }
      if (next === c) break;
      c = next;
      cells.push(this.centre(c));
    }
    cells.push([this.entrance.e, this.entrance.n]);
    // Straighten: from each point, on to the furthest one in clear line of sight.
    const out: [number, number][] = [cells[0]!];
    let i = 0;
    while (i < cells.length - 1) {
      let j = i + 1;
      while (j + 1 < cells.length && this.clear(cells[i]!, cells[j + 1]!)) j++;
      out.push(cells[j]!);
      i = j;
    }
    return out;
  }
}
