import type { DartFeatures } from './geoLoader';
import type { DartGeo } from '../sim/geo/dart';
import type { QuayWall, TownGrid } from '../sim/env/quays';
import { landmarkFor } from '../render/landmarks';
import { passengerPierAsDrawn } from '../render/royalDart';

/**
 * Hardstandings under the waterfront buildings (owner, 6 Nov 2026: houses detached from the land). The LIDAR is
 * older than some of the waterfront (Noss's marina buildings stand on ground it shows as foreshore), and at the
 * water's edge it can miss the slab a shed or boathouse stands on, so at high water the river was drawn round and
 * under their walls. Where a building's outline lies on ground below PAD_ODN, the ground under it and an apron
 * round it is raised to PAD_ODN: in the towns' 4 m grid inside the towns, in the 8 m grid elsewhere. The physics
 * stands on the same grids (src/sim/geo/dart.ts). The level and the apron are estimates (E).
 */

/** The hardstanding's level (m ODN): just above high water springs (+2.3 m ODN, E). */
export const PAD_ODN = 2.6;
/** The apron round the building (m), not on the river side of a quay wall. */
export const PAD_APRON_M = 3;
/** A pad is laid when this share of the outline stands on lower ground. */
const LOW_SHARE = 0.25;
/** A building is at the river when ground below RIVER_BELOW_ODN (below mean tide, E) lies within RIVER_NEAR_M. */
const RIVER_NEAR_M = 25;
const RIVER_BELOW_ODN = -0.5;
/** Footprints smaller than this (m²) are kiosks and sheds left as they are. */
const MIN_AREA = 12;
/** Landmarks drawn by their own modules on their own ground (src/render/dart.ts MODELLED). */
const MODELLED = new Set(['rdyc', 'bayards-fort', 'royal-dart-hotel', 'royal-dart-wing']);
/** Moored ships the data maps as buildings, drawn as ships (src/render/dart.ts MOORED_SHIPS). */
const SHIPS = new Set(['Hindostan']);

type Grid = { e0: number; n0: number; cell: number; nx: number; ny: number; values: Float32Array };

function inside(ring: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const [xi, yi] = ring[i]!;
    const [xk, yk] = ring[k]!;
    if (yi > y !== yk > y && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c;
  }
  return c;
}

