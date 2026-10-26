import type { NE } from '../boat/forces';
import { createRng } from '../math/rng';
import type { FerryRoute } from './ferries';
import { fairwayRoute, type FairwayInput } from './fairway';

/**
 * River traffic: the ferries on their OSM routes and boats coming in and out of Dart Marina. Each trip is a
 * speed profile, not a fixed animation: the vessel accelerates, cruises, slows to its berth, keeps to the 6 kn
 * harbour limit (docs/SOURCES.md H3), crabs into the tidal stream so its track stays on the route, and waits
 * for a ferry crossing ahead. Everything is computed from the clock (and the stream at that time), so every
 * run - physics and picture alike - sees the same traffic at the same moment.
 *
 * The Lower Ferry (tug and float, F1–F4): an unpowered float carrying up to 8 cars, moved by a tug lashed
 * alongside. At each slip the tug goes astern to pull the float clear, then, held by its head rope, swings
 * round to face the other bank and pushes across. Two units run when traffic demands (they pass mid-stream);
 * one runs during the 29 Oct – 13 Dec 2026 refit (F2). First and last departures follow the operator's
 * published times (F2). Vessel sizes, speeds, dwell times and the hours of the other services are estimates (E).
 */

export type VesselKind = 'tug-float' | 'floating-bridge' | 'passenger-ferry' | 'launch' | 'river-cruiser' | 'motor-cruiser' | 'yacht' | 'rib';
export type VesselPhase = 'berthed' | 'clearing' | 'swinging' | 'underway' | 'holding';

/** A box the fleet physics treats as solid (centre, heading, size). */
export interface VesselPart {
  n: number;
  e: number;
  heading: number;
  length: number;
  beam: number;
}

export interface VesselState {
  id: string;
  /** Route or service name (OSM route name for the ferries). */
  name: string;
  label: string;
  unit: number;
  kind: VesselKind;
  n: number;
  e: number;
  /** Heading of the hull (rad, compass): the direction of travel, plus any crab angle into the stream. */
  heading: number;
  moving: boolean;
  /** Restricted in her ability to manoeuvre (DHNA: the Lower and Higher Ferries). */
  ram: boolean;
  length: number;
  beam: number;
  /** Speed over the ground (m/s). */
  sog: number;
  phase: VesselPhase;
  /** The Lower Ferry's tug: centre and heading. */
  tug?: { n: number; e: number; heading: number };
  /** Ramps: 0 down on the slip … 1 raised for the crossing. */
  ramp?: number;
  /** Solid outlines for contact (the float and its tug for the Lower Ferry). */
  parts: VesselPart[];
}

/** Where marina traffic starts and ends (from OSM, via the geodata), and where it goes. */
export interface MarinaSpec {
  name: string;
  n: number;
  e: number;
}

export interface TrafficOptions {
  /** Stream at real time epochMs (m/s): ferries crab into it; boats go faster or slower over the ground. */
  current?: (epochMs: number, n: number, e: number) => NE;
  /** Bed and land for marina boats' routes; without it there is no marina traffic. */
  fairway?: Omit<FairwayInput, 'avoid'> & { avoid?: { n: number; e: number }[] };
  marinas?: MarinaSpec[];
  /** Routes already found (they depend only on the bed and the end points), keyed by marina and destination. */
  fairwayCache?: Map<string, [number, number][] | undefined>;
}

// ------------------------------------------------------------------------------------------ clock

const DAY_MS = 86_400_000;

/** Last Sunday of a month at 01:00 UTC (the UK's daylight-saving changes). */
function lastSunday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** UK local time offset from UTC (h): British Summer Time from the last Sunday of March to that of October. */
export function ukOffsetHours(epochMs: number): number {
  const y = new Date(epochMs).getUTCFullYear();
  return epochMs >= lastSunday(y, 2) && epochMs < lastSunday(y, 9) ? 1 : 0;
}

/** The local calendar day and its midnight (as epoch ms). */
function localDay(epochMs: number): { day: number; midnight: number; weekday: number; month: number; date: string } {
  const off = ukOffsetHours(epochMs) * 3_600_000;
  const local = epochMs + off;
  const day = Math.floor(local / DAY_MS);
  // Midnight local: the offset at midnight can differ on change days; good enough for timetables.
  const midnight = day * DAY_MS - off;
  const d = new Date(day * DAY_MS);
  return { day, midnight, weekday: d.getUTCDay(), month: d.getUTCMonth(), date: d.toISOString().slice(0, 10) };
}

const min = (m: number) => m * 60_000;

