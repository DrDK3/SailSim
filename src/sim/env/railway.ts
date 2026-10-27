import { ukOffsetHours } from './traffic';

/**
 * The Dartmouth Steam Railway at Kingswear: trains arriving from Paignton, the engine running round its
 * coaches, and departing. The track is OpenStreetMap's (via the geodata). Times: the operator's published
 * timetable (Paignton departures 10:30, 12:00, 14:00, 15:30; Kingswear 11:10, 12:40, 14:40, 16:10; a
 * 30-minute journey) for 25 October 2026 (S), used for every day of the season (31 March to 29 October, the
 * operator's 2026 season; E for other days and years: peak days run more trains). The train's make-up,
 * speeds and the run-round moves are estimates (E). Visual only: trains are not in the physics.
 */

export interface RailLine {
  name: string;
  line: [number, number][];
  tunnel: boolean;
}

export interface RailStation {
  name: string;
  e: number;
  n: number;
  platforms: [number, number][][];
  buildings: [number, number][][];
}

export interface RailwayFeatures {
  lines: RailLine[];
  stations: RailStation[];
}

export interface RailPath {
  pts: [number, number][];
  cum: number[];
  length: number;
  /** Stretches (s from, s to) in tunnel. */
  tunnels: [number, number][];
}

function makePath(pts: [number, number][], tunnels: [number, number][] = []): RailPath {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts, cum, length: cum[cum.length - 1]!, tunnels };
}

/** Point at distance s along a path (clamped). */
export function pathPoint(p: RailPath, s: number): { e: number; n: number } {
  const x = Math.min(Math.max(s, 0), p.length);
  let lo = 0;
  let hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi]! - p.cum[lo]!;
  const f = seg > 0 ? (x - p.cum[lo]!) / seg : 0;
  const [e0, n0] = p.pts[lo]!;
  const [e1, n1] = p.pts[hi]!;
  return { e: e0 + (e1 - e0) * f, n: n0 + (n1 - n0) * f };
}

function nearestS(p: RailPath, e: number, n: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 1; i < p.pts.length; i++) {
    const [ae, an] = p.pts[i - 1]!;
    const [be, bn] = p.pts[i]!;
    const de = be - ae;
    const dn = bn - an;
    const L2 = de * de + dn * dn;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / L2)) : 0;
    const d = Math.hypot(e - (ae + de * t), n - (an + dn * t));
    if (d < best.d) best = { s: p.cum[i - 1]! + t * Math.sqrt(L2), d };
  }
  return best;
}

/** The train (E): a tank engine and seven coaches (BR Mark 1, 20.4 m over buffers). */
export const TRAIN = { locoLength: 12.4, coachLength: 20.4, coaches: 7 };
/** Line speed (E): 25 mph; 10 mph over the last 400 m into Kingswear; running round at walking pace. */
const LINE_SPEED = 25 * 0.44704;
const STATION_SPEED = 10 * 0.44704;
const SHUNT_SPEED = 2.5;
const ACCEL = 0.15;
const DECEL = 0.25;
/** The engine stops this far short of the buffers (E): room to draw forward, clear of its coaches, and cross to the loop. */
const STOP_SHORT = 20;
/** Length over which the engine crosses between the platform road and the loop (E): it is clear of its coaches. */
const CROSSOVER = 12;

const TIMETABLE = { paignton: [10 * 60 + 30, 12 * 60, 14 * 60, 15 * 60 + 30], kingswear: [11 * 60 + 10, 12 * 60 + 40, 14 * 60 + 40, 16 * 60 + 10], journeyMin: 30 };
const SEASON = { from: [2, 31] as const, to: [9, 29] as const };

export interface RailVehicle {
  kind: 'loco' | 'coach';
  index: number;
  n: number;
  e: number;
  /** Direction the vehicle faces (rad, compass): the engine's chimney end; for coaches, along the train. */
  heading: number;
  /** Which track it is on, and where (for heights): the main path or the loop. */
  track: 'main' | 'loop';
  s: number;
  /** In the tunnel (not drawn). */
  hidden: boolean;
}

export interface TrainState {
  phase: 'arriving' | 'standing' | 'running-round' | 'departing';
  /** Speed (m/s) and whether the engine is working (accelerating or holding speed): for its exhaust. */
  speed: number;
  working: boolean;
  vehicles: RailVehicle[];
  label: string;
}

