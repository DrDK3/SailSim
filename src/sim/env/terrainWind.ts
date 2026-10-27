import type { NE } from '../boat/forces';

/**
 * How the land shapes the wind over the River Dart: shelter in the lee of hills and valley sides, and the
 * valley steering the wind along it. The weather (a manual setting or the Met Office model) gives the wind
 * over open water; this changes it where land lies upwind.
 *
 * Shelter: looking upwind from each point, a rise of h metres above the sails x metres away shelters the water
 * most from 2h to 6h downwind and not at all beyond 30h - the shape of measured shelter behind windbreaks
 * (docs/SOURCES.md W1, W2); the strongest such rise counts. A rounded valley side is not a dense windbreak
 * (which can halve the wind), so the most it takes here is 40 % (E).
 * Steering: where the valley shelters the water, the wind turns towards the line of the river (the channel
 * direction from the stream pattern), the more the more sheltered and the more obliquely it blows across the
 * valley (not at all square across it): up to half of the way, and 30° at most (E).
 *
 * Computed on a 50 m grid for 16 wind directions, each the first time it is needed; deterministic. Where no land
 * lies upwind the wind is returned unchanged (the same numbers), so open-water runs are unaffected.
 */

export interface TerrainWindInput {
  /** Ground or bed (m ODN). */
  bedElevation(n: number, e: number): number;
  /** The mapped area. */
  domain: { nMin: number; nMax: number; eMin: number; eMax: number };
  /** The line of the river at a point (any length; zero where there is none), for steering. */
  axis?(n: number, e: number): NE;
}

export const TERRAIN_WIND = {
  cell: 50,
  sectors: 16,
  rayStep: 20,
  maxRay: 3000,
  /** Water level (m ODN) and the sails' height above it (m) that shelter is measured from. */
  waterLevel: 0.1,
  sailHeight: 3,
  /** A rise counts from this height above the sails (m). */
  minRise: 2,
  /** Shelter at x/h: in the immediate lee, at its most, and where it ends. */
  leeShelter: 0.3,
  maxShelter: 0.4,
  maxFrom: 2,
  maxTo: 6,
  endAt: 30,
  /** Steering towards the river's line at full shelter (share of the way), and the most it turns (rad). */
  steer: 0.5,
  maxTurn: (30 * Math.PI) / 180,
} as const;

/** Shelter (0 … maxShelter) a rise gives at x/h heights downwind of it. */
export function shelterAt(xh: number): number {
  const T = TERRAIN_WIND;
  if (xh <= 0) return 0;
  if (xh < T.maxFrom) return T.leeShelter + ((T.maxShelter - T.leeShelter) * xh) / T.maxFrom;
  if (xh <= T.maxTo) return T.maxShelter;
  if (xh >= T.endAt) return 0;
  return (T.maxShelter * (T.endAt - xh)) / (T.endAt - T.maxTo);
}

export class TerrainWind {
  private readonly nx: number;
  private readonly ny: number;
  /** Per wind sector: speed factor and turn (rad) per cell, or undefined until needed. */
  private readonly grids: ({ speed: Float32Array; turn: Float32Array } | undefined)[];

  constructor(private readonly t: TerrainWindInput) {
    const C = TERRAIN_WIND.cell;
    this.nx = Math.floor((t.domain.eMax - t.domain.eMin) / C) + 1;
    this.ny = Math.floor((t.domain.nMax - t.domain.nMin) / C) + 1;
    this.grids = Array.from({ length: TERRAIN_WIND.sectors }, () => undefined);
  }

