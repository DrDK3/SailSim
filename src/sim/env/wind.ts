import { DEG, smoothstep } from '../math/angles';
import { createRng, type Rng } from '../math/rng';
import type { NE } from '../boat/forces';

/**
 * Wind field = spatial base wind (uniform, or interpolated from a grid such as the Met Office UKV model)
 * + seeded temporal fluctuations:
 *  - oscillating direction shifts and speed fluctuations (Ornstein–Uhlenbeck processes),
 *  - an optional persistent shift (trend),
 *  - puffs: patches of stronger, slightly veered/backed wind that drift downwind, grow and die.
 * Everything is driven by one seeded RNG, advanced once per fixed step, so a run is reproducible.
 * The fluctuation statistics are ESTIMATES (presets below) unless derived from live data.
 */

export interface GustSettings {
  seed: number;
  /** Standard deviation of oscillating direction shifts (deg). */
  shiftSdDeg: number;
  /** Correlation time of the shifts (s). */
  shiftPeriodS: number;
  /** Persistent shift, clockwise positive (deg per minute). */
  trendDegPerMin: number;
  /** Standard deviation of speed fluctuations as a fraction of the mean. */
  speedSdFrac: number;
  speedPeriodS: number;
  /** Puff arrival rate per km² per minute. */
  puffsPerKm2PerMin: number;
  /** Mean extra speed in a puff's core, fraction of the base speed. */
  puffStrengthFrac: number;
  puffRadiusM: number;
  /** Standard deviation of a puff's direction offset (deg). */
  puffDirSdDeg: number;
  puffLifetimeS: number;
}

export const GUST_PRESETS: Record<'steady' | 'moderate' | 'shifty', GustSettings> = {
  steady: {
    seed: 1, shiftSdDeg: 0, shiftPeriodS: 120, trendDegPerMin: 0, speedSdFrac: 0, speedPeriodS: 40,
    puffsPerKm2PerMin: 0, puffStrengthFrac: 0, puffRadiusM: 100, puffDirSdDeg: 0, puffLifetimeS: 100,
  },
  moderate: {
    seed: 1, shiftSdDeg: 5, shiftPeriodS: 180, trendDegPerMin: 0, speedSdFrac: 0.08, speedPeriodS: 40,
    puffsPerKm2PerMin: 0.6, puffStrengthFrac: 0.25, puffRadiusM: 120, puffDirSdDeg: 6, puffLifetimeS: 120,
  },
  shifty: {
    seed: 1, shiftSdDeg: 10, shiftPeriodS: 90, trendDegPerMin: 0, speedSdFrac: 0.15, speedPeriodS: 30,
    puffsPerKm2PerMin: 1.5, puffStrengthFrac: 0.35, puffRadiusM: 90, puffDirSdDeg: 10, puffLifetimeS: 90,
  },
};

export interface BaseWind {
  /** Mean wind at a point: speed (m/s) and FROM direction (rad). */
  at(n: number, e: number): { speed: number; fromDir: number };
}

export function uniformBase(speed: number, fromDir: number): BaseWind {
  return { at: () => ({ speed, fromDir }) };
}

export interface Puff {
  n: number;
  e: number;
  age: number;
  life: number;
  strength: number;
  radius: number;
  dirOffset: number;
}

export interface WindSample {
  speed: number;
  fromDir: number;
  /** Speed relative to the base wind here (1 = mean). */
  gustFactor: number;
}

export interface WindArea {
  n: number;
  e: number;
  radius: number;
}

