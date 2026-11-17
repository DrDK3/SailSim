/**
 * Trot moorings from Dart Haven Marina up to the Higher Ferry (owner, 17 Nov 2026: "Boats on the river, from Dart
 * Haven Marina to the Higher Ferry, should be on trot moorings, not swing moorings").
 *
 * A trot is a line of fore-and-aft moorings: each boat is made fast bow and stern to a buoy at either end, so she
 * lies in her row and does not swing to the wind or the stream. The stretch holds two of the mapped mooring areas
 * (public/geo/features.json `mooringAreas`, OpenStreetMap via Overture, S): the DHNA mooring area off Kingswear
 * (opposite Dart Haven Marina) and the Kingswear Trots, which end below the Higher Ferry's crossing. The Noss and
 * Distins Trots, above the Higher Ferry, keep their swinging moorings.
 *
 * The data has the areas but no individual buoy positions (N): the boats' positions are the provisional layout's
 * (tools/geodata/build.py `layout_moorings`, rows 22 m apart, boats 16 m apart along each row, E). Here each boat
 * lies centred on her layout position, along her row:
 *  - the row bearing is the layout's, measured from features.json (E): it follows the long axis of each area, which
 *    runs with the river; it is within about 21° of the modelled ebb (tests/sim/trots.test.ts measures it);
 *  - every boat lies bow upstream, head to the ebb, the stronger stream here (E);
 *  - her two buoys are 1 m off her bow and stern on the row's line (E).
 * Positions, bearings and the way the boats face are estimates (E), not a harbour plan.
 */

/** The mooring areas on trots, by their name in features.json, with the bearing (deg) the boats' bows point (E). */
export const TROT_AREAS: Readonly<Record<string, { headingDeg: number }>> = {
  // Layout rows run 010.4°/190.4° (measured from features.json); bows up the river.
  'Mooring area (DHNA)': { headingDeg: 10.4 },
  // Layout rows run 354.6°/174.6°.
  'Kingswear Trots': { headingDeg: 354.6 },
};

/** How far each trot buoy lies off the boat's bow and stern (m, E). */
export const TROT_BUOY_OFF = 1;

/** The heading (rad, compass) of a boat on a trot in `area`, or undefined when that area's boats swing. */
export function trotHeading(area: string | undefined): number | undefined {
  const t = area === undefined ? undefined : TROT_AREAS[area];
  return t ? (t.headingDeg * Math.PI) / 180 : undefined;
}

/** True when the boats in `area` lie on trots (fore and aft), not on swinging moorings. */
export function isTrotArea(area: string | undefined): boolean {
  return trotHeading(area) !== undefined;
}

/** A trot boat's two buoys (local n, e): ahead of her bow and astern of her stern, on her row. */
export function trotBuoys(m: { n: number; e: number; l: number }, heading: number): [{ n: number; e: number }, { n: number; e: number }] {
  const d = m.l / 2 + TROT_BUOY_OFF;
  const cn = Math.cos(heading);
  const se = Math.sin(heading);
  return [
    { n: m.n + cn * d, e: m.e + se * d },
    { n: m.n - cn * d, e: m.e - se * d },
  ];
}