/** Distance from (x, y) to the polyline (open, or closed when `closed`). */
function toLine(line: readonly (readonly [number, number])[], x: number, y: number, closed: boolean): number {
  let best = Infinity;
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[(i + 1) % line.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/** Is (e, n) on the river side of a quay wall within 8 m (its face, land on the left: src/sim/env/quays.ts)? */
function inFrontOfQuay(quays: readonly QuayWall[], e: number, n: number): boolean {
  for (const q of quays) {
    for (let i = 1; i < q.line.length; i++) {
      const [ae, an] = q.line[i - 1]!;
      const [be, bn] = q.line[i]!;
      const de = be - ae;
      const dn = bn - an;
      const L2 = de * de + dn * dn || 1;
      const t = ((e - ae) * de + (n - an) * dn) / L2;
      if (t < -0.1 || t > 1.1) continue;
      const tt = Math.max(0, Math.min(1, t));
      if (Math.hypot(e - (ae + de * tt), n - (an + dn * tt)) > 8) continue;
      // Right of the line walked along it is the river.
      if (de * (n - an) - dn * (e - ae) < 0) return true;
    }
  }
  return false;
}

export interface PadResult {
  /** The town grid with the pads (a copy), when there is one. */
  town?: Float32Array;
  /** Buildings given a pad, and those at the water's edge left alone (pontoon huts). */
  padded: { e: number; n: number; name: string | null }[];
  skipped: { e: number; n: number; name: string | null; why: string }[];
}

/**
 * Lay the pads: into a copy of the town grid (returned) and into the 8 m grid in place (`geo.elevation`), so the
 * picture and the physics agree. `town` is the town ground as drawn (without the LIDAR's river surface).
 */
export function layPads(f: DartFeatures, town: TownGrid | undefined, geo: DartGeo, quays: readonly QuayWall[]): PadResult {
  const tv = town ? Float32Array.from(town.values) : undefined;
  const coarse = geo.elevation as Grid;
  const t = town?.spec;
  const inTown = (e: number, n: number) => !!t && e > t.e0 + 4 && n > t.n0 + 4 && e < t.e0 + t.nx * t.cell - 4 && n < t.n0 + t.ny * t.cell - 4;
  const sample = (g: Grid, e: number, n: number) => {
    const x = Math.min(Math.max((e - g.e0) / g.cell - 0.5, 0), g.nx - 1.000001);
    const y = Math.min(Math.max((n - g.n0) / g.cell - 0.5, 0), g.ny - 1.000001);
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const v = g.values;
    const k = j * g.nx + i;
    return (v[k]! * (1 - fx) + v[k + 1]! * fx) * (1 - fy) + (v[k + g.nx]! * (1 - fx) + v[k + g.nx + 1]! * fx) * fy;
  };
  const townGrid: Grid | undefined = t && tv ? { e0: t.e0, n0: t.n0, cell: t.cell, nx: t.nx, ny: t.ny, values: tv } : undefined;
  const ground = (e: number, n: number) => (townGrid && inTown(e, n) ? sample(townGrid, e, n) : geo.bedElevation(n, e));
  const floating = f.piers.flatMap((p) => passengerPierAsDrawn(p)).filter((p) => p.floating);
  const castles = (f.landmarks ?? []).filter((l) => /castle$|st petrox/i.test(l.name) && !/hotel/i.test(l.name));
  const out: PadResult = { town: tv, padded: [], skipped: [] };
  for (const b of f.buildings) {
    const ring = b.r;
    if (ring.length < 3) continue;
    let a = 0;
    for (let i = 0; i < ring.length; i++) a += ring[i]![0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * ring[i]![1];
    if (Math.abs(a) / 2 < MIN_AREA) continue;
    const ce = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cn = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    // The outline every metre: how much of it stands on ground below the pad.
    let low = 0;
    let all = 0;
    let lowest = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ae, an] = ring[i]!;
      const [be, bn] = ring[(i + 1) % ring.length]!;
      const k = Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an)));
      for (let q = 0; q < k; q++) {
        const g = ground(ae + ((be - ae) * q) / k, an + ((bn - an) * q) / k);
        all++;
        if (g < PAD_ODN) low++;
        lowest = Math.min(lowest, g);
      }
    }
    if (low / all < LOW_SHARE) continue;
    // Only at the river: ground below mean tide within RIVER_NEAR_M (low ground inland, such as Dartmouth's town
    // centre at +1.3 to +1.9 m ODN, is not reached by the tide and is left as it is).
    const es = ring.map((p) => p[0]);
    const ns = ring.map((p) => p[1]);
    let river = false;
    for (let e = Math.min(...es) - RIVER_NEAR_M; e <= Math.max(...es) + RIVER_NEAR_M && !river; e += 4) {
      for (let n = Math.min(...ns) - RIVER_NEAR_M; n <= Math.max(...ns) + RIVER_NEAR_M; n += 4) {
        if (ground(e, n) < RIVER_BELOW_ODN) {
          river = true;
          break;
        }
      }
    }
    if (!river) continue;
    const who = { e: ce, n: cn, name: b.n };
    if (SHIPS.has(b.n ?? '')) {
      out.skipped.push({ ...who, why: 'a moored ship' });
      continue;
    }
    if (MODELLED.has(landmarkFor(ring)?.id ?? '')) {
      out.skipped.push({ ...who, why: 'a landmark modelled as itself' });
      continue;
    }
    if (castles.some((l) => Math.hypot(l.e - ce, l.n - cn) < 70)) {
      out.skipped.push({ ...who, why: 'on the castles’ rocks' });
      continue;
    }
    // A hut out in the river beside a pontoon (wholly over ground below mean tide): left on the water.
    if (lowest < 0 && low === all && floating.some((p) => toLine((p.line ?? p.poly ?? []) as [number, number][], ce, cn, !!p.poly) < 30)) {
      out.skipped.push({ ...who, why: 'a hut beside a floating pontoon' });
      continue;
    }
    const raise = (g: Grid, apron: number) => {
      const reach = apron + g.cell / 2;
      const es = ring.map((p) => p[0]);
      const ns = ring.map((p) => p[1]);
      const i0 = Math.max(0, Math.floor((Math.min(...es) - reach - g.e0) / g.cell));
      const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(...es) + reach - g.e0) / g.cell));
      const j0 = Math.max(0, Math.floor((Math.min(...ns) - reach - g.n0) / g.cell));
      const j1 = Math.min(g.ny - 1, Math.ceil((Math.max(...ns) + reach - g.n0) / g.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const e = g.e0 + (i + 0.5) * g.cell;
          const n = g.n0 + (j + 0.5) * g.cell;
          const within = inside(ring, e, n);
          if (!within && toLine(ring, e, n, true) > reach) continue;
          if (!within && inFrontOfQuay(quays, e, n)) continue;
          const k = j * g.nx + i;
          if (g.values[k]! < PAD_ODN) g.values[k] = PAD_ODN;
        }
      }
    };
    if (townGrid && inTown(ce, cn)) raise(townGrid, PAD_APRON_M);
    else raise(coarse, PAD_APRON_M);
    out.padded.push(who);
  }
  return out;
}
