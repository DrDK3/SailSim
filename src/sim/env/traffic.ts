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
  /** Water level (m ODN) at real time epochMs: the Lower Ferry berths further down its slips at low water. */
  waterLevel?: (epochMs: number) => number;
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

/** The part of a route from s0 to s1 (s0 < s1). */
function cut(r: Route, s0: number, s1: number): Route {
  const a = along(r, s0);
  const b = along(r, s1);
  const pts: [number, number][] = [[a.e, a.n]];
  for (let i = 1; i < r.pts.length - 1; i++) if (r.cum[i]! > s0 && r.cum[i]! < s1) pts.push(r.pts[i]!);
  pts.push([b.e, b.n]);
  return makeRoute(pts);
}

/**
 * Point and heading at s along a trip, standing off `offset` metres to starboard mid-way (0 at the ends): two
 * Lower Ferry units meeting head-on each alter to starboard and pass port to port (COLREGS rule 14).
 */
function tripPoint(r: Route, s: number, offset = 0): { e: number; n: number; dir: number } {
  const p = along(r, s);
  if (!offset || r.length <= 0) return p;
  const k = Math.PI / r.length;
  const x = Math.min(Math.max(s, 0), r.length);
  const off = offset * Math.sin(k * x) ** 2;
  const slope = offset * k * Math.sin(2 * k * x);
  return { n: p.n - Math.sin(p.dir) * off, e: p.e + Math.cos(p.dir) * off, dir: p.dir + Math.atan(slope) };
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
/**
 * The Lower Ferry at its slips (E): the float lies as far up the slip as the water allows - its spoon ends
 * draw less than its middle - with the tug afloat alongside and room for the tug to swing 12 m off. So it
 * berths further down the slip at low water. Drafts, clearance and the swing room are estimates.
 */
const SLIP = { floatDraft: 0.9, endDraft: 0.45, tugDraft: 1.3, clearance: 0.3, clearOff: 12, minExtra: 2, max: 90, step: 0.5 };
/** Mean sea level (m ODN), used for the berths when the run has no tide (E). */
const MEAN_LEVEL_ODN = 0;
/** Two Lower Ferry units meeting mid-river each stand this far off to starboard (E). */
const PASSING_OFFSET = 20;
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
  /** Stand-off to starboard mid-way (m) when meeting another unit. */
  pass?: number;
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
  /** Lower Ferry: the tug's side (+1 starboard going A to B) and the berth at each slip for a water level. */
  slips?: Slips;
}

interface Slips {
  sideAB: number;
  /** Distance of the float's centre from the top of the slip at end A and at end B, for a water level (m ODN). */
  a: (level: number) => number;
  b: (level: number) => number;
}

interface Leg {
  trip: Trip;
  fromA: boolean;
  /** Time the vessel is at the destination slip until (the next departure), epoch ms. */
  until: number;
  /** The second unit's crossing at the same time, the other way (made when first needed). */
  mirror?: Trip;
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
      const sv: FerryService = { name: f.name, spec: SERVICES[f.name] ?? fallbackService(f), route, back: reversed(route) };
      if (sv.spec.kind === 'tug-float') sv.slips = this.slipBerths(sv);
      return sv;
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

  private level(epochMs: number): number {
    return this.opts.waterLevel?.(epochMs) ?? MEAN_LEVEL_ODN;
  }

