/**
 * The rocky coast at the mouth of the Dart and along Start Bay (owner, 17 Nov 2026: "improve the western cliffs
 * and rocks at the mouth"). The terrain (8 m) smooths the cliffs into green slopes that meet the water in a soft
 * line; the photographs and the chart show slate cliffs and ledges from the castles out to the open coast, with
 * boulders and tidal rock at their foot. This traces the shore (the 0.8 m ODN contour of the ground, about where
 * the rock meets the sea at half tide) south of the towns and sets along it, every 2.5 m, a section of rock face:
 * low ledges where the ground is gentle, cliffs where it is steep (and where OpenStreetMap maps a cliff), each
 * running back into the hillside. Beaches (OpenStreetMap) are left clear, as are the castles, the piers and every
 * building at the water. Boulders lie at the foot, and on the tidal rock OpenStreetMap maps.
 *
 * The shore's line and the slope come from the terrain; the cliffs' heights and the rocks' sizes are estimates (E),
 * the same every time (hashed from the place). The faces are solid to the boats (src/sim/race/setup.ts).
 */
import { DART_PROJECTION } from '../geo/projection';
import { BARE_ROCK, BEACHES, CLIFF_LINES, HEATH, type CoastShape } from './coastData';
import { kingswearLightLocal } from './shoreLights';

/** Ground (m ODN) at (n, e), as the sim's DartGeo.bedElevation. */
export type Bed = (n: number, e: number) => number;

/** What the coast keeps clear of: buildings (footprints) and piers (lines or outlines), local e, n. */
export interface CoastFeatures {
  buildings?: readonly { r: readonly (readonly [number, number])[] }[];
  piers?: readonly ({ line?: readonly (readonly [number, number])[] } | { poly?: readonly (readonly [number, number])[] })[];
}

/** The rock's foot (m ODN): the contour traced as the shore (E: between mean sea level and mean high water). */
export const ROCK_FOOT_ODN = 0.8;
/** The contour grid (m) and the spacing of the sections along the shore (m). */
const GRID = 5;
export const SECTION_SPACING = 2.5;
/** The sections' furthest reach into the hillside (m). */
const SHELF_MAX = 14;
const BOX = { eMin: -3200, eMax: 3600, nMin: -5200, nMax: -100 };

/** South of the towns: the west shore from below Warfleet, the east from the Kingswear light. */
export function inRockyCoast(e: number, n: number): boolean {
  return n < -520 || (e > 330 && n < -100);
}

export interface CoastSection {
  /** The rock's foot on the shore (local e, n), and the unit vector inland (uphill). */
  e: number;
  n: number;
  ue: number;
  un: number;
  /** The face's height above the foot (m), and how far back (m) its top runs to meet the hillside. */
  face: number;
  shelf: number;
  /** A cliff (steep ground or a mapped cliff) rather than a ledge. */
  cliff: boolean;
  /** The ground's height (m ODN) at the back of the shelf and just behind it, for the top to meet. */
  backGround: number;
  seed: number;
}

export interface Boulder {
  e: number;
  n: number;
  /** Across (m), and the ground under it (m ODN). */
  size: number;
  base: number;
  seed: number;
}

export interface CoastRocks {
  /** Runs of sections, each continuous along the shore. */
  runs: CoastSection[][];
  boulders: Boulder[];
}

const hash = (a: number, b: number, k: number) => {
  const s = Math.sin(a * 12.9898 + b * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

const local = (s: CoastShape): [number, number][] =>
  s.pts.map(([lat, lon]) => {
    const p = DART_PROJECTION.toLocal(lat, lon);
    return [p.e, p.n];
  });

function inRing(e: number, n: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ei, ni] = ring[i]!;
    const [ej, nj] = ring[j]!;
    if (ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei) inside = !inside;
  }
  return inside;
}

