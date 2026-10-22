import type { LocalPoint } from './types';

/**
 * Restricted areas for course validation on the River Dart, derived from the geodata:
 *  - ferry corridors: OSM ferry routes (S) widened by an estimated half-width (E). No marks or start/finish lines
 *    inside; legs that cross are flagged (the Lower and Higher Ferries are restricted in their ability to
 *    manoeuvre, DHNA sailing directions S(p); the Higher Ferry is chain-guided with submerged chains);
 *  - mooring areas (trots): OSM/DHNA polygons (S). No marks or lines inside; legs that cross are flagged.
 * Byelaw fairways and regatta exclusion zones are not established (N) and not enforced.
 */
export interface FerryCorridor {
  name: string;
  route: LocalPoint[];
  halfWidth: number;
  ram: boolean;
}

export interface MooringArea {
  name: string;
  ring: LocalPoint[];
}

export interface Restrictions {
  ferries: FerryCorridor[];
  moorings: MooringArea[];
}

/** Estimated corridor half-widths (m, E): the vessel's beam plus manoeuvring room, larger for the chain ferry. */
export const FERRY_HALF_WIDTH: Record<string, number> = {
  'Dartmouth Lower Ferry': 40,
  'Dartmouth Higher Ferry': 50,
  'Dartmouth Pedestrian Ferry': 25,
  'Dartmouth Castle Ferry': 20,
};
export const DEFAULT_FERRY_HALF_WIDTH = 20;

/** Long passenger routes (river cruises, Dittisham, Greenway, Noss) run up and down the river: not corridors. */
const CROSSING_FERRIES = new Set(Object.keys(FERRY_HALF_WIDTH).concat(['Dittisham Ferry']));

export function buildRestrictions(features: {
  ferries: { name: string; route: [number, number][]; ram: boolean }[];
  mooringAreas: { name: string; ring: [number, number][] }[];
}): Restrictions {
  return {
    ferries: features.ferries
      .filter((f) => CROSSING_FERRIES.has(f.name))
      .map((f) => ({ name: f.name, route: f.route.map(([e, n]) => ({ n, e })), halfWidth: FERRY_HALF_WIDTH[f.name] ?? DEFAULT_FERRY_HALF_WIDTH, ram: f.ram })),
    moorings: features.mooringAreas.map((a) => ({ name: a.name, ring: a.ring.map(([e, n]) => ({ n, e })) })),
  };
}