/** Distance-time profile of a run of length L from rest to rest with a speed limit by position. */
function runProfile(L: number, limit: (s: number) => number): { t: number[]; s: number[]; v: number[] } {
  const dt = 0.5;
  const t = [0];
  const S = [0];
  const V = [0];
  let s = 0;
  let v = 0;
  let k = 0;
  while (s < L - 0.05 && k++ < 40000) {
    let target = Math.min(limit(s), Math.sqrt(2 * DECEL * Math.max(0, L - s)) + 0.1);
    for (const d of [20, 60, 150, 300]) target = Math.min(target, limit(s + d) + Math.sqrt(2 * DECEL * d));
    v = target > v ? Math.min(target, v + ACCEL * dt) : Math.max(target, v - DECEL * dt);
    s = Math.min(L, s + v * dt);
    t.push(t[t.length - 1]! + dt);
    S.push(s);
    V.push(v);
  }
  return { t, s: S, v: V };
}

function sample(p: { t: number[]; s: number[]; v: number[] }, time: number): { s: number; v: number; a: number } {
  if (time <= 0) return { s: 0, v: 0, a: 0 };
  const n = p.t.length - 1;
  if (time >= p.t[n]!) return { s: p.s[n]!, v: 0, a: 0 };
  const i = Math.min(n - 1, Math.floor(time / 0.5));
  const f = (time - p.t[i]!) / 0.5;
  return { s: p.s[i]! + (p.s[i + 1]! - p.s[i]!) * f, v: p.v[i]! + (p.v[i + 1]! - p.v[i]!) * f, a: (p.v[i + 1]! - p.v[i]!) / 0.5 };
}

export class Railway {
  /** From the buffer stops at Kingswear (s = 0) along the platform road and the line to the edge of the map. */
  readonly main?: RailPath;
  /** The loop (release road) beside the platform road, for running round. */
  readonly loop?: RailPath;
  readonly station?: RailStation;
  private readonly inbound?: ReturnType<typeof runProfile>;
  private readonly outbound?: ReturnType<typeof runProfile>;
  private readonly trainLength = TRAIN.locoLength + TRAIN.coaches * TRAIN.coachLength;