// ------------------------------------------------------------------------------------------ routes

interface Route {
  pts: [number, number][];
  cum: number[];
  length: number;
}

function makeRoute(pts: [number, number][]): Route {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts, cum, length: cum[cum.length - 1]! };
}

/** Point and track direction (rad, compass) at distance s along a route. */
function along(r: Route, s: number): { e: number; n: number; dir: number } {
  const x = Math.min(Math.max(s, 0), r.length);
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i]! < x) i++;
  const [e0, n0] = r.pts[i - 1]!;
  const [e1, n1] = r.pts[i]!;
  const seg = r.cum[i]! - r.cum[i - 1]!;
  const f = seg > 0 ? (x - r.cum[i - 1]!) / seg : 0;
  return { e: e0 + (e1 - e0) * f, n: n0 + (n1 - n0) * f, dir: Math.atan2(e1 - e0, n1 - n0) };
}

function reversed(r: Route): Route {
  return makeRoute([...r.pts].reverse());
}

// ------------------------------------------------------------------------------------------ services

interface ServiceSpec {
  kind: VesselKind;
  label: string;
  length: number;
  beam: number;
  ram: boolean;
  /** Cruising speed through the water (m/s) and its acceleration and braking (m/s²). */
  vMax: number;
  accel: number;
  decel: number;
  /** Held on a cable: no crabbing; the stream does not change its speed over the ground. */
  cable?: boolean;
  /** Continuous shuttle (dwell range, s) or a timetable (minutes between departures). */
  dwell?: [number, number];
  interval?: number;
  /** First and last departures (local minutes after midnight) from end A and end B, by weekday (0 = Sunday). */
  hours: (weekday: number, month: number) => { a: [number, number]; b: [number, number] } | null;
  /** Units in service at a local time. */
  units?: (epochMs: number, localMin: number) => number;
  notes: string;
}

const KN = 1852 / 3600;
/** Dart harbour speed limit, Castle Ledge buoy to Home Reach (H3). */
export const HARBOUR_LIMIT = 6 * KN;
/** Harbour limit applies north of this northing (about Castle Ledge buoy's latitude; E). */
const HARBOUR_SOUTH_N = -1750;

const TUG = { length: 9.5, beam: 3.6 };
const LOWER_REFIT: [number, number] = [Date.UTC(2026, 9, 29), Date.UTC(2026, 11, 13, 23, 59)];