/** Points to keep clear of (buildings' corners, piers every 3 m), in 10 m cells. */
class Clearance {
  private readonly cells = new Map<number, [number, number][]>();
  add(e: number, n: number): void {
    const k = Math.floor(e / 10) * 100003 + Math.floor(n / 10);
    const c = this.cells.get(k);
    if (c) c.push([e, n]);
    else this.cells.set(k, [[e, n]]);
  }
  addLine(pts: readonly (readonly [number, number])[], closed: boolean): void {
    const m = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < m; i++) {
      const [e0, n0] = pts[i]!;
      const [e1, n1] = pts[(i + 1) % pts.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 3));
      for (let s = 0; s <= steps; s++) this.add(e0 + ((e1 - e0) * s) / steps, n0 + ((n1 - n0) * s) / steps);
    }
  }
  /** Whether any point lies within `r` of the segment a–b. */
  near(ae: number, an: number, be: number, bn: number, r: number): boolean {
    const e0 = Math.floor((Math.min(ae, be) - r) / 10);
    const e1 = Math.floor((Math.max(ae, be) + r) / 10);
    const n0 = Math.floor((Math.min(an, bn) - r) / 10);
    const n1 = Math.floor((Math.max(an, bn) + r) / 10);
    const le = be - ae;
    const ln = bn - an;
    const l2 = le * le + ln * ln || 1;
    for (let i = e0; i <= e1; i++) {
      for (let j = n0; j <= n1; j++) {
        for (const [e, n] of this.cells.get(i * 100003 + j) ?? []) {
          const t = Math.max(0, Math.min(1, ((e - ae) * le + (n - an) * ln) / l2));
          if (Math.hypot(ae + le * t - e, an + ln * t - n) < r) return true;
        }
      }
    }
    return false;
  }
}

/** The shore: the ground's contour at the rock's foot, as polylines (local e, n), by marching squares. */
export function shoreLines(bed: Bed): [number, number][][] {
  const nx = Math.floor((BOX.eMax - BOX.eMin) / GRID) + 1;
  const ny = Math.floor((BOX.nMax - BOX.nMin) / GRID) + 1;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = bed(BOX.nMin + j * GRID, BOX.eMin + i * GRID) - ROCK_FOOT_ODN;
  const at = (i: number, j: number) => v[j * nx + i]!;
  // Edge ids: 2k for the edge from corner k east, 2k + 1 north; the crossing on each.
  const point = (id: number): [number, number] => {
    const k = id >> 1;
    const i = k % nx;
    const j = (k - i) / nx;
    const [i2, j2] = id & 1 ? [i, j + 1] : [i + 1, j];
    const a = at(i, j);
    const b = at(i2, j2);
    const t = a / (a - b);
    return [BOX.eMin + (i + (i2 - i) * t) * GRID, BOX.nMin + (j + (j2 - j) * t) * GRID];
  };
  const segs: [number, number][] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j) > 0 ? 1 : 0;
      const b = at(i + 1, j) > 0 ? 2 : 0;
      const c = at(i + 1, j + 1) > 0 ? 4 : 0;
      const d = at(i, j + 1) > 0 ? 8 : 0;
      const cs = a | b | c | d;
      if (cs === 0 || cs === 15) continue;
      const bottom = (j * nx + i) * 2;
      const top = ((j + 1) * nx + i) * 2;
      const left = (j * nx + i) * 2 + 1;
      const right = (j * nx + i + 1) * 2 + 1;
      const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
      switch (cs) {
        case 1: case 14: segs.push([bottom, left]); break;
        case 2: case 13: segs.push([bottom, right]); break;
        case 4: case 11: segs.push([right, top]); break;
        case 8: case 7: segs.push([left, top]); break;
        case 3: case 12: segs.push([left, right]); break;
        case 6: case 9: segs.push([bottom, top]); break;
        case 5:
          if (centre) segs.push([bottom, right], [left, top]);
          else segs.push([bottom, left], [right, top]);
          break;
        case 10:
          if (centre) segs.push([bottom, left], [right, top]);
          else segs.push([bottom, right], [left, top]);
          break;
      }
    }
  }
  // Chain the segments through their shared edges.
  const byEdge = new Map<number, number[]>();
  segs.forEach(([p, q], s) => {
    for (const id of [p, q]) {
      const l = byEdge.get(id);
      if (l) l.push(s);
      else byEdge.set(id, [s]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines: [number, number][][] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const ids = [segs[s0]![0], segs[s0]![1]];
    // Forward from the end, then backward from the start.
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir > 0 ? ids[ids.length - 1]! : ids[0]!;
        const next = (byEdge.get(end) ?? []).find((s) => !used[s]);
        if (next === undefined) break;
        used[next] = 1;
        const [p, q] = segs[next]!;
        const other = p === end ? q : p;
        if (dir > 0) ids.push(other);
        else ids.unshift(other);
      }
    }
    if (ids.length >= 4) lines.push(ids.map(point));
  }
  return lines;
}

/** Resample a polyline every `step` metres (by length along it). */
function resample(line: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [line[0]!];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [e0, n0] = line[i - 1]!;
    const [e1, n1] = line[i]!;
    const l = Math.hypot(e1 - e0, n1 - n0);
    let d = step - carry;
    while (d <= l) {
      out.push([e0 + ((e1 - e0) * d) / l, n0 + ((n1 - n0) * d) / l]);
      d += step;
    }
    carry = l - (d - step);
  }
  return out;
}

const cache = new WeakMap<object, CoastRocks>();

