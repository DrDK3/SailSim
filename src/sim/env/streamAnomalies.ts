import { DEG } from '../math/angles';
import { knToMs } from '../units';
import type { NE } from '../boat/forces';
import type { TideState } from './tide';

/**
 * Local departures from the channel-following tidal stream (src/sim/env/current.ts), all PROVISIONAL:
 *  - Deeper water runs faster: across a channel the stream goes roughly as depth^(2/3) (Chezy/Manning flow on
 *    a common surface slope), relative to the mean depth nearby, so the deep channel and the outside of bends
 *    run harder than the shallows (E).
 *  - Offshore in Start Bay the stream turns along the coast: north-east-going from HW-2 to HW+4 Dartmouth and
 *    south-west-going from LW-2 to LW+4 (DHNA sailing directions, docs/SOURCES.md H1); its rate is not given,
 *    so 0.7 kn at most is assumed (E).
 *  - Strong northerlies (blowing down the river) strengthen the ebb at the entrance: it "seldom exceeds 2 kn"
 *    but can reach 3.5 kn after heavy rain or in strong northerlies (DHNA, H1). Here up to 1 kn more river
 *    outflow at 20 m/s (E); heavy rain is the scenario's river outflow setting.
 */

export const STREAM_ANOMALIES = {
  cell: 50,
  /** Radius (cells) of the neighbourhood whose mean depth the local depth is compared with. */
  radiusCells: 3,
  levelOdn: 0.1,
  minDepth: 0.3,
  minFactor: 0.5,
  maxFactor: 1.5,
  offshorePeakKn: 0.7,
  /** Start Bay's coastal stream: north-east and south-west (deg). */
  offshoreSetDeg: 45,
  /** Distances from the entrance (m) over which the coastal stream takes over. */
  offshoreFrom: 500,
  offshoreFull: 2000,
  entrance: { n: -680, e: 755 },
  /** Northerlies: from this speed (m/s) to `northerlyFull`, up to this much more outflow (kn); within ±45° of north. */
  northerlyFrom: 10,
  northerlyFull: 20,
  northerlyMaxKn: 1,
} as const;

/** Stream speed factor for the local depth against the mean depth around it (precomputed on a grid). */
export class DepthWeight {
  private readonly nx: number;
  private readonly ny: number;
  private readonly k: Float32Array;

  constructor(bedElevation: (n: number, e: number) => number, private readonly domain: { nMin: number; nMax: number; eMin: number; eMax: number }) {
    const A = STREAM_ANOMALIES;
    this.nx = Math.floor((domain.eMax - domain.eMin) / A.cell) + 1;
    this.ny = Math.floor((domain.nMax - domain.nMin) / A.cell) + 1;
    const depth = new Float32Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) depth[j * this.nx + i] = Math.max(0, A.levelOdn - bedElevation(domain.nMin + j * A.cell, domain.eMin + i * A.cell));
    }
    this.k = new Float32Array(this.nx * this.ny).fill(1);
    const R = A.radiusCells;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const h = depth[j * this.nx + i]!;
        if (h < A.minDepth) continue;
        let sum = 0;
        let cnt = 0;
        for (let dj = -R; dj <= R; dj++) {
          for (let di = -R; di <= R; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj < 0 || ii < 0 || jj >= this.ny || ii >= this.nx) continue;
            const d = depth[jj * this.nx + ii]!;
            if (d < A.minDepth) continue;
            sum += d;
            cnt++;
          }
        }
        const mean = sum / cnt;
        this.k[j * this.nx + i] = Math.max(A.minFactor, Math.min(A.maxFactor, (h / mean) ** (2 / 3)));
      }
    }
  }

  at(n: number, e: number): number {
    const A = STREAM_ANOMALIES;
    const x = (e - this.domain.eMin) / A.cell;
    const y = (n - this.domain.nMin) / A.cell;
    if (x < 0 || y < 0 || x >= this.nx - 1 || y >= this.ny - 1) return 1;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const c = j * this.nx + i;
    const k = this.k;
    return (k[c]! * (1 - fx) + k[c + 1]! * fx) * (1 - fy) + (k[c + this.nx]! * (1 - fx) + k[c + this.nx + 1]! * fx) * fy;
  }
}

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * How much of the coastal stream applies at (n, e): none in the harbour or up the river, all of it 2 km out
 * from the entrance on its seaward side (south-east of it).
 */
export function offshoreWeight(n: number, e: number): number {
  const A = STREAM_ANOMALIES;
  const dn = n - A.entrance.n;
  const de = e - A.entrance.e;
  // Seaward of the entrance: along 135° (south-east).
  const seaward = smooth((-dn * Math.SQRT1_2 + de * Math.SQRT1_2) / 300);
  if (seaward === 0) return 0;
  return seaward * smooth((Math.hypot(dn, de) - A.offshoreFrom) / (A.offshoreFull - A.offshoreFrom));
}

/** The coastal stream (velocity, m/s) for the tide state, at full weight; `rangeScale` scales springs to neaps. */
export function offshoreStream(tide: TideState, rangeScale = 1): NE {
  const A = STREAM_ANOMALIES;
  // One tidal cycle from HW-2: the first half north-east-going (to HW+4), the second south-west-going (LW-2 to LW+4).
  const T = 12.42;
  const ph = (((tide.hoursSinceHW + 2) % T) + T) % T;
  const half = T / 2;
  const sign = ph < half ? 1 : -1;
  const rate = knToMs(A.offshorePeakKn) * rangeScale * Math.sin((Math.PI * (ph % half)) / half);
  const set = A.offshoreSetDeg * DEG;
  return { n: sign * rate * Math.cos(set), e: sign * rate * Math.sin(set) };
}

/** Extra river outflow (kn) a wind from `fromDir` (rad) at `speed` (m/s) drives down the river. */
export function northerlyOutflowKn(fromDir: number, speed: number): number {
  const A = STREAM_ANOMALIES;
  const off = Math.abs(Math.atan2(Math.sin(fromDir), Math.cos(fromDir)));
  if (off > 45 * DEG || speed <= A.northerlyFrom) return 0;
  const s = Math.min(1, (speed - A.northerlyFrom) / (A.northerlyFull - A.northerlyFrom));
  return A.northerlyMaxKn * s * Math.cos(2 * off);
}