/** Service details by OSM route name. End A is the route's first point. */
const SERVICES: Record<string, ServiceSpec> = {
  'Dartmouth Lower Ferry': {
    kind: 'tug-float', label: 'Lower Ferry (tug and float)', length: 33, beam: 11, ram: true,
    vMax: 2.0, accel: 0.1, decel: 0.12, dwell: [70, 200],
    // A = Dartmouth (west), B = Kingswear (east): Dartmouth 07:10–22:55, Kingswear 07:00–22:45 (Sundays from 08:10 / 08:00).
    hours: (wd) => ({ a: [wd === 0 ? 8 * 60 + 10 : 7 * 60 + 10, 22 * 60 + 55], b: [wd === 0 ? 8 * 60 : 7 * 60, 22 * 60 + 45] }),
    units: (ms, m) => (ms >= LOWER_REFIT[0] && ms <= LOWER_REFIT[1] ? 1 : m >= 8 * 60 && m <= 20 * 60 ? 2 : 1),
    notes: 'Floats of 8 cars worked by the tugs Hauley IV-VI (F1), lashed alongside (F3); float and tug sizes, speed and loading times estimated (E); timetable and refit from the operator (S).',
  },
  'Dartmouth Higher Ferry': {
    kind: 'floating-bridge', label: 'Higher Ferry (floating bridge)', length: 50, beam: 16, ram: true,
    vMax: 2.5, accel: 0.08, decel: 0.1, dwell: [90, 210], cable: true,
    hours: () => ({ a: [6 * 60 + 30, 22 * 60 + 45], b: [6 * 60 + 35, 22 * 60 + 50] }),
    notes: 'A cable ferry (2009, Pendennis, F5; on two cables, F6); about a 3-minute crossing (operator, S). Size, hours and loading times estimated (E).',
  },
  'Dartmouth Pedestrian Ferry': {
    kind: 'passenger-ferry', label: 'Passenger ferry Dartmouth–Kingswear', length: 18, beam: 5.2, ram: false,
    vMax: 2.8, accel: 0.25, decel: 0.3, interval: 7.5,
    hours: () => ({ a: [7 * 60 + 30, 23 * 60], b: [7 * 60 + 34, 23 * 60] }),
    notes: 'Drawn as the Dartmouth Princess (18 m, 156 passengers, blue hull, F7); beam, timetable and speed estimated (E).',
  },
  'Dartmouth Castle Ferry': {
    kind: 'launch', label: 'Castle Ferry', length: 10, beam: 3.5, ram: false,
    vMax: 2.8, accel: 0.3, decel: 0.35, interval: 30,
    hours: (_wd, month) => (month >= 3 && month <= 9 ? { a: [10 * 60, 16 * 60 + 45], b: [10 * 60 + 15, 17 * 60] } : null),
    notes: 'Seasonal (April to October, E); timetable estimated (E).',
  },
  'Dartmouth / Dittisham Ferry': {
    kind: 'river-cruiser', label: 'Dittisham ferry', length: 12, beam: 4, ram: false,
    vMax: 2.9, accel: 0.25, decel: 0.3, interval: 60,
    hours: () => ({ a: [9 * 60 + 30, 17 * 60], b: [10 * 60, 17 * 60 + 30] }),
    notes: 'Timetable estimated (E).',
  },
  'Greenway Ferry': {
    kind: 'river-cruiser', label: 'Greenway ferry', length: 14, beam: 5, ram: false,
    vMax: 2.9, accel: 0.25, decel: 0.3, interval: 60,
    hours: () => ({ a: [10 * 60, 17 * 60], b: [10 * 60 + 30, 17 * 60 + 30] }),
    notes: 'Timetable estimated (E).',
  },
  'Noss on Dart / Dartmouth Ferry': {
    kind: 'launch', label: 'Noss ferry', length: 10, beam: 3.5, ram: false,
    vMax: 2.9, accel: 0.3, decel: 0.35, interval: 60,
    hours: () => ({ a: [8 * 60, 18 * 60], b: [8 * 60 + 20, 18 * 60 + 20] }),
    notes: 'Timetable estimated (E).',
  },
  'Totnes to Dartmouth Ferry': {
    kind: 'river-cruiser', label: 'Totnes river cruise', length: 30, beam: 6.4, ram: false,
    vMax: 2.9, accel: 0.15, decel: 0.2, interval: 90,
    hours: (_wd, month) => (month >= 3 && month <= 9 ? { a: [10 * 60, 16 * 60], b: [11 * 60, 17 * 60] } : null),
    notes: 'Drawn as the Cardiff Castle (30 m by 6.4 m, three decks, F8); seasonal; timetable estimated (E).',
  },
};

/** Fallback for a route without a service entry: the geodata's estimated timetable. */
function fallbackService(f: FerryRoute): ServiceSpec {
  return {
    kind: f.length > 20 ? 'river-cruiser' : 'launch', label: f.label, length: f.length, beam: f.beam, ram: f.ram,
    vMax: 2.8, accel: 0.25, decel: 0.3, interval: f.interval_min, hours: () => ({ a: [7 * 60, 23 * 60], b: [7 * 60, 23 * 60] }), notes: 'Estimated (E).',
  };
}

/** Marina boats (E): share of each kind, length, beam, speeds in the harbour and outside. */
const MARINA_KINDS: { kind: VesselKind; share: number; length: number; beam: number; vHarbour: number; vSea: number; label: string }[] = [
  { kind: 'motor-cruiser', share: 0.5, length: 10.5, beam: 3.6, vHarbour: 2.7, vSea: 7.5, label: 'motor cruiser' },
  { kind: 'yacht', share: 0.35, length: 10, beam: 3.3, vHarbour: 2.5, vSea: 3.0, label: 'yacht under engine' },
  { kind: 'rib', share: 0.15, length: 6.5, beam: 2.5, vHarbour: 2.9, vSea: 10, label: 'RIB' },
];

/** Marina movements a day (each way counts one), by month (E). */
const MARINA_MOVES = [4, 4, 6, 12, 20, 26, 32, 32, 22, 12, 6, 4];

// ------------------------------------------------------------------------------------------ trips

interface Sample {
  t: number;
  s: number;
  v: number;
  crab: number;
  hold: boolean;
}

interface Trip {
  /** Departure (epoch ms) and arrival. */
  t0: number;
  t1: number;
  route: Route;
  samples: Sample[];
  /** Lower Ferry: time spent clearing the slip and swinging the tug before the crossing (s). */
  prelude: number;
  /** The second unit's mirror of the first's crossing: the cross-stream is on the other hand. */
  mirror?: boolean;
}

