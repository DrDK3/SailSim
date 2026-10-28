import * as THREE from 'three';
import { ROAD_WIDTH, TOWNS, type RoadsData } from './population';

/**
 * The roads, built as roads rather than ribbons laid on the ground. Each road (OSM via Overture, roads.json) is
 * resampled every 3 m and given a smooth long profile, level across the carriageway. In the towns, where the
 * picture has the 4 m ground, the ground is cut and filled to the road along a corridor either side (so a
 * hillside street has a cut bank above it and a bank below, as Dartmouth's and Kingswear's do), and the main
 * and residential streets get kerbs and raised pavements; elsewhere the road rides on the ground with an earth
 * bank where it stands above it. The surface is drawn by a shader: asphalt with grain, patching and polished
 * wheel tracks, white centre and edge lines, double yellow lines on the town's main streets, granite kerbs,
 * paving flags; markings stop short of junctions. Widths, kerb and pavement sizes, which streets have
 * pavements and markings, and the look of the surfaces are typical of Devon towns, not surveyed (E).
 */

export const ROAD_STYLE = {
  /** Resampling step (m). */
  step: 3,
  /** Long-profile smoothing (Gaussian sigma, m). */
  smooth: 4,
  /** Kerb height (m) and pavement width by class (m) in the towns. */
  kerb: 0.12,
  pavement: { p: 1.8, s: 1.8, t: 1.6, u: 1.3, r: 1.4 } as Record<string, number>,
  /** In the towns the ground is set to the road this far beyond the road's outer edge (m): one grid cell. */
  corridor: 4.5,
  /** The ground left this far below the road surface (m). */
  under: 0.1,
  /** Markings clear of a junction by this much beyond the crossing road's half-width (m). */
  junctionClear: 3,
};

/** In one of the two towns, where streets have pavements and double yellow lines. */
const inTown = (e: number, n: number) => TOWNS.some((t) => e >= t.eMin && e <= t.eMax && n >= t.nMin && n <= t.nMax);

/** The finer town ground: cell centres at e0 + (i + 0.5)·cell. */
export interface GroundGrid {
  e0: number;
  n0: number;
  cell: number;
  nx: number;
  ny: number;
}

/** Marking flags (bits of aKind.z): centre line, edge lines, double yellows, kerbed (a gutter). */
const MARK = { centre: 1, edge: 2, yellow: 4, kerbed: 8 } as const;
/** Surface kinds (aKind.x). */
const KIND = { carriageway: 0, kerb: 1, pavement: 2, bank: 3, path: 4, wall: 5 } as const;

interface Profile {
  c: string;
  /** Samples: position, unit direction, height (m ODN) of the carriageway; marking factor (0 at junctions … 1). */
  e: Float64Array;
  n: Float64Array;
  de: Float64Array;
  dn: Float64Array;
  h: Float64Array;
  mark: Float32Array;
  /** 1 where the road has kerbs and pavements (not across the mouth of a junction). */
  kerb: Uint8Array;
  s: Float64Array;
  /** Sample spacing (m). */
  ds: number;
  /** Half carriageway width; pavement width (0 for none); carved into the town ground or riding on the ground. */
  w: number;
  pave: number;
  carved: boolean;
  flags: number;
}

const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));

/** Height priority by class (m): main roads over side streets over service roads and car parks. */
const CLASS_LIFT: Record<string, number> = { p: 0.035, s: 0.03, t: 0.025, u: 0.02, r: 0.015, l: 0.012, v: 0.008, w: 0.004, f: 0 };

export class RoadNetwork {
  readonly profiles: Profile[] = [];
  /** Sample index: cell key → [profile, sample] pairs, for surfaceAt. */
  private readonly index = new Map<number, number[]>();
  private static readonly CELL = 12;

