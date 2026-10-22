import type { BoatSnapshot } from '../sim/simulation';

/** Channels recorded for the validation dashboard (SI units except where noted). */
export const CHANNELS = [
  't', 'stw', 'sog', 'twa', 'awa', 'tws', 'heel', 'heelEq', 'rudder', 'helmBalance', 'alphaMain', 'alphaJib',
  'drive', 'resistance', 'boom', 'gust',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Units for the CSV header (angles in radians, signed: + starboard for heel/angles, + port for the boom). */
const UNITS: Record<Channel, string> = {
  t: 's', stw: 'm_s', sog: 'm_s', twa: 'rad', awa: 'rad', tws: 'm_s', heel: 'rad', heelEq: 'rad', rudder: 'rad',
  helmBalance: 'rad', alphaMain: 'rad', alphaJib: 'rad', drive: 'N', resistance: 'N', boom: 'rad', gust: 'ratio',
};

/** Fixed-capacity ring buffer of telemetry samples (10 Hz, last ~5 minutes by default). */
export class Telemetry {
  private readonly cap: number;
  private readonly data: Record<Channel, Float64Array>;
  private start = 0;
  private len = 0;
  version = 0;

  constructor(capacity = 3000) {
    this.cap = capacity;
    this.data = Object.fromEntries(CHANNELS.map((c) => [c, new Float64Array(capacity)])) as Record<Channel, Float64Array>;
  }

  clear(): void {
    this.start = 0;
    this.len = 0;
    this.version++;
  }

  record(s: BoatSnapshot): void {
    const f = s.forces;
    const row: Record<Channel, number> = {
      t: s.t, stw: s.stw, sog: s.sog, twa: s.twa, awa: s.awa, tws: s.tws, heel: s.heel, heelEq: s.heelEquilibrium,
      rudder: s.rudder, helmBalance: s.helmBalance, alphaMain: Math.abs(f.main.incidence), alphaJib: Math.abs(f.jib.incidence),
      drive: f.main.x + f.jib.x, resistance: f.hull.total, boom: s.boomMain, gust: s.env?.gustFactor ?? 1,
    };
    const i = (this.start + this.len) % this.cap;
    for (const c of CHANNELS) this.data[c][i] = row[c];
    if (this.len < this.cap) this.len++;
    else this.start = (this.start + 1) % this.cap;
    this.version++;
  }

  get length(): number {
    return this.len;
  }

  /** Samples with t >= tMin, oldest first. */
  window(tMin: number): Record<Channel, number[]> {
    const out = Object.fromEntries(CHANNELS.map((c) => [c, [] as number[]])) as Record<Channel, number[]>;
    for (let k = 0; k < this.len; k++) {
      const i = (this.start + k) % this.cap;
      if (this.data.t[i]! < tMin) continue;
      for (const c of CHANNELS) out[c].push(this.data[c][i]!);
    }
    return out;
  }

  /** CSV of everything recorded (the dashboard's table view / export). */
  toCsv(): string {
    const w = this.window(-Infinity);
    const lines = [CHANNELS.map((c) => `${c}_${UNITS[c]}`).join(',')];
    for (let k = 0; k < w.t.length; k++) lines.push(CHANNELS.map((c) => w[c][k]!.toFixed(5)).join(','));
    return lines.join('\n') + '\n';
  }
}
