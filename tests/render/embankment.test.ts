/**
 * The South Embankment and the Boatfloat from the owner's photographs of 12 Nov 2026: the basin walled all round, its
 * small boats afloat or on the mud with the tide, the arch to the river; the former station on its footprint;
 * gables standing out of a roof facing the right way; a lettered board on the right wall.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOATFLOAT_ARCH, BOATFLOAT_BOX, BOATFLOAT_EDGE, Boatfloat, boatfloatWalls, missingBasinWalls } from '../../src/render/boatfloat';
import { buildStation, hipRoofGeometry } from '../../src/render/station';
import { buildFrontSign } from '../../src/render/signs';
import { Kit, LANDMARKS, NOT_BUILDINGS, buildExtra, insideRing, notABuilding } from '../../src/render/landmarks';
import { readFileSync } from 'node:fs';
import type { QuayWall } from '../../src/sim/env/quays';

/** A bowl: the basin's floor at 0 m ODN inside its edge, the quays at 3.2 m outside. */
const inside = (e: number, n: number) => e > -339 && e < -293 && n > 368 && n < 420;
const ground = (e: number, n: number) => (inside(e, n) ? 0 : 3.2);

describe('the Boatfloat', () => {
  // The town's walls found only the north and west sides (water on the right going along them).
  const north: QuayWall = { line: [[-338, 421], [-315, 420.5], [-292, 420]], top: 3.2 };
  const west: QuayWall = { line: [[-340, 368], [-339, 395], [-338, 421]], top: 3.2 };
  const river: QuayWall = { line: [[-268, 360], [-268, 430]], top: 3.6 };
  const walls = boatfloatWalls([north, west, river]);

  it('takes the walls inside the basin, not the river wall', () => {
    expect(walls).toHaveLength(2);
    for (const w of walls) for (const [e, n] of w.line) expect(e >= BOATFLOAT_BOX.eMin && e <= BOATFLOAT_BOX.eMax && n >= BOATFLOAT_BOX.nMin && n <= BOATFLOAT_BOX.nMax).toBe(true);
  });

  it('walls the east and south sides where the quay rule left banks, topped at the quay', () => {
    const extra = missingBasinWalls(walls, ground);
    expect(extra.length).toBeGreaterThan(0);
    const pts = extra.flatMap((w) => w.line);
    // Along the east side (e about -292) and the south side (n about 367), nothing on the walled north and west.
    expect(pts.some(([e]) => e > -295)).toBe(true);
    expect(pts.some(([, n]) => n < 370)).toBe(true);
    expect(pts.every(([e, n]) => !(n > 418 && e < -300))).toBe(true);
    for (const w of extra) expect(w.top).toBeCloseTo(3.2, 6);
    expect(BOATFLOAT_EDGE).toHaveLength(4);
  });

  it('fills the basin with boats along its walls, afloat at high water and on the mud at low', () => {
    const bf = new Boatfloat([...walls, ...missingBasinWalls(walls, ground)], [river], ground);
    expect(bf.boats).toBeGreaterThan(20);
    for (const o of bf.floating.children) expect(inside(o.position.x, -o.position.z)).toBe(true);
    bf.update(2.5);
    expect(bf.floating.children.every((o) => o.position.y === 0)).toBe(true);
    bf.update(-1.5);
    // The floor is at 0: the boats lie on it, 1.75 m above a tide at -1.5 m.
    expect(bf.floating.children.every((o) => Math.abs(o.position.y - 1.75) < 1e-9)).toBe(true);
    // The arch on both walls, facing the water.
    const arches = bf.fixed.children.filter((o) => o.name === 'boatfloat-arch');
    expect(arches).toHaveLength(2);
    const riverArch = arches.find((a) => Math.abs(a.children[0]!.position.x - BOATFLOAT_ARCH.river[0]) < 1)!;
    expect(riverArch).toBeTruthy();
    // Facing east, out over the river (the plane's +z turned by its rotation).
    const nrm = new THREE.Vector3(0, 0, 1).applyEuler(riverArch.children[0]!.rotation);
    expect(nrm.x).toBeGreaterThan(0.99);
  });
});

