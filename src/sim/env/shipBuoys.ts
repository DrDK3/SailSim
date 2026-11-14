/**
 * The River Dart's main-stream ship buoys off Dartmouth, and the superyacht Mosaique moored on them (owner, 14 Nov
 * 2026: "the central river buoys are missing. I want to add central river buoys, with the Super Yacht Mosaique,
 * flying a large RDYC burgee, moored").
 *
 * What is established (docs/SOURCES.md M1–M4):
 *  - Dart Harbour guide 2019 (H12): "yellow ships' mooring buoys" MS1 to MS5, numbered south to north, on the right
 *    of the main channel heading north, the visitors' anchorage on their Kingswear side; their spacing and
 *    configuration are altered to meet demand, and smaller vessels sometimes lie on spherical yellow buoys between.
 *  - Dart Harbour, Marine information 2023: MS 1-2, MS 1-3 and MS 3-5 are fore-and-aft moorings midstream opposite
 *    the town; MS 1-3 takes ships of about 90–160 m. Dart Harbour (2023 FAQ): expedition and luxury cruise ships moor
 *    "on the mid-stream buoys opposite town jetty". They were laid by the Admiralty for warships.
 *  - Mosaique: a 50 m motor yacht (waterline 44.5 m, beam about 9.3 m), Proteksan Turquoise, 2002, Dubois design.
 *
 * What is not: the buoys' positions. No source reachable here gave coordinates (OpenStreetMap could not be fetched
 * from this environment). They are placed from the description (E): in a line 35 m west of the anchorage's western
 * edge as OpenStreetMap maps it (features.json, the unnamed DHNA anchorage from (-110, 268) to (-78, 437)), along
 * that edge's bearing, MS1 opposite the Town Jetty and the others 100 m apart northward. Which pair Mosaique lies on
 * (MS1–MS2), and that she lies bow upstream, are estimates too. Correct the positions here; everything else
 * (the drawing, the physics, the river traffic's routes) follows them.
 */

export interface ShipBuoy {
  id: string;
  e: number;
  n: number;
}

/** The line's bearing (deg true): the anchorage's western edge, (-110, 268) to (-78, 437). */
export const SHIP_BUOY_BEARING_DEG = (Math.atan2(-78 + 110, 437 - 268) * 180) / Math.PI;

/** MS1–MS5 (local e, n; E): see above. */
export const SHIP_BUOYS: readonly ShipBuoy[] = [
  { id: 'MS1', e: -142.5, n: 284.3 },
  { id: 'MS2', e: -123.9, n: 382.6 },
  { id: 'MS3', e: -105.3, n: 480.8 },
  { id: 'MS4', e: -86.7, n: 579.1 },
  { id: 'MS5', e: -68.1, n: 677.4 },
];

/** The buoys as drawn and as solid (m, E: an Admiralty pattern ship buoy is a large drum). */
export const SHIP_BUOY_SIZE = { diameter: 3.0, freeboard: 1.1, draft: 0.9 };

export interface MooredYacht {
  name: string;
  /** Overall length, waterline length and beam (m). */
  loa: number;
  lwl: number;
  beam: number;
  /** The buoys she lies between: her stern line to the first, her bow line to the second. */
  between: [string, string];
  /** Particulars' source. */
  source: string;
}

export const MOSAIQUE: MooredYacht = {
  name: 'Mosaique',
  loa: 50,
  lwl: 44.5,
  beam: 9.3,
  between: ['MS1', 'MS2'],
  source: 'superyachts.com and Boat International directory listings (docs/SOURCES.md M4)',
};

/**
 * Her tender, lying alongside her starboard quarter on fenders, clear of her stern lines (m, E: an open tender of her
 * size), and her swim platform's reach aft of the transom.
 */
export const MOSAIQUE_TENDER = { length: 6.4, beam: 2.4, platform: 2.4, /** Its centre: along from hers (+ forward), and out to starboard. */ along: -15.5, across: 6.35 };

