/** The roads built as roads: level across, cut into the town ground, kerbs and pavements in town, markings clear of junctions. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROAD_STYLE, RoadNetwork, type GroundGrid } from '../../src/render/roads';
import { ROAD_WIDTH } from '../../src/render/population';

/** A hillside rising 0.3 m per metre to the east (a 17° slope), as a grid and as a function. */
const slope = (e: number) => 10 + 0.3 * e;
const grid: GroundGrid = { e0: -200, n0: -200, cell: 4, nx: 100, ny: 100 };
const gridValues = () => {
  const v = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) v[j * grid.nx + i] = slope(grid.e0 + (i + 0.5) * grid.cell);
  return v;
};

describe('roads', () => {
  it('in the country: level across, riding on the ground, never buried at either edge', () => {
    // A primary road running north across the hillside, outside the town grid.
    const net = new RoadNetwork({ roads: [{ c: 'p', l: [[3000, 0], [3000, 60]] }] }, (e) => slope(e));
    const p = net.profiles[0]!;
    const w = ROAD_WIDTH.p! / 2;
    for (let k = 0; k < p.h.length; k++) expect(p.h[k]!).toBeGreaterThanOrEqual(slope(3000 + w) - 1e-6);
    // The surface is the same across the road (level), on the carriageway.
    expect(net.surfaceAt(3000 - 2, 30)).toBeCloseTo(net.surfaceAt(3000 + 2, 30)!, 6);
    expect(net.surfaceAt(3000 + 20, 30)).toBeUndefined();
    const roads = net.mesh((e) => slope(e));
    expect(roads.name).toBe('roads');
    const tile = roads.children[0] as THREE.Mesh;
    expect(tile.geometry.getAttribute('aKind').count).toBeGreaterThan(0);
    // The low-detail version leaves out the vertical faces.
    const low = net.mesh((e) => slope(e), 'low').children[0] as THREE.Mesh;
    expect(low.geometry.getAttribute('position').count).toBeLessThanOrEqual(tile.geometry.getAttribute('position').count);
  });

  it('in town: cut and filled into the ground, with kerbs and raised pavements', () => {
    // A residential street in Kingswear's box, running north across the hillside, inside the grid.
    const net = new RoadNetwork({ roads: [{ c: 'r', l: [[100, 0], [100, 80]] }] }, (e) => slope(e), grid);
    const p = net.profiles[0]!;
    expect(p.carved).toBe(true);
    expect(p.pave).toBeGreaterThan(1);
    const carved = net.carve(gridValues());
    const at = (e: number, n: number) => carved[Math.floor((n - grid.n0) / grid.cell) * grid.nx + Math.floor((e - grid.e0) / grid.cell)]!;
    const road = net.surfaceAt(100, 40)!;
    // The ground under the carriageway is just below it; uphill and downhill within the corridor, at the road's level.
    expect(at(100, 40)).toBeCloseTo(road - ROAD_STYLE.under, 1);
    const reach = p.w + p.pave + ROAD_STYLE.corridor - grid.cell;
    expect(Math.abs(at(100 + reach, 40) - (road - ROAD_STYLE.under))).toBeLessThan(0.05);
    // Well beyond the corridor the hillside is untouched.
    const cellCentre = (e: number) => grid.e0 + (Math.floor((e - grid.e0) / grid.cell) + 0.5) * grid.cell;
    expect(at(140, 40)).toBeCloseTo(slope(cellCentre(140)), 4);
    // On the pavement you stand a kerb higher than on the carriageway.
    expect(net.surfaceAt(100 + p.w + 0.5, 40)! - road).toBeCloseTo(ROAD_STYLE.kerb, 2);
  });

  it('markings stop short of a junction', () => {
    const net = new RoadNetwork(
      {
        roads: [
          { c: 'p', l: [[3000, 0], [3000, 100], [3000, 200]] },
          { c: 'r', l: [[3000, 100], [3080, 100]] },
        ],
      },
      () => 5,
    );
    const main = net.profiles[0]!;
    const near = main.n.findIndex((n) => Math.abs(n - 100) < 2);
    const far = main.n.findIndex((n) => Math.abs(n - 40) < 2);
    expect(main.mark[near]).toBe(0);
    expect(main.mark[far]).toBe(1);
  });
});