  constructor(readonly features: RailwayFeatures) {
    const st = features.stations.find((s) => /kingswear/i.test(s.name));
    if (!st) return;
    this.station = st;
    const named = features.lines.filter((l) => l.name);
    const bld = st.buildings[0] ?? [[st.e, st.n]];
    const be = bld.reduce((a, p) => a + p[0], 0) / bld.length;
    const bn = bld.reduce((a, p) => a + p[1], 0) / bld.length;
    const endDist = (l: RailLine) => Math.min(Math.hypot(l.line[0]![0] - be, l.line[0]![1] - bn), Math.hypot(l.line.at(-1)![0] - be, l.line.at(-1)![1] - bn));
    // The platform road: the named line ending nearest the station building.
    const platform = [...named].sort((a, b) => endDist(a) - endDist(b))[0];
    if (!platform) return;
    const oriented = (l: RailLine, from: [number, number]) => (Math.hypot(l.line[0]![0] - from[0], l.line[0]![1] - from[1]) < Math.hypot(l.line.at(-1)![0] - from[0], l.line.at(-1)![1] - from[1]) ? l.line : [...l.line].reverse());
    const pts: [number, number][] = [...oriented(platform, [be, bn])];
    const tunnels: [number, number][] = [];
    const used = new Set<RailLine>([platform]);
    // Then the line away from the station: at each junction, the named line leading furthest away.
    for (;;) {
      const end = pts[pts.length - 1]!;
      const next = named
        .filter((l) => !used.has(l) && [l.line[0]!, l.line.at(-1)!].some((p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < 2))
        .map((l) => ({ l, line: oriented(l, end) }))
        .sort((a, b) => Math.hypot(b.line.at(-1)![0] - be, b.line.at(-1)![1] - bn) - Math.hypot(a.line.at(-1)![0] - be, a.line.at(-1)![1] - bn))[0];
      if (!next || Math.hypot(next.line.at(-1)![0] - be, next.line.at(-1)![1] - bn) < Math.hypot(end[0] - be, end[1] - bn)) break;
      used.add(next.l);
      const startLen = makePath(pts).length;
      pts.push(...next.line.slice(1));
      if (next.l.tunnel) tunnels.push([startLen, makePath(pts).length]);
    }
    this.main = makePath(pts, tunnels);
    // The loop: an unnamed line alongside the platform road (3.5 to 6 m off) for most of a train's length.
    const plat = makePath(oriented(platform, [be, bn]));
    let best: { l: RailLine; len: number } | undefined;
    for (const l of features.lines.filter((x) => !x.name)) {
      const p = makePath(l.line);
      let along = 0;
      for (let s = 0; s < p.length; s += 4) {
        const q = pathPoint(p, s);
        const d = nearestS(plat, q.e, q.n).d;
        if (d > 3.5 && d < 6.5) along += 4;
      }
      if (along > 120 && (!best || along > best.len)) best = { l, len: along };
    }
    if (best) this.loop = makePath(oriented(best.l, [be, bn]));
    const main = this.main;
    const limit = (fromBuffers: number) => (fromBuffers < 400 ? STATION_SPEED : LINE_SPEED);
    // Inbound: the engine from the edge of the map to its stop; outbound: from coupled on at the far end to the edge.
    this.inbound = runProfile(main.length - this.homeS, (x) => limit(main.length - x));
    this.outbound = runProfile(main.length - this.coupledS, (x) => limit(this.coupledS + x));
  }

  /** The engine's centre where it stops on arrival, and where it is coupled on at the far end to leave. */
  private get homeS(): number {
    return STOP_SHORT + TRAIN.locoLength / 2;
  }

  private get coupledS(): number {
    return STOP_SHORT + this.trainLength + TRAIN.locoLength / 2 + 0.3;
  }

  /** Is there a timetabled train on this local day? */
  private static running(epochMs: number): boolean {
    const local = new Date(epochMs + ukOffsetHours(epochMs) * 3_600_000);
    const m = local.getUTCMonth();
    const d = local.getUTCDate();
    const after = m > SEASON.from[0] || (m === SEASON.from[0] && d >= SEASON.from[1]);
    const before = m < SEASON.to[0] || (m === SEASON.to[0] && d <= SEASON.to[1]);
    return after && before;
  }

  /** The train at Kingswear or on its way, at this moment (none between trains, out of season or before the data). */
  state(epochMs: number): TrainState | undefined {
    const main = this.main;
    if (!main || !this.inbound || !this.outbound || !Railway.running(epochMs)) return undefined;
    const off = ukOffsetHours(epochMs) * 3_600_000;
    const midnight = Math.floor((epochMs + off) / 86_400_000) * 86_400_000 - off;
    const tIn = this.inbound.t[this.inbound.t.length - 1]!;
    const tOut = this.outbound.t[this.outbound.t.length - 1]!;
    for (let k = 0; k < TIMETABLE.paignton.length; k++) {
      const arrive = midnight + (TIMETABLE.paignton[k]! + TIMETABLE.journeyMin) * 60_000;
      const depart = midnight + TIMETABLE.kingswear[k]! * 60_000;
      const label = `Steam train ${k + 1}: Paignton ${fmt(TIMETABLE.paignton[k]!)} → Kingswear, back at ${fmt(TIMETABLE.kingswear[k]!)}`;
      const t = (epochMs - arrive) / 1000;
      if (t >= -tIn && t < 0) {
        // Arriving: engine leading (facing Kingswear), coaches behind.
        const q = sample(this.inbound, t + tIn);
        const sLoco = main.length - q.s;
        return { phase: 'arriving', speed: q.v, working: q.a > -0.02 && sLoco > 450, vehicles: this.consist(sLoco), label };
      }
      const tAfter = (epochMs - depart) / 1000;
      if (t >= 0 && epochMs < depart) return this.atStation(t, (depart - epochMs) / 1000, label);
      if (tAfter >= 0 && tAfter < tOut) {
        // Departing: the engine at the far end now, running bunker first, pulling the coaches out.
        const q = sample(this.outbound, tAfter);
        const sLoco = this.coupledS + q.s;
        return { phase: 'departing', speed: q.v, working: q.a > -0.02, vehicles: this.consistOut(sLoco), label };
      }
    }
    return undefined;
  }

  /**
   * Arrived: the engine stands at the buffer end; after a minute it uncouples, draws up to the end of the
   * platform road, crosses to the loop, runs back past its coaches, crosses back and couples on at the far end.
   */
  private atStation(t: number, left: number, label: string): TrainState {
    const main = this.main!;
    const homeS = this.homeS;
    const coupledS = this.coupledS;
    const coaches = this.consist(homeS).filter((v) => v.kind === 'coach');
    const loop = this.loop;
    const farEnd = STOP_SHORT + this.trainLength;
    const standing = (s: number, phase: TrainState['phase']): TrainState => ({
      phase, speed: 0, working: false, label,
      vehicles: [{ kind: 'loco', index: 0, ...pathPoint(main, s), heading: this.headingAt(main, s, -1), track: 'main', s, hidden: false }, ...coaches],
    });
    if (!loop || t < 60) return standing(homeS, 'standing');
    // The engine's moves (E): forward to the end of the platform road, over to the loop and back along it past
    // the train, then over again and on to the coaches.
    const back = farEnd + 20;
    const moves = [
      { from: homeS, to: TRAIN.locoLength / 2 },
      { from: TRAIN.locoLength / 2, to: back },
      { from: back, to: coupledS },
    ];
    const times = moves.map((m) => runProfile(Math.abs(m.to - m.from), () => SHUNT_SPEED));
    let tt = t - 60;
    for (let i = 0; i < moves.length; i++) {
      const prof = times[i]!;
      const dur = prof.t[prof.t.length - 1]!;
      if (tt < dur + 20) {
        const q = sample(prof, tt);
        const m = moves[i]!;
        const s = m.from + Math.sign(m.to - m.from) * q.s;
        // Moves 2 and 3 cross between the platform road and the loop over the first or last stretch.
        let blend = 0;
        if (i === 1) blend = Math.min(1, q.s / CROSSOVER);
        if (i === 2) blend = 1 - Math.min(1, q.s / CROSSOVER);
        const pm = pathPoint(main, s);
        const pl = pathPoint(loop, nearestS(loop, pm.e, pm.n).s);
        const f = blend * blend * (3 - 2 * blend);
        const pos = { e: pm.e + (pl.e - pm.e) * f, n: pm.n + (pl.n - pm.n) * f };
        const loco: RailVehicle = { kind: 'loco', index: 0, ...pos, heading: this.headingAt(main, s, -1), track: f > 0.5 ? 'loop' : 'main', s, hidden: false };
        return { phase: 'running-round', speed: q.v, working: q.v > 0.2 && q.a >= 0, vehicles: [loco, ...coaches], label };
      }
      tt -= dur + 20;
    }
    // Coupled on at the far end, ready to leave; the safety valves lift just before the off.
    const st = standing(coupledS, 'standing');
    st.working = left < 30;
    return st;
  }

  /** Compass direction along the main path at s: +1 away from the buffers, −1 towards them. */
  private headingAt(p: RailPath, s: number, dir: 1 | -1): number {
    const a = pathPoint(p, s - 3);
    const b = pathPoint(p, s + 3);
    const h = Math.atan2(b.e - a.e, b.n - a.n);
    return dir === 1 ? h : h + Math.PI;
  }

  /** A vehicle on its bogies: its body on the chord between them (E: 14.2 m apart on a coach, 8 m on the engine). */
  private vehicle(kind: RailVehicle['kind'], index: number, s: number, facing: 1 | -1): RailVehicle {
    const p = this.main!;
    const half = kind === 'coach' ? 7.1 : 4;
    // In the tunnel, or beyond the edge of the map (not drawn).
    const hidden = p.tunnels.some(([a, b]) => s > a + 5 && s < b - 5) || s + half > p.length;
    const a = pathPoint(p, s - half);
    const b = pathPoint(p, s + half);
    const h = Math.atan2(b.e - a.e, b.n - a.n);
    return { kind, index, e: (a.e + b.e) / 2, n: (a.n + b.n) / 2, heading: facing === 1 ? h : h + Math.PI, track: 'main', s, hidden };
  }

  /** Arriving or standing: the engine (centre at sLoco, facing the buffers) and its coaches behind it. */
  private consist(sLoco: number): RailVehicle[] {
    const out = [this.vehicle('loco', 0, sLoco, -1)];
    let s = sLoco + TRAIN.locoLength / 2 + TRAIN.coachLength / 2;
    for (let i = 0; i < TRAIN.coaches; i++, s += TRAIN.coachLength) out.push(this.vehicle('coach', i, s, -1));
    return out;
  }

  /** Departing: the engine at the outer end (centre at sLoco, still facing the buffers: bunker first), coaches behind it. */
  private consistOut(sLoco: number): RailVehicle[] {
    // Same order as standing (engine, then coaches from the buffer end); the last coach is next to the engine now.
    const out = [this.vehicle('loco', 0, sLoco, -1)];
    const last = sLoco - TRAIN.locoLength / 2 - 0.3 - TRAIN.coachLength / 2;
    for (let i = 0; i < TRAIN.coaches; i++) out.push(this.vehicle('coach', i, last - (TRAIN.coaches - 1 - i) * TRAIN.coachLength, -1));
    return out;
  }
}

function fmt(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