  /**
   * Where the Lower Ferry lies at each slip. For every distance d of the float's centre from the top of the
   * slip, the lowest water level at which the float there (and everywhere further out) is afloat, the tug
   * alongside is afloat, and the tug can swing end for end 12 m off. The berth for a level is the smallest
   * such d. The tug works on one side of the float all day: the side that lets it berth furthest up both slips.
   * Without the bed (tests), the float lies just off the top of each slip.
   */
  private slipBerths(sv: FerryService): Slips {
    const L = sv.spec.length;
    const dMin = L / 2 + SLIP.minExtra;
    const bed = this.opts.fairway?.bedElevation;
    if (!bed) return { sideAB: 1, a: () => dMin, b: () => dMin };
    const n = Math.round((SLIP.max - dMin) / SLIP.step) + 1;
    /** Level needed at each d, from the slip at the start of `out`, with the tug on side `side` of `out`. */
    const need = (out: Route, side: number): Float64Array => {
      const req = new Float64Array(n).fill(-Infinity);
      const fl = { n: 0, e: 0, heading: 0, length: L, beam: sv.spec.beam };
      let i = 0;
      const probe = (pn: number, pe: number, depth: number) => (req[i] = Math.max(req[i]!, bed(pn, pe) + depth + SLIP.clearance));
      const at = (d: number, lat: number, depth: number) => {
        const p = along(out, d);
        probe(p.n - Math.sin(p.dir) * lat, p.e + Math.cos(p.dir) * lat, depth);
      };
      const tugAt = (t: { n: number; e: number; heading: number }) => {
        for (const k of [-0.4, 0, 0.4]) probe(t.n + Math.cos(t.heading) * k * TUG.length, t.e + Math.sin(t.heading) * k * TUG.length, SLIP.tugDraft);
      };
      for (i = 0; i < n; i++) {
        const d = dMin + i * SLIP.step;
        // The float: its spoon end nearest the slip, its middle and its outer end, on the centreline and at the sides.
        at(d - L / 2 + 1, 0, SLIP.endDraft);
        for (const x of [-L / 4, 0, L / 4, L / 2 - 1]) for (const lat of [-1, 0, 1]) at(d + x, lat * (sv.spec.beam / 2 - 0.6), SLIP.floatDraft);
        // The tug alongside, facing the slip (as it arrives and as it leaves), and swinging 12 m off.
        const p = along(out, d);
        Object.assign(fl, { n: p.n, e: p.e, heading: p.dir });
        tugAt(this.tugPose(fl, side, Math.PI));
        const q = along(out, d + SLIP.clearOff);
        Object.assign(fl, { n: q.n, e: q.e, heading: q.dir });
        for (let k = 0; k <= 4; k++) tugAt(this.tugPose(fl, side, (Math.PI * k) / 4));
      }
      // Everything further out must be afloat too: the need never rises going out.
      for (let k = n - 2; k >= 0; k--) req[k] = Math.max(req[k]!, req[k + 1]!);
      return req;
    };
    /** Berth distance for a level: the need curve read backwards, interpolated so the float creeps with the tide. */
    const berth = (req: Float64Array) => (level: number): number => {
      if (level >= req[0]!) return dMin;
      for (let k = 1; k < n; k++) {
        if (req[k]! <= level) {
          const f = (req[k - 1]! - level) / (req[k - 1]! - req[k]!);
          return dMin + (k - 1 + f) * SLIP.step;
        }
      }
      return SLIP.max;
    };
    let best: Slips | undefined;
    let bestScore = Infinity;
    for (const sideAB of [1, -1]) {
      // Leaving B is going B to A: the tug's side, relative to that direction, is the other one.
      const a = berth(need(sv.route, sideAB));
      const b = berth(need(sv.back, -sideAB));
      let score = 0;
      for (let lv = -2.5; lv <= 2.5; lv += 0.5) score += a(lv) + b(lv);
      if (score < bestScore - 1e-6) {
        bestScore = score;
        best = { sideAB, a, b };
      }
    }
    return best!;
  }

  /** The route for a crossing: from the berth at the departure slip (tide at t0) to the berth at the far one (tide at t1). */
  private crossing(sv: FerryService, fromA: boolean, t0: number, t1: number): Route {
    const r = fromA ? sv.route : sv.back;
    if (!sv.slips) return r;
    const [from, to] = fromA ? [sv.slips.a, sv.slips.b] : [sv.slips.b, sv.slips.a];
    const s0 = from(this.level(t0));
    const s1 = Math.max(s0 + 1, r.length - to(this.level(t1)));
    return cut(r, s0, s1);
  }

  /** Where the float lies at a slip now (centre and heading into the slip, as it arrived). */
  private atSlip(sv: FerryService, atA: boolean, epochMs: number): { n: number; e: number; dir: number } {
    const out = atA ? sv.route : sv.back;
    const d = sv.slips ? (atA ? sv.slips.a : sv.slips.b)(this.level(epochMs)) : 0;
    const p = along(out, d);
    return { n: p.n, e: p.e, dir: p.dir + Math.PI };
  }