  /** The grid for wind from sector k (from k·360/16 degrees). */
  private grid(k: number): { speed: Float32Array; turn: Float32Array } {
    let g = this.grids[k];
    if (g) return g;
    const T = TERRAIN_WIND;
    const from = (k * 2 * Math.PI) / T.sectors;
    const un = Math.cos(from);
    const ue = Math.sin(from);
    const speed = new Float32Array(this.nx * this.ny).fill(1);
    const turn = new Float32Array(this.nx * this.ny);
    const d = this.t.domain;
    const base = T.waterLevel + T.sailHeight;
    for (let j = 0; j < this.ny; j++) {
      const n = d.nMin + j * T.cell;
      for (let i = 0; i < this.nx; i++) {
        const e = d.eMin + i * T.cell;
        // Only over water and the shore (the wind over the hills themselves is not needed).
        if (this.t.bedElevation(n, e) > 5) continue;
        let shelter = 0;
        for (let x = T.rayStep; x <= T.maxRay; x += T.rayStep) {
          const pn = n + un * x;
          const pe = e + ue * x;
          if (pn < d.nMin || pn > d.nMax || pe < d.eMin || pe > d.eMax) break;
          const h = this.t.bedElevation(pn, pe) - base;
          if (h < T.minRise) continue;
          const s = shelterAt(x / h);
          if (s > shelter) shelter = s;
        }
        if (shelter <= 0) continue;
        const c = j * this.nx + i;
        speed[c] = 1 - shelter;
        // Steering: turn the wind's heading towards the river's line (whichever way along it is nearer).
        const ax = this.t.axis?.(n, e);
        const al = ax ? Math.hypot(ax.n, ax.e) : 0;
        if (ax && al > 1e-6) {
          const to = Math.atan2(-ue, -un);
          let line = Math.atan2(ax.e, ax.n);
          let diff = Math.atan2(Math.sin(line - to), Math.cos(line - to));
          if (Math.abs(diff) > Math.PI / 2) {
            line += Math.PI;
            diff = Math.atan2(Math.sin(line - to), Math.cos(line - to));
          }
          // Square across the valley it is not turned either way; obliquely, towards the nearer way along it.
          turn[c] = Math.max(-T.maxTurn, Math.min(T.maxTurn, diff * Math.abs(Math.cos(diff)) * T.steer * (shelter / T.maxShelter)));
        }
      }
    }
    g = { speed, turn };
    this.grids[k] = g;
    return g;
  }

  private readonly out = { speed: 1, turn: 0 };

  /**
   * Speed factor and turn (rad, > 0 clockwise) for wind from `fromDir` at (n, e): one reused record, read it
   * before the next call.
   */
  factor(n: number, e: number, fromDir: number): { speed: number; turn: number } {
    const T = TERRAIN_WIND;
    const d = this.t.domain;
    const o = this.out;
    o.speed = 1;
    o.turn = 0;
    const x = (e - d.eMin) / T.cell;
    const y = (n - d.nMin) / T.cell;
    if (x < 0 || y < 0 || x >= this.nx - 1 || y >= this.ny - 1) return o;
    const s = (((fromDir / (2 * Math.PI)) * T.sectors) % T.sectors + T.sectors) % T.sectors;
    const k0 = Math.floor(s);
    const k1 = (k0 + 1) % T.sectors;
    const fs = s - k0;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const c = j * this.nx + i;
    const c1 = c + 1;
    const c2 = c + this.nx;
    const c3 = c2 + 1;
    let speed = 0;
    let turn = 0;
    let pristine = true;
    for (let q = 0; q < 2; q++) {
      const w = q === 0 ? 1 - fs : fs;
      if (w === 0) continue;
      const g = this.grid(q === 0 ? k0 : k1);
      const sp = g.speed;
      const tu = g.turn;
      if (sp[c] === 1 && sp[c1] === 1 && sp[c2] === 1 && sp[c3] === 1 && tu[c] === 0 && tu[c1] === 0 && tu[c2] === 0 && tu[c3] === 0) {
        speed += w;
        continue;
      }
      pristine = false;
      speed += w * ((sp[c]! * (1 - fx) + sp[c1]! * fx) * (1 - fy) + (sp[c2]! * (1 - fx) + sp[c3]! * fx) * fy);
      turn += w * ((tu[c]! * (1 - fx) + tu[c1]! * fx) * (1 - fy) + (tu[c2]! * (1 - fx) + tu[c3]! * fx) * fy);
    }
    // No land upwind at any of the corners: exactly unchanged.
    if (!pristine) {
      o.speed = speed;
      o.turn = turn;
    }
    return o;
  }

  /** The wind velocity (NE, where the air goes) shaped by the land at (n, e); the same object when unchanged. */
  apply(w: NE, n: number, e: number): NE {
    const sp = Math.hypot(w.n, w.e);
    if (sp < 1e-9) return w;
    const f = this.factor(n, e, Math.atan2(-w.e, -w.n));
    if (f.speed === 1 && f.turn === 0) return w;
    const c = Math.cos(f.turn);
    const s = Math.sin(f.turn);
    // Rotating the velocity clockwise (seen from above) by `turn`, in (n, e).
    return { n: f.speed * (w.n * c - w.e * s), e: f.speed * (w.n * s + w.e * c) };
  }
}