interface Crossing {
  /** Distance along the trip's route of a ferry track crossing, and the ferry that uses it. */
  s: number;
  ferry: string;
}

/** Speed profile along a route from time t0: accelerate, cruise (harbour limit), slow to arrive, hold for ferries. */
function profile(
  route: Route,
  t0: number,
  v: { cruise: number; sea?: number; accel: number; decel: number; cable?: boolean },
  current: TrafficOptions['current'],
  hold?: (s: number, epochMs: number) => boolean,
): Sample[] {
  const dt = 1;
  const out: Sample[] = [{ t: 0, s: 0, v: 0, crab: 0, hold: false }];
  let s = 0;
  let speed = 0;
  let t = 0;
  while (s < route.length && t < 4 * 3600) {
    const p = along(route, s);
    const limit = p.n > HARBOUR_SOUTH_N ? Math.min(v.cruise, HARBOUR_LIMIT) : (v.sea ?? v.cruise);
    const remaining = route.length - s;
    const waiting = hold ? hold(s, t0 + t * 1000) : false;
    const target = waiting ? 0 : Math.min(limit, Math.sqrt(2 * v.decel * remaining) + 0.25);
    speed = target > speed ? Math.min(target, speed + v.accel * dt) : Math.max(target, speed - v.decel * dt);
    let sog = speed;
    let crab = 0;
    if (current && !v.cable) {
      const c = current(t0 + t * 1000, p.n, p.e);
      const ca = c.n * Math.cos(p.dir) + c.e * Math.sin(p.dir);
      const cx = -c.n * Math.sin(p.dir) + c.e * Math.cos(p.dir);
      // Head up into the cross-stream so the track stays on the route.
      const sinCrab = speed > 0.05 ? Math.max(-0.7, Math.min(0.7, -cx / speed)) : 0;
      crab = Math.asin(sinCrab);
      sog = speed * Math.cos(crab) + ca;
      if (!waiting && sog < 0.25) sog = 0.25;
    }
    if (waiting) sog = 0;
    t += dt;
    s = Math.min(route.length, s + Math.max(0, sog) * dt);
    out.push({ t, s, v: sog, crab, hold: waiting });
  }
  return out;
}