  /**
   * `ground(e, n)` is the picture's ground before any carving; `town` the grid that will be carved (roads inside it
   * are carved, the rest ride on the ground).
   */
  constructor(data: RoadsData, ground: (e: number, n: number) => number, private readonly town?: GroundGrid) {
    const S = ROAD_STYLE;
    // Junctions of the roads (not the footpaths): where three or more road ends or through-vertices meet. Each
    // keeps the widest reach (half carriageway and a pavement) of the roads that meet there.
    const key = (e: number, n: number) => `${Math.round(e * 2)},${Math.round(n * 2)}`;
    const node = new Map<string, { deg: number; reach: number }>();
    const isPath = (c: string) => c === 'f' || c === 'w' || c === 'x';
    for (const r of data.roads) {
      if (isPath(r.c) || r.l.length < 2) continue;
      const reach = (ROAD_WIDTH[r.c] ?? 3) / 2 + (inTown(r.l[0]![0], r.l[0]![1]) ? (S.pavement[r.c] ?? 0) : 0);
      r.l.forEach(([e, n], i) => {
        const k = key(e, n);
        const x = node.get(k) ?? { deg: 0, reach: 0 };
        x.deg += i === 0 || i === r.l.length - 1 ? 1 : 2;
        x.reach = Math.max(x.reach, reach);
        node.set(k, x);
      });
    }
    const jIndex = new Map<string, { e: number; n: number; reach: number }[]>();
    const jk = (e: number, n: number) => `${Math.floor(e / 20)},${Math.floor(n / 20)}`;
    for (const [k, x] of node) {
      if (x.deg < 3) continue;
      const [a, b] = k.split(',').map(Number);
      const j = { e: a! / 2, n: b! / 2, reach: x.reach };
      const list = jIndex.get(jk(j.e, j.n)) ?? [];
      list.push(j);
      jIndex.set(jk(j.e, j.n), list);
    }
    /** Distance to the nearest junction, less that junction's reach (≤ 0 inside the junction's mouth). */
    const clearOfJunction = (e: number, n: number) => {
      let best = Infinity;
      const ci = Math.floor(e / 20);
      const cj = Math.floor(n / 20);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const j of jIndex.get(`${ci + di},${cj + dj}`) ?? []) best = Math.min(best, Math.hypot(j.e - e, j.n - n) - j.reach);
      return best;
    };
    const inGrid = (e: number, n: number) => !!town && e > town.e0 + 8 && n > town.n0 + 8 && e < town.e0 + town.nx * town.cell - 8 && n < town.n0 + town.ny * town.cell - 8;

