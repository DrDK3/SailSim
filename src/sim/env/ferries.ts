/**
 * PROVISIONAL ferry timetables (E): each unit shuttles along its OSM route, departing every `interval_min`
 * minutes from alternate ends and taking `crossing_min` to cross, between 07:00 and 23:00 UTC. Several units
 * on one route (the Lower Ferry has two floats) are spread evenly. Deterministic in real time, so the ferries
 * are where the same clock says in every run. Since Phase 5 they are also moving obstacles in the fleet physics.
 */
export interface FerryRoute {
  name: string;
  label: string;
  /** Route as [e, n] local metres. */
  route: [number, number][];
  interval_min: number;
  crossing_min: number;
  length: number;
  beam: number;
  ram: boolean;
  units: number;
}

export interface FerryState {
  name: string;
  label: string;
  unit: number;
  e: number;
  n: number;
  /** Direction of travel along the route (rad, compass); the hull keeps the route's axis when berthed. */
  heading: number;
  moving: boolean;
  ram: boolean;
  length: number;
  beam: number;
}

const OPEN_H = 7;
const CLOSE_H = 23;

function pointAlong(route: [number, number][], s: number): { e: number; n: number; heading: number } {
  let left = s;
  for (let i = 0; i < route.length - 1; i++) {
    const [e0, n0] = route[i]!;
    const [e1, n1] = route[i + 1]!;
    const len = Math.hypot(e1 - e0, n1 - n0);
    if (left <= len || i === route.length - 2) {
      const f = len > 0 ? Math.min(1, left / len) : 0;
      return { e: e0 + (e1 - e0) * f, n: n0 + (n1 - n0) * f, heading: Math.atan2(e1 - e0, n1 - n0) };
    }
    left -= len;
  }
  const [e, n] = route[0]!;
  return { e, n, heading: 0 };
}

export function ferryStates(ferries: readonly FerryRoute[], epochMs: number): FerryState[] {
  const out: FerryState[] = [];
  const dayMs = 86_400_000;
  const tod = ((epochMs % dayMs) + dayMs) % dayMs / 60_000; // minutes since midnight UTC
  for (const f of ferries) {
    const L = f.route.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - f.route[i - 1]![0], p[1] - f.route[i - 1]![1]) : 0), 0);
    for (let u = 0; u < f.units; u++) {
      const open = tod >= OPEN_H * 60 && tod <= CLOSE_H * 60;
      const t = tod - OPEN_H * 60 + (u * f.interval_min) / f.units;
      // Leg k departs at k·interval from end A (k even) or end B (k odd).
      const k = Math.floor(t / f.interval_min);
      const into = t - k * f.interval_min;
      const fromA = ((k % 2) + 2) % 2 === 0;
      const moving = open && into < f.crossing_min;
      const frac = moving ? smooth(into / f.crossing_min) : 1;
      const s = fromA ? frac * L : (1 - frac) * L;
      const p = pointAlong(f.route, s);
      out.push({
        name: f.name, label: f.label, unit: u, e: p.e, n: p.n,
        heading: fromA ? p.heading : p.heading + Math.PI,
        moving, ram: f.ram, length: f.length, beam: f.beam,
      });
    }
  }
  return out;
}

/** Gentle acceleration and deceleration at each end. */
function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}