/**
 * The rocky coast for this ground and these buildings and piers (worked out once for each ground, then kept).
 * `key` identifies the ground (the DartGeo), for the cache.
 */
export function coastRocks(key: object, bed: Bed, features: CoastFeatures | undefined): CoastRocks {
  const hit = cache.get(key);
  if (hit) return hit;
  const beaches = BEACHES.map(local);
  const cliffs = CLIFF_LINES.map(local);
  const clear = new Clearance();
  for (const b of features?.buildings ?? []) clear.addLine(b.r, true);
  for (const p of features?.piers ?? []) {
    if ('line' in p && p.line) clear.addLine(p.line, false);
    else if ('poly' in p && p.poly) clear.addLine(p.poly, true);
  }
  const kl = kingswearLightLocal();
  const nearCliff = (e: number, n: number) =>
    cliffs.some((l) =>
      l.some(([a, b], i) => {
        if (i === 0) return false;
        const [c, d] = l[i - 1]!;
        const le = a - c;
        const ln = b - d;
        const t = Math.max(0, Math.min(1, ((e - c) * le + (n - d) * ln) / (le * le + ln * ln || 1)));
        return Math.hypot(c + le * t - e, d + ln * t - n) < 40;
      }),
    );
  const runs: CoastSection[][] = [];
  const boulders: Boulder[] = [];
  for (const line of shoreLines(bed)) {
    let run: CoastSection[] = [];
    const flush = () => {
      // Not a knot of the contour round a single rock or hollow (a run that never gets anywhere).
      if (run.length >= 3) {
        let e0 = Infinity;
        let e1 = -Infinity;
        let n0 = Infinity;
        let n1 = -Infinity;
        for (const x of run) {
          e0 = Math.min(e0, x.e);
          e1 = Math.max(e1, x.e);
          n0 = Math.min(n0, x.n);
          n1 = Math.max(n1, x.n);
        }
        if (Math.hypot(e1 - e0, n1 - n0) >= 15) runs.push(run);
      }
      run = [];
    };
    for (const [e, n] of resample(line, SECTION_SPACING)) {
      if (!inRockyCoast(e, n)) {
        flush();
        continue;
      }
      // Uphill: the ground's gradient.
      const ge = bed(n, e + 2) - bed(n, e - 2);
      const gn = bed(n + 2, e) - bed(n - 2, e);
      const gl = Math.hypot(ge, gn);
      if (gl < 1e-3) {
        flush();
        continue;
      }
      const ue = ge / gl;
      const un = gn / gl;
      const h = (x: number) => bed(n + un * x, e + ue * x);
      // Beaches stay clear; so do the buildings and piers at the water, and the Kingswear light's own rock.
      const beach = beaches.some((r) => inRing(e, n, r) || inRing(e - ue * 3, n - un * 3, r));
      const built = clear.near(e - ue * 3, n - un * 3, e + ue * (SHELF_MAX + 2), n + un * (SHELF_MAX + 2), 7);
      if (beach || built || Math.hypot(e - kl.e, n - kl.n) < 10) {
        flush();
        continue;
      }
      const mapped = nearCliff(e, n);
      let face = Math.max(0.8, Math.min(20, 0.55 * (h(20) - ROCK_FOOT_ODN)));
      if (mapped) face = Math.max(face, Math.min(24, 0.75 * (h(25) - ROCK_FOOT_ODN)));
      const steep = (h(12) - h(0)) / 12 > 0.45;
      run.push({ e, n, ue, un, face, shelf: 0, cliff: steep || mapped, backGround: 0, seed: Math.floor(hash(e, n, 1) * 1e6) });
    }
    flush();
  }
  // Smooth the faces' heights along each run, taper the ends, then find where each top meets the hillside.
  for (const run of runs) {
    const f = run.map((s) => s.face);
    run.forEach((s, i) => {
      let w = 0;
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        const v = f[i + k];
        if (v === undefined) continue;
        const wk = 3 - Math.abs(k);
        sum += v * wk;
        w += wk;
      }
      const end = Math.min(i, run.length - 1 - i);
      s.face = (sum / w) * (end === 0 ? 0.35 : end === 1 ? 0.7 : 1);
      const h = (x: number) => bed(s.n + s.un * x, s.e + s.ue * x);
      let shelf = -1;
      for (let x = 1; x <= SHELF_MAX; x += 0.5) {
        if (h(x) >= ROCK_FOOT_ODN + s.face) {
          shelf = x;
          break;
        }
      }
      if (shelf < 0) {
        s.face = Math.max(0.8, h(SHELF_MAX) - ROCK_FOOT_ODN - 0.2);
        shelf = SHELF_MAX;
      }
      s.shelf = shelf;
      s.backGround = h(shelf + 2);
    });
  }
  // Boulders at the foot, seaward of the face, where the ground is between low and high water.
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      const s = run[i]!;
      if (hash(s.e, s.n, 2) > (s.cliff ? 0.5 : 0.32)) continue;
      const count = 1 + Math.floor(hash(s.e, s.n, 3) * (s.cliff ? 2.6 : 1.8));
      for (let k = 0; k < count; k++) {
        const x = -(2.2 + hash(s.e, s.n, 10 + k) * (s.cliff ? 8 : 5));
        const a = (hash(s.e, s.n, 20 + k) - 0.5) * SECTION_SPACING * 1.4;
        const e = s.e + s.ue * x - s.un * a;
        const n = s.n + s.un * x + s.ue * a;
        const base = bed(n, e);
        if (base < -0.9 || base > 1.6) continue;
        const r = hash(s.e, s.n, 30 + k);
        boulders.push({ e, n, size: 0.5 + r * r * (s.cliff ? 2.8 : 1.5), base, seed: Math.floor(hash(e, n, 4) * 1e6) });
      }
    }
  }
  // The rock OpenStreetMap maps: tidal ledges and the bare rock on the cliffs, strewn with rocks.
  BARE_ROCK.forEach((shape) => {
    const ring = local(shape);
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
    const step = shape.tidal ? 3.2 : 3;
    for (let n = n0; n <= n1; n += step) {
      for (let e = e0; e <= e1; e += step) {
        const pe = e + (hash(e, n, 5) - 0.5) * step * 0.8;
        const pn = n + (hash(e, n, 6) - 0.5) * step * 0.8;
        if (!inRing(pe, pn, ring) || hash(e, n, 7) > (shape.tidal ? 0.5 : 0.6)) continue;
        if (Math.hypot(pe - kl.e, pn - kl.n) < 7 || clear.near(pe, pn, pe, pn, 4)) continue;
        const r = hash(e, n, 8);
        const ground = bed(pn, pe);
        boulders.push({ e: pe, n: pn, size: (shape.tidal ? 0.7 : 1) + r * r * (shape.tidal ? 1.6 : 2.4), base: shape.tidal ? Math.max(ground, -1) : ground, seed: Math.floor(hash(pe, pn, 9) * 1e6) });
      }
    }
  });
  const out = { runs, boulders };
  cache.set(key, out);
  return out;
}