    for (const r of data.roads) {
      if (r.c === 'x' || r.l.length < 2) continue;
      // Cumulative length, then samples every `step` m (and at every vertex where the road turns sharply).
      const cum = [0];
      for (let i = 1; i < r.l.length; i++) cum.push(cum[i - 1]! + Math.hypot(r.l[i]![0] - r.l[i - 1]![0], r.l[i]![1] - r.l[i - 1]![1]));
      const len = cum[cum.length - 1]!;
      if (len < 2) continue;
      const at = (s: number) => {
        const x = Math.max(0, Math.min(len, s));
        let i = 1;
        while (i < cum.length - 1 && cum[i]! < x) i++;
        const p0 = r.l[i - 1]!;
        const p1 = r.l[i]!;
        const f = (x - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
        return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f] as const;
      };
      // Every 3 m in the towns (carved into the finer ground), every 6 m in the country.
      const carved = inGrid(r.l[0]![0], r.l[0]![1]) && inGrid(r.l[r.l.length - 1]![0], r.l[r.l.length - 1]![1]);
      const steps = Math.max(1, Math.ceil(len / (carved ? S.step : 2 * S.step)));
      const N = steps + 1;
      const p: Profile = {
        c: r.c,
        e: new Float64Array(N),
        n: new Float64Array(N),
        de: new Float64Array(N),
        dn: new Float64Array(N),
        h: new Float64Array(N),
        mark: new Float32Array(N),
        kerb: new Uint8Array(N),
        s: new Float64Array(N),
        ds: len / steps,
        w: (ROAD_WIDTH[r.c] ?? 3) / 2,
        pave: 0,
        carved: false,
        flags: 0,
      };
      const path = r.c === 'f' || r.c === 'w';
      const [e0, n0] = r.l[0]!;
      const town = inTown(e0, n0);
      p.carved = carved;
      if (town && !path) p.pave = S.pavement[r.c] ?? 0;
      if (p.pave > 0) p.flags |= MARK.kerbed;
      if (!path && (r.c === 'p' || r.c === 's' || r.c === 't')) p.flags |= MARK.centre;
      if (!path && !town && (r.c === 'p' || r.c === 's')) p.flags |= MARK.edge;
      if (!path && town && (r.c === 'p' || r.c === 's' || r.c === 't')) p.flags |= MARK.yellow;
      if (!path && !town && r.c === 'v') p.w = 1.5;
      if (path && !town) p.w = 0.6;
      const raw = new Float64Array(N);
      for (let k = 0; k < N; k++) {
        const s = (len * k) / steps;
        const [e, n] = at(s);
        const [qe, qn] = at(s + 0.75);
        const [oe, on] = at(s - 0.75);
        const dl = Math.hypot(qe - oe, qn - on) || 1;
        p.e[k] = e;
        p.n[k] = n;
        p.de[k] = (qe - oe) / dl;
        p.dn[k] = (qn - on) / dl;
        p.s[k] = s;
        const c = ground(e, n);
        if (p.carved) raw[k] = c;
        else {
          // Riding on the ground: no lower than the ground at either edge (it must not be buried).
          const le = -p.dn[k]! * p.w;
          const ln = p.de[k]! * p.w;
          raw[k] = Math.max(c, ground(e + le, n + ln), ground(e - le, n - ln));
        }
      }
      // Smooth the long profile (the ground grid's steps would otherwise show), keeping the ends.
      const rad = Math.ceil((2.5 * S.smooth) / S.step);
      for (let k = 0; k < N; k++) {
        let sum = 0;
        let wt = 0;
        for (let q = Math.max(0, k - rad); q <= Math.min(N - 1, k + rad); q++) {
          const g = gauss((q - k) * (len / steps), S.smooth);
          sum += raw[q]! * g;
          wt += g;
        }
        const sm = sum / wt;
        // A road riding on the ground stays above it; a carved one may cut a little into a crest.
        // Where two roads overlap (junctions, a street over a car park), the more important lies a little higher,
        // so the surfaces never fight for the same depth.
        p.h[k] = (p.carved ? sm : Math.max(sm, raw[k]!)) + (path ? 0.04 : 0.02) + (CLASS_LIFT[r.c] ?? 0);
        const clear = clearOfJunction(p.e[k]!, p.n[k]!);
        p.mark[k] = len < 12 ? 0 : Math.min(1, Math.max(0, (clear - S.junctionClear) / 3));
        p.kerb[k] = p.pave > 0 && clear > 1 ? 1 : 0;
      }
      const pi = this.profiles.length;
      this.profiles.push(p);
      for (let k = 0; k < N; k++) {
        const ck = this.cellKey(p.e[k]!, p.n[k]!);
        const list = this.index.get(ck) ?? [];
        list.push(pi, k);
        this.index.set(ck, list);
      }
    }
  }

  private cellKey(e: number, n: number): number {
    const C = RoadNetwork.CELL;
    return Math.floor(e / C) * 100003 + Math.floor(n / C);
  }

  /**
   * The road's surface (m ODN) at (e, n): the carriageway, or a pavement's top; undefined off the roads. Cars and
   * walkers stand on it.
   */
  surfaceAt(e: number, n: number): number | undefined {
    const C = RoadNetwork.CELL;
    const ci = Math.floor(e / C);
    const cj = Math.floor(n / C);
    let best: number | undefined;
    let bestLat = Infinity;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.index.get((ci + di) * 100003 + cj + dj);
        if (!list) continue;
        for (let q = 0; q < list.length; q += 2) {
          const p = this.profiles[list[q]!]!;
          const k = list[q + 1]!;
          const ve = e - p.e[k]!;
          const vn = n - p.n[k]!;
          const along = ve * p.de[k]! + vn * p.dn[k]!;
          if (Math.abs(along) > p.ds * 0.6) continue;
          const lat = Math.abs(-ve * p.dn[k]! + vn * p.de[k]!);
          if (lat > p.w + p.pave || lat >= bestLat) continue;
          bestLat = lat;
          // Interpolate the height along to the neighbouring sample.
          const k2 = along >= 0 ? Math.min(k + 1, p.h.length - 1) : Math.max(k - 1, 0);
          const span = Math.abs(p.s[k2]! - p.s[k]!) || 1;
          const h = p.h[k]! + ((p.h[k2]! - p.h[k]!) * Math.abs(along)) / span;
          best = h + (lat > p.w && p.kerb[k] ? ROAD_STYLE.kerb : 0);
        }
      }
    }
    return best;
  }

  /**
   * Cut and fill the town ground (a copy of `values`) to the roads that lie in it: every grid point within the
   * road's width, its pavements and `corridor` m beyond is set just below the road surface there (the nearest road
   * wins where corridors overlap). Returns the new values.
   */
  carve(values: Float32Array): Float32Array {
    const t = this.town;
    if (!t) return values;
    const out = new Float32Array(values);
    const best = new Float32Array(values.length).fill(Infinity);
    const S = ROAD_STYLE;
    for (const p of this.profiles) {
      if (!p.carved || p.c === 'f') continue;
      const R = p.w + p.pave + S.corridor;
      const N = p.h.length;
      for (let k = 0; k < N; k++) {
        const e = p.e[k]!;
        const n = p.n[k]!;
        const i0 = Math.max(0, Math.floor((e - R - t.e0) / t.cell - 0.5));
        const i1 = Math.min(t.nx - 1, Math.ceil((e + R - t.e0) / t.cell - 0.5));
        const j0 = Math.max(0, Math.floor((n - R - t.n0) / t.cell - 0.5));
        const j1 = Math.min(t.ny - 1, Math.ceil((n + R - t.n0) / t.cell - 0.5));
        for (let j = j0; j <= j1; j++) {
          const gn = t.n0 + (j + 0.5) * t.cell;
          for (let i = i0; i <= i1; i++) {
            const ge = t.e0 + (i + 0.5) * t.cell;
            const ve = ge - e;
            const vn = gn - n;
            const along = ve * p.de[k]! + vn * p.dn[k]!;
            if (Math.abs(along) > S.step) continue;
            const lat = Math.abs(-ve * p.dn[k]! + vn * p.de[k]!);
            if (lat > R) continue;
            const d = Math.hypot(along, lat);
            const v = j * t.nx + i;
            if (d >= best[v]!) continue;
            best[v] = d;
            // Just below the carriageway across the whole corridor (pavements are drawn on top of it): set any
            // higher, the ground between grid points would rise through the carriageway beside the kerb.
            out[v] = p.h[k]! - S.under;
          }
        }
      }
    }
    return out;
  }

  /**
   * The road surfaces (a group named 'roads' of meshes by 600 m tile, so roads off screen are not drawn). `ground`
   * is the picture's ground after carving; at 'low' detail (a software renderer) the kerb faces and the faces at
   * the backs of the pavements are left out.
   */
  mesh(ground: (e: number, n: number) => number, detail: 'high' | 'low' = 'high'): THREE.Group {
    type Buf = { pos: number[]; col: number[]; road: number[]; kind: number[]; idx: number[] };
    const tiles = new Map<string, Buf>();
    const lin = (hex: number) => {
      const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      return [c.r, c.g, c.b];
    };
    const ASPHALT = lin(0x36342f);
    const KERB = lin(0x9d9a92);
    const PAVING = lin(0x948f86);
    const GRAVEL = lin(0x8f8571);
    const PATH_TOWN = lin(0x8a857d);
    const BANK = lin(0x5d5a47);
    const WALL = lin(0x8a8276);
    const S = ROAD_STYLE;
    const TILE = 600;
    const CHUNK = 60;
    let buf: Buf;
    /**
     * One strip along a profile's samples k0..k1 between lateral offsets a and b (m, + is left) at heights ya and
     * yb: flat when a and b differ (facing up), or a vertical face at a = b from ya (foot) to yb (top) facing
     * `outward` (+ left). Only where `use` holds at both ends of a step; vertices are shared along each run.
     */
    const strip = (p: Profile, k0: number, k1: number, a: number, b: number, ya: (k: number) => number, yb: (k: number) => number, colour: number[], kd: number, outward?: number, use?: (k: number) => boolean) => {
      const { pos, col, road, kind, idx } = buf;
      let prev = -1;
      for (let k = k0; k <= k1; k++) {
        const ok = !use || use(k);
        const next = k < k1 && (!use || use(k + 1));
        if (!ok || (prev < 0 && !next)) {
          prev = -1;
          continue;
        }
        const le = -p.dn[k]!;
        const ln = p.de[k]!;
        const cur = pos.length / 3;
        for (const [off, y] of [[a, ya(k)], [b, yb(k)]] as const) {
          pos.push(p.e[k]! + le * off, y, -(p.n[k]! + ln * off));
          col.push(...colour);
          road.push(p.s[k]!, off, p.w);
          kind.push(kd, p.mark[k]!, p.flags);
        }
        if (prev >= 0) {
          // Wind so the face looks up (or outward for the vertical faces).
          if (outward === undefined ? a < b : outward < 0) idx.push(prev, cur, prev + 1, prev + 1, cur, cur + 1);
          else idx.push(prev, prev + 1, cur, prev + 1, cur + 1, cur);
        }
        prev = cur;
      }
    };
    const low = detail === 'low';
    for (const p of this.profiles) {
      const path = p.c === 'f' || p.c === 'w';
      const town = inTown(p.e[0]!, p.n[0]!);
      const h = (k: number) => p.h[k]!;
      const up = (k: number) => p.h[k]! + S.kerb;
      const N = p.h.length;
      for (let k0 = 0; k0 < N - 1; k0 += CHUNK) {
        const k1 = Math.min(N - 1, k0 + CHUNK);
        const km = (k0 + k1) >> 1;
        const key = `${Math.floor(p.e[km]! / TILE)},${Math.floor(p.n[km]! / TILE)}`;
        buf = tiles.get(key) ?? { pos: [], col: [], road: [], kind: [], idx: [] };
        tiles.set(key, buf);
        if (path) {
          strip(p, k0, k1, -p.w, p.w, h, h, town ? PATH_TOWN : GRAVEL, KIND.path);
          continue;
        }
        // The carriageway, level across.
        strip(p, k0, k1, -p.w, p.w, h, h, ASPHALT, KIND.carriageway);
        for (const side of [-1, 1]) {
          const edge = side * p.w;
          if (p.pave > 0) {
            // Kerb face, then the pavement at kerb height, then a face down at its back (not across the mouth of
            // a junction).
            const kerbed = (k: number) => p.kerb[k] === 1;
            if (!low) strip(p, k0, k1, edge, edge, h, up, KERB, KIND.kerb, -side, kerbed);
            strip(p, k0, k1, edge, side * (p.w + p.pave), up, up, PAVING, KIND.pavement, undefined, kerbed);
            const out = side * (p.w + p.pave);
            if (!low) strip(p, k0, k1, out, out, (k) => Math.min(ground(p.e[k]! - p.dn[k]! * out, p.n[k]! + p.de[k]! * out), p.h[k]!) - 0.4, up, p.carved ? WALL : BANK, KIND.wall, side, kerbed);
          } else if (!p.carved) {
            // A bank from the road's edge down to the ground beside it, where the road stands above it (a carved
            // road has the ground at its level).
            const foot = (k: number) => ground(p.e[k]! - p.dn[k]! * edge * 1.15, p.n[k]! + p.de[k]! * edge * 1.15);
            strip(p, k0, k1, edge, edge, (k) => Math.min(foot(k), p.h[k]!) - 0.3, h, BANK, KIND.bank, side, (k) => p.h[k]! - foot(k) > 0.12);
          }
        }
      }
    }
    // Little of the sky's reflection (as the terrain): a matt surface; otherwise dark asphalt reads pale blue.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nattribute vec3 aKind;\nvarying vec3 vRoad;\nvarying vec3 vKind;\nvarying vec3 vRoadWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvKind = aKind;\nvRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vRoad;
          varying vec3 vKind;
          varying vec3 vRoadWorld;
          float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float rNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), f.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          bool hasFlag(float flags, float bit) { return mod(floor(flags / bit), 2.0) > 0.5; }
          // A line of half-width hw at c across x, anti-aliased: thinner than a pixel, it fades to its coverage
          // rather than breaking into speckles.
          float aaLine(float x, float c, float hw) {
            float fw = max(fwidth(x), 1e-4);
            float w = max(hw, fw);
            return (1.0 - smoothstep(w - fw, w + fw, abs(x - c))) * (hw / w);
          }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float kind = floor(vKind.x + 0.5);
            float s = vRoad.x;
            float v = vRoad.y;
            float w = vRoad.z;
            vec2 xz = vRoadWorld.xz;
            if (kind < 0.5) {
              // Asphalt: fine aggregate (faded out where it would be smaller than a pixel), broad mottling,
              // darker patches of newer surfacing, polished wheel tracks.
              float fine = 1.0 - smoothstep(0.02, 0.06, length(fwidth(xz)));
              float grain = (rHash(floor(xz * 22.0)) - 0.5) * fine;
              float mottle = rNoise(xz * 0.35) - 0.5;
              diffuseColor.rgb *= 1.0 + 0.16 * grain + 0.22 * mottle;
              float patched = step(0.86, rHash(floor(vec2(s / 7.0, (v + 9.0) / 2.6))));
              diffuseColor.rgb *= 1.0 - 0.18 * patched;
              float track = smoothstep(0.35, 0.0, abs(abs(v) - w * 0.5)) * step(1.6, w);
              diffuseColor.rgb *= 1.0 + 0.12 * track;
              // Markings, worn a little, clear of junctions.
              float m = vKind.y;
              float flags = vKind.z;
              float wear = 0.75 + 0.25 * rNoise(xz * 3.0);
              vec3 white = vec3(0.82, 0.82, 0.78);
              vec3 yellow = vec3(0.85, 0.66, 0.12);
              if (hasFlag(flags, 1.0)) {
                float dash = aaLine(v, 0.0, 0.05) * step(fract(s / 9.0), 0.45);
                diffuseColor.rgb = mix(diffuseColor.rgb, white, dash * m * wear);
              }
              if (hasFlag(flags, 2.0)) {
                float edge = aaLine(abs(v), w - 0.3, 0.05);
                diffuseColor.rgb = mix(diffuseColor.rgb, white, edge * m * wear);
              }
              if (hasFlag(flags, 4.0)) {
                float yl = max(aaLine(abs(v), w - 0.2, 0.04), aaLine(abs(v), w - 0.36, 0.04));
                diffuseColor.rgb = mix(diffuseColor.rgb, yellow, yl * m * wear);
              }
              // A gutter: darker along a kerb.
              if (hasFlag(flags, 8.0)) diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(w - 0.35, w, abs(v));
            } else if (kind < 1.5) {
              // Granite kerb stones, 0.9 m long.
              diffuseColor.rgb *= 0.92 + 0.12 * rHash(vec2(floor(s / 0.9), 3.0));
              diffuseColor.rgb *= 1.0 - 0.35 * step(0.96, fract(s / 0.9));
            } else if (kind < 2.5) {
              // Paving flags, 0.6 m square, with joints.
              vec2 g = vec2(s / 0.6, (abs(v) - w) / 0.6);
              vec2 f = fract(g);
              float joint = max(step(0.95, f.x), step(0.95, f.y));
              diffuseColor.rgb *= (0.9 + 0.14 * rHash(floor(g) + vec2(7.0, 3.0))) * (1.0 - 0.3 * joint);
            } else if (kind < 3.5) {
              // An earth and grass bank.
              diffuseColor.rgb *= 0.85 + 0.3 * rNoise(xz * 1.3);
            } else if (kind < 4.5) {
              // A path: gravel or paving, worn lighter down the middle.
              diffuseColor.rgb *= (0.9 + 0.2 * (rHash(floor(xz * 14.0)) - 0.5)) * (1.0 + 0.1 * smoothstep(w, 0.0, abs(v)));
            } else {
              // A stone retaining wall: courses of rubble.
              vec2 g = vec2(s / 0.7, vRoadWorld.y / 0.28);
              float row = floor(g.y);
              vec2 f = fract(vec2(g.x + 0.5 * mod(row, 2.0), g.y));
              float joint = max(step(0.92, f.x), step(0.88, f.y));
              diffuseColor.rgb *= (0.85 + 0.25 * rHash(vec2(floor(g.x + 0.5 * mod(row, 2.0)), row))) * (1.0 - 0.35 * joint);
            }
          }`,
        );
    };
    const group = new THREE.Group();
    group.name = 'roads';
    for (const t of tiles.values()) {
      if (!t.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(t.road, 3));
      geo.setAttribute('aKind', new THREE.Float32BufferAttribute(t.kind, 3));
      geo.setIndex(t.idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'roads-tile';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}
