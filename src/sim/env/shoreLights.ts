/**
 * The Kingswear light: the sector light on the eastern shore inside the entrance to the Dart, that leads in through
 * the narrows past the castles. The owner's information (17 Nov 2026: docs/SOURCES.md KL1, citing Dart Harbour's
 * notices LNTM 03/24 and 01/26, which were not fetched here) gives its chart position, 50°20.81'N 003°34.09'W, a
 * compact 4 m round tower with a conical lantern on a large rock at the water's edge, the light 9 m above mean high
 * water shining through a window facing south-west, and the white sector, 325°–331° (bearings of the light from
 * seaward). Its character, Iso WRG 3s (isophase: light and dark equally, every 3 s; white, red and green sectors),
 * is the Dart Harbour guide's too (K6). The owner's charted sectors (17 Nov 2026: KL2, Admiralty List of Lights
 * A0236), as true bearings of the light from seaward: green 318°–325°, white 325°–331°, and 331°–340°, whose colour
 * the message did not give: red, the third colour of Iso WRG (and red to port as one comes in: seen to the west of
 * the line in, the light bears more than 331°).
 *
 * Not established: the rock's size and shape, and the tower's colours (E).
 */
import { DART_PROJECTION } from '../geo/projection';

export const KINGSWEAR_LIGHT = {
  lat: 50 + 20.81 / 60,
  lon: -(3 + 34.09 / 60),
  /** Light, isophase, period (s). */
  period: 3,
  /** The white sector: bearings of the light from the viewer (deg true). */
  white: [325, 331] as [number, number],
  /** All its sectors, west of the line in to east: bearings of the light from the viewer (deg true), from → to. */
  sectors: [
    { colour: 'green', from: 318, to: 325 },
    { colour: 'white', from: 325, to: 331 },
    { colour: 'red', from: 331, to: 340 },
  ] as const,
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

/** The light's bearing (deg true) from a viewer at (e, n). */
export function kingswearLightBearing(e: number, n: number): number {
  const c = kingswearLightLocal();
  return ((Math.atan2(c.e - e, c.n - n) * 180) / Math.PI + 360) % 360;
}

export type SectorColour = (typeof KINGSWEAR_LIGHT.sectors)[number]['colour'];

/**
 * The colour the light shows to a viewer at (e, n), or undefined outside its sectors (it is not seen there). A
 * bearing on a sector's limit goes to the sector clockwise of it, except the last limit (340°), which is red's.
 */
export function sectorColour(e: number, n: number): SectorColour | undefined {
  const b = kingswearLightBearing(e, n);
  const ss = KINGSWEAR_LIGHT.sectors;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i]!;
    if (b >= s.from && (b < s.to || (i === ss.length - 1 && b <= s.to))) return s.colour;
  }
  return undefined;
}

/** Whether the light shows white to a viewer at (e, n): the light's bearing from them inside the white sector. */
export function inWhiteSector(e: number, n: number): boolean {
  return sectorColour(e, n) === 'white';
}

/** The rock, solid to the boats (src/sim/race/setup.ts raceStructures). */
export function shoreLightStructures(): { name: string; floating: false; poly: [number, number][] }[] {
  return [{ name: "the Kingswear light's rock", floating: false as const, poly: kingswearRockOutline() }];
}