/** Whether (e, n) lies on the rock faces or their tops (no trees there), on a 4 m grid. */
export function coastRockCover(rocks: CoastRocks): (e: number, n: number) => boolean {
  const cells = new Set<number>();
  const key = (e: number, n: number) => Math.floor(e / 4) * 100003 + Math.floor(n / 4);
  for (const run of rocks.runs) {
    for (const s of run) {
      for (let x = -2; x <= s.shelf + 3; x += 2) {
        for (const a of [-1.5, 0, 1.5]) cells.add(key(s.e + s.ue * x - s.un * a, s.n + s.un * x + s.ue * a));
      }
    }
  }
  return (e, n) => cells.has(key(e, n));
}

/** The rock faces as solid outlines for the boats: the foot of each face, in pieces of four sections. */
export function coastRockStructures(rocks: CoastRocks): { name: string; floating: false; poly: [number, number][] }[] {
  const out: { name: string; floating: false; poly: [number, number][] }[] = [];
  for (const run of rocks.runs) {
    for (let i = 0; i + 1 < run.length; i += 4) {
      const part = run.slice(i, Math.min(run.length, i + 5));
      const front = part.map((s) => [s.e - s.ue * 1.5, s.n - s.un * 1.5] as [number, number]);
      const back = part.map((s) => [s.e + s.ue * 0.8, s.n + s.un * 0.8] as [number, number]).reverse();
      out.push({ name: 'the rocks', floating: false, poly: [...front, ...back] });
    }
  }
  return out;
}

/**
 * Open coast where no wood grows: OpenStreetMap's heath on the cliff tops, its beaches and its bare rock (the
 * satellite picture's dark heath otherwise reads as woodland on a steep slope).
 */
export function openCoast(): (e: number, n: number) => boolean {
  const rings = [...HEATH, ...BEACHES, ...BARE_ROCK].map((s) => {
    const r = local(s);
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const [e, n] of r) {
      e0 = Math.min(e0, e);
      e1 = Math.max(e1, e);
      n0 = Math.min(n0, n);
      n1 = Math.max(n1, n);
    }
    return { r, e0, e1, n0, n1 };
  });
  return (e, n) => rings.some((x) => e >= x.e0 && e <= x.e1 && n >= x.n0 && n <= x.n1 && inRing(e, n, x.r));
}
