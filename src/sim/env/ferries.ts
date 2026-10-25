import { RiverTraffic, type VesselState } from './traffic';

/**
 * Ferry routes from the geodata (OSM routes; vessel sizes and timetables there are estimates, E). Since the
 * hi-fi traffic work the movement itself is modelled in src/sim/env/traffic.ts (speed profiles, tug manoeuvres,
 * the stream); this module keeps the route type and a plain lookup without the stream or marina traffic.
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

export type FerryState = VesselState;

const plain = new WeakMap<readonly FerryRoute[], RiverTraffic>();

/** Ferry positions at a real time (no stream: no crabbing; no marina boats). */
export function ferryStates(ferries: readonly FerryRoute[], epochMs: number): FerryState[] {
  let t = plain.get(ferries);
  if (!t) plain.set(ferries, (t = new RiverTraffic(ferries)));
  return t.states(epochMs);
}