  /** The tug's side relative to the direction of travel of a crossing from A (or from B). */
  private tugSide(sv: FerryService, fromA: boolean): number {
    const s = sv.slips?.sideAB ?? 1;
    return fromA ? s : -s;
  }

  /** Two units in service at a time (the Lower Ferry in the day). */
  private twoUnits(sv: FerryService, t0: number): boolean {
    const day = localDay(t0);
    return (sv.spec.units?.(t0, (t0 - day.midnight) / 60_000) ?? 1) >= 2;
  }

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
      const tug = sv.spec.kind === 'tug-float';
      const prelude = tug ? 55 : 0;
      const v = { cruise: sv.spec.vMax, accel: sv.spec.accel, decel: sv.spec.decel, cable: sv.spec.cable };
      // The far berth depends on the tide when she gets there: estimate the arrival, then again from the profile.
      let route = this.crossing(sv, fromA, t, t + (prelude + (1.4 * sv.route.length) / sv.spec.vMax) * 1000);
      let samples = profile(route, t + prelude * 1000, v, this.opts.current);
      let t1 = t + (prelude + samples[samples.length - 1]!.t) * 1000;
      if (sv.slips) {
        const again = this.crossing(sv, fromA, t, t1);
        if (Math.abs(again.length - route.length) > 0.05) {
          route = again;
          samples = profile(route, t + prelude * 1000, v, this.opts.current);
          t1 = t + (prelude + samples[samples.length - 1]!.t) * 1000;
        }
      }
      const until = t1 + dwellAt(legs.length) * 1000;
      const pass = tug && this.twoUnits(sv, t) ? PASSING_OFFSET : 0;
      legs.push({ trip: { t0: t, t1, route, samples, prelude, pass }, fromA, until });
      t = until;
      fromA = !fromA;
    }
    return { legs, day, start: day.midnight + min(first), end: day.midnight + min(Math.max(hrs.a[1], hrs.b[1])) };
  }

  /** The second unit's crossing, the other way at the same time: the first unit's speed profile on its own route. */
  private mirrorTrip(sv: FerryService, leg: Leg): Trip {
    if (leg.mirror) return leg.mirror;
    const t = leg.trip;
    const route = this.crossing(sv, !leg.fromA, t.t0, t.t1);
    const k = route.length / t.route.length;
    leg.mirror = { ...t, route, mirror: true, samples: t.samples.map((x) => ({ ...x, s: x.s * k, v: x.v * k })) };
    return leg.mirror;
  }

  private shuttleState(sv: FerryService, unit: number, epochMs: number): VesselState | undefined {
    const spec = sv.spec;
    // The first unit runs all day; a second (when two are in service) runs opposite it: each leaves one slip
    // as the other leaves the far one, so they meet mid-stream, where each stands off to starboard and they
    // pass port to port. Where a spare lies when not in service is not known, so it is not drawn then.
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
    let fromA = leg?.fromA ?? false;
    let trip = leg?.trip;
    if (unit > 0) {
      if (!leg || !this.twoUnits(sv, leg.trip.t0)) return undefined;
      fromA = !leg.fromA;
      trip = this.mirrorTrip(sv, leg);
    }
    if (!leg || !trip) {
      // Overnight at the slip it starts from (B), as it arrived there.
      const p = this.atSlip(sv, false, epochMs);
      return this.berthed(base, p, spec, this.tugSide(sv, true), 0);
    }
    const tt = (epochMs - trip.t0) / 1000;
    if (epochMs >= trip.t1) {
      // At the far slip: the berth follows the tide (it was where the crossing ended at arrival).
      const p = sv.slips ? this.atSlip(sv, !fromA, epochMs) : (() => {
        const q = along(trip.route, trip.route.length);
        return { n: q.n, e: q.e, dir: q.dir };
      })();
      return this.berthed(base, p, spec, this.tugSide(sv, fromA), (epochMs - trip.t1) / 1000, (leg.until - epochMs) / 1000);
    }
    const q = stateOnTrip(trip, epochMs);
    if (trip.mirror) q.crab = -q.crab;
    const p = tripPoint(trip.route, q.s, trip.pass);
    const heading = p.dir + q.crab;
    const st: VesselState = { ...base, n: p.n, e: p.e, heading, moving: true, sog: q.v, phase: q.hold ? 'holding' : 'underway', ramp: 1, parts: [] };
    if (spec.kind === 'tug-float') {
      const side = this.tugSide(sv, fromA);
      if (tt < 20) {
        // Clearing the slip: the tug goes astern and pulls the float off, about 12 m.
        const f = tt / 20;
        const d = SLIP.clearOff * f * f * (3 - 2 * f);
        const p0 = tripPoint(trip.route, d, trip.pass);
        Object.assign(st, { n: p0.n, e: p0.e, heading: p0.dir, phase: 'clearing' as const, sog: 0.6 * Math.sin(Math.PI * f), ramp: Math.min(1, tt / 6) });
        st.tug = this.tugPose(st, side, Math.PI);
      } else if (tt < trip.prelude) {
        // Swinging: held by the head rope, the tug turns end for end to face the other bank.
        const f = (tt - 20) / (trip.prelude - 20);
        const p0 = tripPoint(trip.route, SLIP.clearOff, trip.pass);
        Object.assign(st, { n: p0.n, e: p0.e, heading: p0.dir, phase: 'swinging' as const, sog: 0 });
        st.tug = this.tugPose(st, side, Math.PI * (1 - f * f * (3 - 2 * f)));
      } else {
        // Keep the 12 m already made good while clearing.
        const p1 = tripPoint(trip.route, Math.max(SLIP.clearOff, q.s), trip.pass);
        Object.assign(st, { n: p1.n, e: p1.e, heading: p1.dir + q.crab });
        st.tug = this.tugPose(st, side, 0);
      }
    }
    st.parts = this.partsOf(st);
    return st;
  }

  /** Berthed at a slip: ramps down while loading, raised in the last seconds before leaving. */
  private berthed(base: Omit<VesselState, 'n' | 'e' | 'heading' | 'moving' | 'sog' | 'phase' | 'parts'>, p: { n: number; e: number; dir: number }, spec: ServiceSpec, side: number, since: number, left = Infinity): VesselState {
    const ramp = Math.max(1 - Math.min(1, since / 8), 1 - Math.min(1, left / 6));
    const st: VesselState = { ...base, n: p.n, e: p.e, heading: p.dir, moving: false, sog: 0, phase: 'berthed', ramp, parts: [] };
    if (spec.kind === 'tug-float') st.tug = this.tugPose(st, side, 0);
    st.parts = this.partsOf(st);
    return st;
  }

  /**
   * The tug alongside the float, always on the same side of it (`side` relative to the float's heading: +1
   * starboard). `swing` is its heading relative to the float's (0 = pushing it ahead, π = facing back); it
   * turns about its bow, made fast amidships by the head rope, so its stern swings out away from the float.
   */
  private tugPose(float: { n: number; e: number; heading: number; length: number; beam: number }, side: number, swing: number): { n: number; e: number; heading: number } {
    const fwd = { n: Math.cos(float.heading), e: Math.sin(float.heading) };
    const out = { n: -fwd.e * side, e: fwd.n * side };
    const lateral = float.beam / 2 + TUG.beam / 2 + 0.3;
    const bow = { n: float.n + out.n * lateral, e: float.e + out.e * lateral };
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
  /** Water level (m ODN) at a real time: where the Lower Ferry berths on its slips. */
  waterLevel?: (epochMs: number) => number;
}): RiverTraffic {
  let cache: Map<string, [number, number][] | undefined> | undefined;
  if (o.geo) {
    cache = routeCache.get(o.geo);
    if (!cache) routeCache.set(o.geo, (cache = new Map()));
  }
  return new RiverTraffic(o.ferries, {
    fairwayCache: cache,
    current: o.current,
    waterLevel: o.waterLevel,
    fairway: o.geo ? { bedElevation: (n, e) => o.geo!.bedElevation(n, e), inDomain: (n, e) => o.geo!.inDomain(n, e), waterLevelOdn: ROUTE_LEVEL_ODN, avoid: o.moorings, minDepth: 1.5 } : undefined,
    marinas: o.marinas ?? DART_MARINAS,
  });
}
