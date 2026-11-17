/**
 * The Kingswear light: the sector light on the eastern shore inside the entrance to the Dart, that leads in through
 * the narrows past the castles. The owner's information (17 Nov 2026: docs/SOURCES.md L1, citing Dart Harbour's
 * notices LNTM 03/24 and 01/26, which were not fetched here) gives its chart position, 50°20.81'N 003°34.09'W, a
 * compact 4 m round tower with a conical lantern on a large rock at the water's edge, the light 9 m above mean high
 * water shining through a window facing south-west, and the white sector, 325°–331° (bearings of the light from
 * seaward). Its character, Iso WRG 3s (isophase: light and dark equally, every 3 s; white, red and green sectors),
 * is the Dart Harbour guide's too (K6).
 *
 * Not established: the red and green sectors' limits, so only the white sector is drawn; the rock's size and shape,
 * and the tower's colours (E).
 */
import { DART_PROJECTION } from '../geo/projection';

export const KINGSWEAR_LIGHT = {
  lat: 50 + 20.81 / 60,
  lon: -(3 + 34.09 / 60),
  /** Light, isophase, period (s). */
  period: 3,
  /** The white sector: bearings of the light from the viewer (deg true). */
  white: [325, 331] as [number, number],
  /** Focal height above mean high water (m), and mean high water (m ODN, E: Dartmouth, between neaps and springs). */
  focalAboveMHW: 9,
  mhwOdn: 1.8,
  tower: { height: 4, radius: 0.9 },
  /** The rock it stands on: radius (m, E). */
  rockRadius: 4.5,
};

/** Its place (local e, n). */
export function kingswearLightLocal(): { e: number; n: number } {
  return DART_PROJECTION.toLocal(KINGSWEAR_LIGHT.lat, KINGSWEAR_LIGHT.lon);
}

/** The rock's top (m ODN): the tower stands on it with its light at the focal height (the light 0.6 m below the top). */
export function kingswearRockTop(): number {
  const k = KINGSWEAR_LIGHT;
  return k.mhwOdn + k.focalAboveMHW - (k.tower.height - 0.6);
}

/** The rock's outline (local e, n), counter-clockwise: irregular (E). */
export function kingswearRockOutline(): [number, number][] {
  const c = kingswearLightLocal();
  const r = KINGSWEAR_LIGHT.rockRadius;
  return Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    // Lumpy all round: a few big bulges and smaller knobs (E).
    const rr = r * (0.82 + 0.16 * Math.sin(3 * a + 0.9) + 0.1 * Math.sin(7 * a + 2.1) + 0.08 * Math.abs(Math.sin(i * 2.3 + 0.7)));
    return [c.e + rr * Math.cos(a), c.n + rr * Math.sin(a)] as [number, number];
  });
}

/** Whether the light shows white to a viewer at (e, n): the light's bearing from them inside the white sector. */
export function inWhiteSector(e: number, n: number): boolean {
  const c = kingswearLightLocal();
  const brg = ((Math.atan2(c.e - e, c.n - n) * 180) / Math.PI + 360) % 360;
  return brg >= KINGSWEAR_LIGHT.white[0] && brg <= KINGSWEAR_LIGHT.white[1];
}

/** The rock, solid to the boats (src/sim/race/setup.ts raceStructures). */
export function shoreLightStructures(): { name: string; floating: false; poly: [number, number][] }[] {
  return [{ name: "the Kingswear light's rock", floating: false as const, poly: kingswearRockOutline() }];
}