describe('the former Dartmouth station', () => {
  const ring: [number, number][] = [[-279.2, 380.6], [-280.5, 361.3], [-273.6, 360.8], [-272.2, 380.1]].reverse() as [number, number][];

  it('stands on its footprint: one storey under a hipped roof with a lantern, the canopies beyond its walls', () => {
    const m = buildStation(ring, 3.0) as THREE.Mesh;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.y).toBeGreaterThanOrEqual(3.0 - 1e-6);
    // Walls 3.65 m, the roof and lantern to about 7.5 m above the ground: under 9.
    expect(bb.max.y - 3.0).toBeGreaterThan(6);
    expect(bb.max.y - 3.0).toBeLessThan(9);
    // Within a few metres of the footprint (the canopy and the end porch reach beyond it).
    expect(bb.min.x).toBeGreaterThan(-284);
    expect(bb.max.x).toBeLessThan(-268);
    expect(-bb.max.z).toBeGreaterThan(355);
    expect(-bb.min.z).toBeLessThan(384);
  });

  it('its hipped roof faces outward and up', () => {
    const g = hipRoofGeometry(10, 4, 2);
    g.computeVertexNormals();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0);
  });

  it('is a landmark look drawn as itself', () => {
    expect(LANDMARKS.find((l) => l.id === 'dartmouth-station')).toBeTruthy();
  });
});

describe('gables and signs', () => {
  it('a gable stands out of the roof on the wall it is given, its face looking out', () => {
    const kit = new Kit();
    // A wall running north (a→b) with the outside to the east.
    buildExtra(kit, { kind: 'gables', a: [0, 0], b: [0, 10], count: 2, eavesM: 10, rise: 3, depth: 4, wall: 0xffffff, roof: 0x444444, board: 0x111111 });
    const ys = [];
    let eastFacing = 0;
    for (let i = 0; i < kit.pos.length; i += 3) {
      ys.push(kit.pos[i + 1]!);
      if (kit.nor[i]! > 0.99 && kit.pos[i]! > 0.05) eastFacing++;
    }
    expect(Math.max(...ys)).toBeGreaterThan(13);
    expect(Math.min(...ys)).toBeGreaterThan(9.8);
    expect(eastFacing).toBeGreaterThan(0);
  });

  it('a lettered board goes on the wall facing the bearing asked for', () => {
    // Counter-clockwise square, 10 m: its east wall at e = 10.
    const g = buildFrontSign('test-sign', [[0, 0], [10, 0], [10, 10], [0, 10]], { text: 'DARTMOUTH YACHT CLUB', y: 5, faceDeg: 90, width: 7, height: 0.6, fg: '#d9b45a', bg: '#18233a' });
    const p = g.children[0]!;
    expect(p.position.x).toBeCloseTo(10.08, 6);
    expect(-p.position.z).toBeCloseTo(5, 6);
    const nrm = new THREE.Vector3(0, 0, 1).applyEuler(p.rotation);
    expect(nrm.x).toBeGreaterThan(0.99);
  });
});

describe('footprints in the river that are not buildings', () => {
  const buildings = (JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as { buildings: { r: [number, number][]; b: number }[] }).buildings;

  it('each names exactly one footprint, standing in the river (owner, 13 Nov 2026: "in the river and shouldn\'t be there"; "is not a kiosk, please remove")', () => {
    expect(NOT_BUILDINGS).toHaveLength(3);
    for (const x of NOT_BUILDINGS) {
      const hits = buildings.filter((b) => insideRing(b.r, x.at[0], x.at[1]));
      expect(hits).toHaveLength(1);
      // Their base below the datum: standing in the water.
      expect(hits[0]!.b).toBeLessThan(0);
      expect(notABuilding(hits[0]!.r)).toBe(true);
    }
    // No real building nearby is caught: the station and York House stay.
    const station = buildings.find((b) => insideRing(b.r, -276, 371))!;
    const york = buildings.find((b) => insideRing(b.r, -304, 348))!;
    expect(notABuilding(station.r)).toBe(false);
    expect(notABuilding(york.r)).toBe(false);
  });
});
