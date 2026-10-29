/**
 * Structures standing in the water: OSM building footprints whose ground is under the water (the 8 m bed at
 * their centre, or at half their corners or more, below 0.5 m ODN, about mean tide). On the Dart these are a
 * moored ship (the Hindostan, the college's training ship off Sandquay, a former Sandown-class minehunter, the
 * ex-HMS Cromer), floating offices and huts on the pontoons, and boathouses on the foreshore. Boats meet them as
 * fixed outlines, start slots keep clear of them, and the AI steers round them. The threshold is an estimate (E).
 */

/** Below this (m ODN), a footprint's ground counts as under the water (E). */
export const IN_WATER_ODN = 0.5;

export interface StructureInWater {
  name: string;
  floating: false;
  poly: [number, number][];
}

export function structuresInWater(
  buildings: readonly { r: readonly (readonly [number, number])[]; n?: string | null }[],
  bedElevation: (n: number, e: number) => number,
): StructureInWater[] {
  const out: StructureInWater[] = [];
  for (const b of buildings) {
    const r = b.r;
    if (r.length < 3) continue;
    const ce = r.reduce((a, p) => a + p[0], 0) / r.length;
    const cn = r.reduce((a, p) => a + p[1], 0) / r.length;
    const wet = r.filter(([e, n]) => bedElevation(n, e) < IN_WATER_ODN).length;
    if (bedElevation(cn, ce) < IN_WATER_ODN || wet * 2 >= r.length) {
      const name = !b.n ? 'a building on the water' : /^the /i.test(b.n) ? b.n : `the ${b.n}`;
      out.push({ name, floating: false, poly: r.map(([e, n]) => [e, n] as [number, number]) });
    }
  }
  return out;
}