function gauss(rng: Rng): number {
  const u1 = Math.max(rng.next(), 1e-12);
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class WindField {
  readonly base: BaseWind;
  readonly settings: GustSettings;
  readonly area: WindArea;
  private readonly rng: Rng;
  private shift = 0;
  private speedFluct = 0;
  private t = 0;
  private readonly list: Puff[] = [];

  constructor(base: BaseWind, settings: GustSettings, area: WindArea = { n: 0, e: 0, radius: 2500 }) {
    this.base = base;
    this.settings = settings;
    this.area = area;
    this.rng = createRng(settings.seed);
    // Start from the stationary distribution so there is no warm-up transient.
    this.shift = settings.shiftSdDeg * DEG * gauss(this.rng);
    this.speedFluct = settings.speedSdFrac * gauss(this.rng);
    const expected = this.spawnRate() * settings.puffLifetimeS;
    const count = Math.floor(expected) + (this.rng.next() < expected - Math.floor(expected) ? 1 : 0);
    for (let i = 0; i < count; i++) this.spawn(this.rng.next() * settings.puffLifetimeS);
  }

  /** Puffs per second over the whole area. */
  private spawnRate(): number {
    const km2 = Math.PI * (this.area.radius / 1000) ** 2;
    return (this.settings.puffsPerKm2PerMin * km2) / 60;
  }

  private spawn(age: number): void {
    const s = this.settings;
    const r = this.area.radius * Math.sqrt(this.rng.next());
    const a = 2 * Math.PI * this.rng.next();
    this.list.push({
      n: this.area.n + r * Math.cos(a),
      e: this.area.e + r * Math.sin(a),
      age,
      life: s.puffLifetimeS * (0.6 + 0.8 * this.rng.next()),
      strength: s.puffStrengthFrac * (0.5 + this.rng.next()),
      radius: s.puffRadiusM * (0.6 + 0.8 * this.rng.next()),
      dirOffset: s.puffDirSdDeg * DEG * gauss(this.rng),
    });
  }

  /** Advance the fluctuations by one fixed step. Call exactly once per step (by the owner). */
  step(_t: number, dt: number): void {
    const s = this.settings;
    const aDir = Math.exp(-dt / s.shiftPeriodS);
    const aSpd = Math.exp(-dt / s.speedPeriodS);
    this.shift = aDir * this.shift + s.shiftSdDeg * DEG * Math.sqrt(1 - aDir * aDir) * gauss(this.rng);
    this.speedFluct = aSpd * this.speedFluct + s.speedSdFrac * Math.sqrt(1 - aSpd * aSpd) * gauss(this.rng);
    this.t += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      const b = this.base.at(p.n, p.e);
      // Puffs drift downwind at ~90% of the base wind speed.
      p.n += -0.9 * b.speed * Math.cos(b.fromDir) * dt;
      p.e += -0.9 * b.speed * Math.sin(b.fromDir) * dt;
      p.age += dt;
      const far = Math.hypot(p.n - this.area.n, p.e - this.area.e) > this.area.radius * 1.2;
      if (p.age >= p.life || far) this.list.splice(i, 1);
    }
    if (this.rng.next() < this.spawnRate() * dt) this.spawn(0);
  }

  sample(n: number, e: number): WindSample {
    const s = this.settings;
    const b = this.base.at(n, e);
    let boost = 0;
    let dirW = 0;
    for (const p of this.list) {
      const d2 = (n - p.n) ** 2 + (e - p.e) ** 2;
      if (d2 > 9 * p.radius * p.radius) continue;
      const env = smoothstep(0, 0.2 * p.life, p.age) * (1 - smoothstep(0.7 * p.life, p.life, p.age));
      const w = env * Math.exp(-d2 / (2 * p.radius * p.radius));
      boost += w * p.strength;
      dirW += w * p.dirOffset;
    }
    const gustFactor = Math.max(0, 1 + this.speedFluct + boost);
    const fromDir = b.fromDir + this.shift + (s.trendDegPerMin * DEG * this.t) / 60 + dirW;
    return { speed: b.speed * gustFactor, fromDir, gustFactor };
  }

  /** True wind velocity (where the air moves to), m/s. */
  wind(n: number, e: number): NE {
    const w = this.sample(n, e);
    return { n: -w.speed * Math.cos(w.fromDir), e: -w.speed * Math.sin(w.fromDir) };
  }

  puffs(): readonly Puff[] {
    return this.list;
  }

  /** Current oscillating shift (rad) and speed fluctuation (fraction), for diagnostics. */
  fluctuations(): { shift: number; speedFluct: number } {
    return { shift: this.shift, speedFluct: this.speedFluct };
  }
}

/**
 * A gridded base wind (e.g. the Met Office UKV 2 km field) in local coordinates. Wind vectors are
 * interpolated bilinearly in grid-index space; a least-squares affine map converts local (n, e) to
 * fractional grid indices (the source grid is regular in its own projection). Outside the grid the edge
 * values are used.
 */
export function gridBase(nodes: { n: number; e: number; speed: number; fromDir: number }[][]): BaseWind {
  const rows = nodes.length;
  const cols = nodes[0]?.length ?? 0;
  if (rows < 2 || cols < 2) throw new Error('grid needs at least 2 x 2 nodes');
  // Least squares: i ≈ a0 + a1 n + a2 e ; j ≈ b0 + b1 n + b2 e.
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atI = [0, 0, 0];
  const atJ = [0, 0, 0];
  const vn: number[][] = [];
  const ve: number[][] = [];
  for (let i = 0; i < rows; i++) {
    vn.push([]);
    ve.push([]);
    for (let j = 0; j < cols; j++) {
      const node = nodes[i]![j]!;
      const x = [1, node.n, node.e];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) ata[r]![c]! += x[r]! * x[c]!;
        atI[r]! += x[r]! * i;
        atJ[r]! += x[r]! * j;
      }
      vn[i]!.push(-node.speed * Math.cos(node.fromDir));
      ve[i]!.push(-node.speed * Math.sin(node.fromDir));
    }
  }
  const solve = (m: number[][], b: number[]): number[] => {
    const a = m.map((row, r) => [...row, b[r]!]);
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
      [a[c], a[piv]] = [a[piv]!, a[c]!];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r]![c]! / a[c]![c]!;
        for (let k = c; k < 4; k++) a[r]![k]! -= f * a[c]![k]!;
      }
    }
    return [0, 1, 2].map((r) => a[r]![3]! / a[r]![r]!);
  };
  const ai = solve(ata, atI);
  const aj = solve(ata, atJ);
  const bil = (g: number[][], fi: number, fj: number): number => {
    const i0 = Math.min(rows - 2, Math.max(0, Math.floor(fi)));
    const j0 = Math.min(cols - 2, Math.max(0, Math.floor(fj)));
    const ti = Math.min(1, Math.max(0, fi - i0));
    const tj = Math.min(1, Math.max(0, fj - j0));
    const a = g[i0]![j0]! * (1 - tj) + g[i0]![j0 + 1]! * tj;
    const b = g[i0 + 1]![j0]! * (1 - tj) + g[i0 + 1]![j0 + 1]! * tj;
    return a * (1 - ti) + b * ti;
  };
  return {
    at(n: number, e: number) {
      const fi = ai[0]! + ai[1]! * n + ai[2]! * e;
      const fj = aj[0]! + aj[1]! * n + aj[2]! * e;
      const wn = bil(vn, fi, fj);
      const we = bil(ve, fi, fj);
      const speed = Math.hypot(wn, we);
      const dir = Math.atan2(-we, -wn);
      return { speed, fromDir: dir < 0 ? dir + 2 * Math.PI : dir };
    },
  };
}