function stateOnTrip(trip: Trip, epochMs: number): { s: number; v: number; crab: number; hold: boolean } {
  const tt = (epochMs - trip.t0) / 1000 - trip.prelude;
  const sm = trip.samples;
  if (tt <= 0) return { s: 0, v: 0, crab: 0, hold: false };
  const last = sm[sm.length - 1]!;
  if (tt >= last.t) return { s: last.s, v: 0, crab: 0, hold: false };
  let lo = 0;
  let hi = sm.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sm[mid]!.t <= tt) lo = mid;
    else hi = mid;
  }
  const a = sm[lo]!;
  const b = sm[hi]!;
  const f = (tt - a.t) / (b.t - a.t);
  return { s: a.s + (b.s - a.s) * f, v: a.v + (b.v - a.v) * f, crab: a.crab + (b.crab - a.crab) * f, hold: b.hold };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Shortest signed angle a − b. */
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function segIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number | undefined {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

// ------------------------------------------------------------------------------------------ model

interface FerryService {
  name: string;
  spec: ServiceSpec;
  route: Route;
  back: Route;
}

interface Leg {
  trip: Trip;
  fromA: boolean;
  /** Time the vessel is at the destination slip until (the next departure), epoch ms. */
  until: number;
}

interface MarinaTrip {
  id: string;
  kind: (typeof MARINA_KINDS)[number];
  trip: Trip;
  outbound: boolean;
}

export class RiverTraffic {
  private readonly services: FerryService[];
  private readonly legs = new Map<string, Leg[]>();
  private readonly marinaDays = new Map<number, MarinaTrip[]>();
  private readonly marinaRoutes: { name: string; route: Route; crossings: Crossing[] }[] = [];
  /** Routes the marina boats use (for drawing and tests). */
  readonly fairways: { name: string; route: [number, number][] }[] = [];

  constructor(ferries: readonly FerryRoute[], private readonly opts: TrafficOptions = {}) {
    this.services = ferries.map((f) => {
      const route = makeRoute(f.route);
      return { name: f.name, spec: SERVICES[f.name] ?? fallbackService(f), route, back: reversed(route) };
    });
    const fw = opts.fairway;
    for (const m of fw ? (opts.marinas ?? []) : []) {
      // Out to sea past Castle Ledge, and up-river towards Dittisham (E: the destinations).
      for (const [name, to] of [['sea', { n: -2300, e: 1400 }], ['upriver', { n: 3300, e: -560 }]] as const) {
        const key = `${m.name}|${m.n}|${m.e}|${name}`;
        const cache = opts.fairwayCache;
        const pts = cache?.has(key) ? cache.get(key) : fairwayRoute({ ...fw!, avoid: fw!.avoid, avoidRadius: 10 }, { n: m.n, e: m.e }, to);
        cache?.set(key, pts);
        if (!pts || pts.length < 2) continue;
        const route = makeRoute(pts);
        const crossings: Crossing[] = [];
        for (const sv of this.services.filter((x) => x.spec.ram)) {
          for (let i = 1; i < route.pts.length; i++) {
            for (let j = 1; j < sv.route.pts.length; j++) {
              const t = segIntersect(route.pts[i - 1]!, route.pts[i]!, sv.route.pts[j - 1]!, sv.route.pts[j]!);
              if (t !== undefined) crossings.push({ s: route.cum[i - 1]! + t * (route.cum[i]! - route.cum[i - 1]!), ferry: sv.name });
            }
          }
        }
        this.marinaRoutes.push({ name: `${m.name}-${name}`, route, crossings });
        this.fairways.push({ name: `${m.name} → ${name}`, route: pts });
      }
    }
  }

  /** Notes on where each service's details come from. */
  serviceNotes(): { name: string; label: string; notes: string }[] {
    return this.services.map((s) => ({ name: s.name, label: s.spec.label, notes: s.spec.notes }));
  }

  /** Every vessel on the water at this moment. */
  states(epochMs: number): VesselState[] {
    const out: VesselState[] = [];
    for (const sv of this.services) {
      const units = sv.spec.dwell ? 2 : 1;
      for (let u = 0; u < units; u++) {
        const st = sv.spec.dwell ? this.shuttleState(sv, u, epochMs) : this.timetableState(sv, epochMs);
        if (st) out.push(st);
      }
    }
    out.push(...this.marinaStates(epochMs));
    return out;
  }

  // ---------------------------------------------------------------- shuttles (Lower and Higher Ferries)

  /** The day's legs for one unit of a shuttle, generated in order (each leg's length depends on the stream). */
  private shuttleLegs(sv: FerryService, unit: number, epochMs: number): { legs: Leg[]; day: ReturnType<typeof localDay>; start: number; end: number } | undefined {
    const day = localDay(epochMs);
    const hrs = sv.spec.hours(day.weekday, day.month);
    if (!hrs) return undefined;
    // Unit 0 starts from end B (Kingswear for the Lower Ferry), unit 1 from end A.
    const startFromA = unit === 1;
    const first = startFromA ? hrs.a[0] : hrs.b[0];
    const key = `${sv.name}|${unit}|${day.day}`;
    let legs = this.legs.get(key);
    if (!legs) {
      legs = [];
      this.legs.set(key, legs);
      if (this.legs.size > 64) this.legs.delete(this.legs.keys().next().value!);
    }
    const rng = createRng(hash(key));
    const dwells: number[] = [];
    const dwellAt = (k: number) => {
      while (dwells.length <= k) dwells.push(sv.spec.dwell![0] + rng.next() * (sv.spec.dwell![1] - sv.spec.dwell![0]));
      return dwells[k]!;
    };
    let t = legs.length ? legs[legs.length - 1]!.until : day.midnight + min(first);
    let fromA = legs.length ? !legs[legs.length - 1]!.fromA : startFromA;
    while (t <= epochMs + 1000) {
      const lastDep = fromA ? hrs.a[1] : hrs.b[1];
      if (t > day.midnight + min(lastDep)) break;
      const route = fromA ? sv.route : sv.back;
      const tug = sv.spec.kind === 'tug-float';
      const prelude = tug ? 55 : 0;
      const samples = profile(route, t + prelude * 1000, { cruise: sv.spec.vMax, accel: sv.spec.accel, decel: sv.spec.decel, cable: sv.spec.cable }, this.opts.current);
      const t1 = t + (prelude + samples[samples.length - 1]!.t) * 1000;
      const until = t1 + dwellAt(legs.length) * 1000;
      legs.push({ trip: { t0: t, t1, route, samples, prelude }, fromA, until });
      t = until;
      fromA = !fromA;
    }
    return { legs, day, start: day.midnight + min(first), end: day.midnight + min(Math.max(hrs.a[1], hrs.b[1])) };
  }

  private shuttleState(sv: FerryService, unit: number, epochMs: number): VesselState | undefined {
    const spec = sv.spec;
    // The first unit runs all day; a second (when two are in service) runs opposite it: each leaves one slip
    // as the other leaves the far one, so they pass mid-stream. Where a spare lies when not in service is not
    // known, so it is not drawn then.
    const sched = this.shuttleLegs(sv, 0, epochMs);
    const base = { id: `${sv.name}#${unit}`, name: sv.name, label: spec.label, unit, kind: spec.kind, ram: spec.ram, length: spec.length, beam: spec.beam };
    const legs = sched?.legs ?? [];
    let leg: Leg | undefined;
    for (let i = legs.length - 1; i >= 0; i--) {
      if (legs[i]!.trip.t0 <= epochMs) {
        leg = legs[i];
        break;
      }
    }
    if (unit > 0) {
      const day = sched?.day ?? localDay(epochMs);
      if (!leg || (spec.units?.(leg.trip.t0, (leg.trip.t0 - day.midnight) / 60_000) ?? 1) < 2) return undefined;
      const route = leg.fromA ? sv.back : sv.route;
      leg = { ...leg, fromA: !leg.fromA, trip: { ...leg.trip, route, mirror: true } };
    }
    if (!leg) {
      // Overnight at the slip it starts from.
      const p = along(sv.back, 0);
      return this.berthed(base, p, p.dir, spec, unit, epochMs, 0);
    }
    const trip = leg.trip;
    const tt = (epochMs - trip.t0) / 1000;
    if (epochMs >= trip.t1) {
      const p = along(trip.route, trip.route.length);
      return this.berthed(base, p, p.dir, spec, unit, epochMs, (epochMs - trip.t1) / 1000, (leg.until - epochMs) / 1000);
    }
    const q = stateOnTrip(trip, epochMs);
    if (trip.mirror) q.crab = -q.crab;
    const p = along(trip.route, q.s);
    const heading = p.dir + q.crab;
    const st: VesselState = { ...base, n: p.n, e: p.e, heading, moving: true, sog: q.v, phase: q.hold ? 'holding' : 'underway', ramp: 1, parts: [] };
    if (spec.kind === 'tug-float') {
      if (tt < 20) {
        // Clearing the slip: the tug goes astern and pulls the float off, about 12 m.
        const f = tt / 20;
        const d = 12 * f * f * (3 - 2 * f);
        const p0 = along(trip.route, d);
        Object.assign(st, { n: p0.n, e: p0.e, heading: p0.dir, phase: 'clearing' as const, sog: 0.6 * Math.sin(Math.PI * f), ramp: Math.min(1, tt / 6) });
        st.tug = this.tugPose(st, unit, Math.PI);
      } else if (tt < trip.prelude) {
        // Swinging: held by the head rope, the tug turns end for end to face the other bank.
        const f = (tt - 20) / (trip.prelude - 20);
        const p0 = along(trip.route, 12);
        Object.assign(st, { n: p0.n, e: p0.e, heading: p0.dir, phase: 'swinging' as const, sog: 0 });
        st.tug = this.tugPose(st, unit, Math.PI * (1 - f * f * (3 - 2 * f)));
      } else {
        // Keep the 12 m already made good while clearing.
        const p1 = along(trip.route, Math.max(12, q.s));
        Object.assign(st, { n: p1.n, e: p1.e, heading: p1.dir + q.crab });
        st.tug = this.tugPose(st, unit, 0);
      }
    }
    st.parts = this.partsOf(st);
    return st;
  }

  /** Berthed at a slip: ramps down while loading, raised in the last seconds before leaving. */
  private berthed(base: Omit<VesselState, 'n' | 'e' | 'heading' | 'moving' | 'sog' | 'phase' | 'parts'>, p: { n: number; e: number }, heading: number, spec: ServiceSpec, unit: number, _epochMs: number, since: number, left = Infinity): VesselState {
    const ramp = Math.max(1 - Math.min(1, since / 8), 1 - Math.min(1, left / 6));
    const st: VesselState = { ...base, n: p.n, e: p.e, heading, moving: false, sog: 0, phase: 'berthed', ramp, parts: [] };
    if (spec.kind === 'tug-float') st.tug = this.tugPose(st, unit, 0);
    st.parts = this.partsOf(st);
    return st;
  }

  /**
   * The tug alongside the float, on the same side for each unit (E). `swing` is its heading relative to the
   * float's direction of travel (0 = facing the far bank, π = facing back at the slip); it turns about its
   * bow, where the head rope is made fast, so its stern swings out away from the float.
   */
  private tugPose(float: { n: number; e: number; heading: number; length: number; beam: number }, unit: number, swing: number): { n: number; e: number; heading: number } {
    const side = unit === 0 ? 1 : -1;
    const fwd = { n: Math.cos(float.heading), e: Math.sin(float.heading) };
    const out = { n: -fwd.e * side, e: fwd.n * side };
    const lateral = float.beam / 2 + TUG.beam / 2 + 0.3;
    // Bow (head-rope point) a little aft of midships.
    const bow = { n: float.n + out.n * lateral - fwd.n * 0.5, e: float.e + out.e * lateral - fwd.e * 0.5 };
    const hn = Math.cos(swing) * fwd.n - Math.sin(swing) * out.n;
    const he = Math.cos(swing) * fwd.e - Math.sin(swing) * out.e;
    return { n: bow.n - (TUG.length / 2) * hn, e: bow.e - (TUG.length / 2) * he, heading: Math.atan2(he, hn) };
  }

  private partsOf(st: VesselState): VesselPart[] {
    const parts: VesselPart[] = [{ n: st.n, e: st.e, heading: st.heading, length: st.length, beam: st.beam }];
    if (st.tug) parts.push({ ...st.tug, length: TUG.length, beam: TUG.beam });
    return parts;
  }

  // ---------------------------------------------------------------- timetabled services

  private timetableState(sv: FerryService, epochMs: number): VesselState | undefined {
    const spec = sv.spec;
    const day = localDay(epochMs);
    const hrs = spec.hours(day.weekday, day.month);
    const base = { id: `${sv.name}#0`, name: sv.name, label: spec.label, unit: 0, kind: spec.kind, ram: spec.ram, length: spec.length, beam: spec.beam };
    if (!hrs) return undefined;
    const interval = spec.interval ?? 30;
    // Departures alternate: from A at the first time, then from B one interval later, and so on.
    const t0 = day.midnight + min(hrs.a[0]);
    const k = Math.floor((epochMs - t0) / min(interval));
    const lastK = Math.floor((day.midnight + min(Math.max(hrs.a[1], hrs.b[1])) - t0) / min(interval));
    if (k < 0) {
      const p = along(sv.route, 0);
      return { ...base, n: p.n, e: p.e, heading: p.dir, moving: false, sog: 0, phase: 'berthed', parts: [{ n: p.n, e: p.e, heading: p.dir, length: spec.length, beam: spec.beam }] };
    }
    const kk = Math.min(k, lastK);
    const fromA = kk % 2 === 0;
    const route = fromA ? sv.route : sv.back;
    const dep = t0 + kk * min(interval);
    const key = `${sv.name}|${dep}`;
    let trip = this.tripCache.get(key);
    if (!trip) {
      const samples = profile(route, dep, { cruise: spec.vMax, accel: spec.accel, decel: spec.decel, cable: spec.cable }, this.opts.current);
      trip = { t0: dep, t1: dep + samples[samples.length - 1]!.t * 1000, route, samples, prelude: 0 };
      this.tripCache.set(key, trip);
      if (this.tripCache.size > 256) this.tripCache.delete(this.tripCache.keys().next().value!);
    }
    const q = epochMs < trip.t1 ? stateOnTrip(trip, epochMs) : { s: route.length, v: 0, crab: 0, hold: false };
    const p = along(route, q.s);
    const heading = p.dir + q.crab;
    const moving = epochMs < trip.t1 && k <= lastK;
    return { ...base, n: p.n, e: p.e, heading, moving, sog: moving ? q.v : 0, phase: moving ? 'underway' : 'berthed', parts: [{ n: p.n, e: p.e, heading, length: spec.length, beam: spec.beam }] };
  }

  private readonly tripCache = new Map<string, Trip>();

  // ---------------------------------------------------------------- Dart Marina

  private marinaTrips(day: ReturnType<typeof localDay>): MarinaTrip[] {
    let trips = this.marinaDays.get(day.day);
    if (trips) return trips;
    trips = [];
    if (this.marinaRoutes.length) {
      const rng = createRng(hash(`marina|${day.day}`));
      const moves = MARINA_MOVES[day.month]!;
      for (let k = 0; k < moves; k++) {
        // Daylight hours (E): departures and returns spread between 08:00 and 19:30.
        const t0 = day.midnight + min(8 * 60 + rng.next() * 11.5 * 60);
        let x = rng.next();
        const kind = MARINA_KINDS.find((m) => (x -= m.share) < 0) ?? MARINA_KINDS[0]!;
        const outbound = rng.next() < 0.5;
        const mr = this.marinaRoutes[rng.next() < 0.7 ? 0 : Math.min(1, this.marinaRoutes.length - 1)]!;
        const route = outbound ? mr.route : reversed(mr.route);
        const crossings = mr.crossings.map((c) => ({ ...c, s: outbound ? c.s : mr.route.length - c.s }));
        const hold = (s: number, ms: number) => crossings.some((c) => c.s - s > 0 && c.s - s < 45 && this.ferryNear(c.ferry, route, c.s, ms));
        const samples = profile(route, t0, { cruise: kind.vHarbour, sea: kind.vSea, accel: 0.35, decel: 0.3 }, this.opts.current, hold);
        trips.push({ id: `marina-${day.day}-${k}`, kind, outbound, trip: { t0, t1: t0 + samples[samples.length - 1]!.t * 1000, route, samples, prelude: 0 } });
      }
    }
    this.marinaDays.set(day.day, trips);
    if (this.marinaDays.size > 4) this.marinaDays.delete(this.marinaDays.keys().next().value!);
    return trips;
  }

  /** Is a ferry under way within 90 m of where a route crosses its track? (Boats give it room.) */
  private ferryNear(name: string, route: Route, s: number, epochMs: number): boolean {
    const sv = this.services.find((x) => x.name === name);
    if (!sv) return false;
    const p = along(route, s);
    for (let u = 0; u < (sv.spec.dwell ? 2 : 1); u++) {
      const st = sv.spec.dwell ? this.shuttleState(sv, u, epochMs) : this.timetableState(sv, epochMs);
      if (st && st.moving && Math.hypot(st.n - p.n, st.e - p.e) < 90 + st.length / 2) return true;
    }
    return false;
  }

  private marinaStates(epochMs: number): VesselState[] {
    if (!this.marinaRoutes.length) return [];
    const day = localDay(epochMs);
    const out: VesselState[] = [];
    for (const m of this.marinaTrips(day)) {
      if (epochMs < m.trip.t0 || epochMs > m.trip.t1) continue;
      const q = stateOnTrip(m.trip, epochMs);
      const p = along(m.trip.route, q.s);
      const heading = p.dir + q.crab;
      out.push({
        id: m.id, name: 'Dart Marina', label: `${m.kind.label} ${m.outbound ? 'leaving' : 'returning to'} Dart Marina`, unit: 0, kind: m.kind.kind,
        n: p.n, e: p.e, heading, moving: true, ram: false, length: m.kind.length, beam: m.kind.beam, sog: q.v, phase: q.hold ? 'holding' : 'underway',
        parts: [{ n: p.n, e: p.e, heading, length: m.kind.length, beam: m.kind.beam }],
      });
    }
    return out;
  }
}

/** For tests: the heading difference helper. */
export const _angleDiff = angleDiff;

/**
 * Marinas with traffic. Dart Marina: the centroid of its OpenStreetMap leisure=marina area (via Overture
 * land_use, docs/SOURCES.md G1), on the Dartmouth side just up-river of the Higher Ferry (S).
 */
export const DART_MARINAS: MarinaSpec[] = [{ name: 'Dart Marina', n: 1151, e: -251 }];
const routeCache = new WeakMap<object, Map<string, [number, number][] | undefined>>();
/** Level (m ODN) the marina boats' routes are found at: about mean low water springs (E), so they work at most states of tide. */
const ROUTE_LEVEL_ODN = -2.0;

/** The River Dart's traffic: ferries on their routes, with the stream, and Dart Marina's boats on routes through deep water. */
export function buildRiverTraffic(o: {
  ferries: readonly FerryRoute[];
  current?: (epochMs: number, n: number, e: number) => NE;
  geo?: { bedElevation(n: number, e: number): number; inDomain(n: number, e: number): boolean };
  moorings?: { n: number; e: number }[];
  marinas?: MarinaSpec[];
}): RiverTraffic {
  let cache: Map<string, [number, number][] | undefined> | undefined;
  if (o.geo) {
    cache = routeCache.get(o.geo);
    if (!cache) routeCache.set(o.geo, (cache = new Map()));
  }
  return new RiverTraffic(o.ferries, {
    fairwayCache: cache,
    current: o.current,
    fairway: o.geo ? { bedElevation: (n, e) => o.geo!.bedElevation(n, e), inDomain: (n, e) => o.geo!.inDomain(n, e), waterLevelOdn: ROUTE_LEVEL_ODN, avoid: o.moorings, minDepth: 1.5 } : undefined,
    marinas: o.marinas ?? DART_MARINAS,
  });
}
