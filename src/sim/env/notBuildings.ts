/**
 * Footprints in the building data that are not there: the picture does not draw them (src/render/dart.ts) and the
 * physics does not meet them (src/sim/race/setup.ts raceStructures). Each by a point inside it (local e, n). The quay
 * walls the town's quay rule builds from footprints are kept (src/sim/env/quays.ts): where these stood by the
 * Embankment its wall is there.
 */
export const NOT_BUILDINGS: { at: [number, number]; why: string }[] = [
  {
    at: [-272, 391],
    why: "In the river off the Embankment, between the station and the Boatfloat's arch (base 0.5 m below datum): the owner, 13 Nov 2026, \"two houses by the boat float and pontoon that are in the river and shouldn't be there (pink and beige)\"; the owner's aerial photographs show no building there (docs/SOURCES.md V10).",
  },
  {
    at: [-270, 408],
    why: "In the river off the Embankment, north of the Boatfloat's arch (base 0.6 m below datum): the same.",
  },
  {
    at: [-155, 659],
    why: 'On the Riverboat Pontoon in mid-river (its walls to 2.2 m below datum; solid to the physics as a building in the water): the owner, 13 Nov 2026, "is not a kiosk, please remove".',
  },
];

function inside(ring: readonly (readonly [number, number])[], e: number, n: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > n !== yj > n && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Is this footprint one of NOT_BUILDINGS? */
export function notABuilding(ring: readonly (readonly [number, number])[]): boolean {
  return NOT_BUILDINGS.some((x) => inside(ring, x.at[0], x.at[1]));
}