/** Where she lies: her centre midway between the two buoys, heading (rad, from north) from the first to the second. */
export function mooredBerth(y: MooredYacht = MOSAIQUE): { e: number; n: number; heading: number } {
  const a = SHIP_BUOYS.find((b) => b.id === y.between[0])!;
  const b = SHIP_BUOYS.find((b) => b.id === y.between[1])!;
  return { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2, heading: Math.atan2(b.e - a.e, b.n - a.n) };
}

/**
 * Her outline at the topsides (local e, n), counter-clockwise: a transom stern a little narrower than her beam, full
 * beam amidships, the bow drawn in over its forward third to the stem. Proportions from the photographs (E).
 */
export function yachtOutline(y: MooredYacht = MOSAIQUE): [number, number][] {
  const { e, n, heading } = mooredBerth(y);
  const L = y.loa;
  const hb = y.beam / 2;
  // (along from the centre, + forward; across, + starboard)
  const P = MOSAIQUE_TENDER.platform;
  const local: [number, number][] = [
    // The swim platform aft of the transom, then the hull.
    [-L / 2 - P, -3.8],
    [-L / 2 - P, 3.8],
    [-L / 2, hb * 0.86],
    [-L * 0.3, hb],
    [L * 0.12, hb],
    [L * 0.3, hb * 0.78],
    [L * 0.42, hb * 0.42],
    [L / 2, 0],
    [L * 0.42, -hb * 0.42],
    [L * 0.3, -hb * 0.78],
    [L * 0.12, -hb],
    [-L * 0.3, -hb],
    [-L / 2, -hb * 0.86],
  ];
  return toLocal(local, e, n, heading);
}

/** Points (along from her centre, + forward; across, + starboard) turned to local (e, n) for heading `heading`. */
function toLocal(pts: [number, number][], e: number, n: number, heading: number): [number, number][] {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  // along → (e, n) = (s, c); starboard → (c, -s). Counter-clockwise seen from above (e right, n up).
  return pts.map(([a, x]) => [e + a * s + x * c, n + a * c - x * s] as [number, number]);
}

/** The tender's outline (local e, n), counter-clockwise, lying alongside her starboard quarter, bow forward. */
export function tenderOutline(): [number, number][] {
  const { e, n, heading } = mooredBerth();
  const { along: a, across: c, length, beam } = MOSAIQUE_TENDER;
  const hl = length / 2;
  const hb = beam / 2;
  return toLocal([[a - hl, c - hb], [a - hl, c + hb], [a + hl * 0.5, c + hb], [a + hl, c], [a + hl * 0.5, c - hb]], e, n, heading);
}

/** A buoy's outline: a polygon round its drum (local e, n). */
export function buoyOutline(b: ShipBuoy, sides = 10): [number, number][] {
  const r = SHIP_BUOY_SIZE.diameter / 2;
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [b.e + r * Math.cos(a), b.n + r * Math.sin(a)] as [number, number];
  });
}

/** The buoys and the yacht as solid outlines for the boats (src/sim/race/setup.ts raceStructures). */
export function shipBuoyStructures(): { name: string; floating: true; poly: [number, number][] }[] {
  return [
    ...SHIP_BUOYS.map((b) => ({ name: `ship buoy ${b.id}`, floating: true as const, poly: buoyOutline(b) })),
    { name: `the superyacht ${MOSAIQUE.name}`, floating: true as const, poly: yachtOutline() },
    { name: `${MOSAIQUE.name}'s tender`, floating: true as const, poly: tenderOutline() },
  ];
}

/** Points for river traffic's routes to keep clear of (src/sim/env/traffic.ts fairway avoid). */
export function shipBuoyAvoidPoints(): { n: number; e: number }[] {
  const out = SHIP_BUOYS.map((b) => ({ n: b.n, e: b.e }));
  const { e, n, heading } = mooredBerth();
  for (let a = -MOSAIQUE.loa / 2 - MOSAIQUE_TENDER.platform; a <= MOSAIQUE.loa / 2 + 1e-6; a += 6) out.push({ e: e + a * Math.sin(heading), n: n + a * Math.cos(heading) });
  const [te, tn] = toLocal([[MOSAIQUE_TENDER.along, MOSAIQUE_TENDER.across]], e, n, heading)[0]!;
  out.push({ e: te, n: tn });
  return out;
}
