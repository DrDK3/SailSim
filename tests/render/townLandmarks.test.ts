/**
 * Dartmouth's landmarks from the public pictures (docs/SOURCES.md M1–M4): the Royal Castle Hotel on the Quay,
 * matched to its OSM footprint, four storeys under a castellated parapet with turrets at the front's corners, its
 * sash windows in navy surrounds (the building shader's style 8) and its name across the front facing the
 * Boatfloat; St Saviour's church with its tall embattled west tower and the clock facing the river.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Kit, LANDMARKS, WIN, buildExtra, facing, insideRing, landmarkFor } from '../../src/render/landmarks';
import { ROYAL_CASTLE_AT, buildRoyalCastleLettering } from '../../src/render/royalCastle';
import type { DartFeatures } from '../../src/app/geoLoader';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as DartFeatures;
const spec = LANDMARKS.find((l) => l.id === 'royal-castle-hotel')!;
const hotel = features.buildings.find((b) => insideRing(b.r, ROYAL_CASTLE_AT[0], ROYAL_CASTLE_AT[1]))!;
const ccw = (() => {
  let a = 0;
  for (let i = 0; i < hotel.r.length; i++) a += hotel.r[i]![0] * hotel.r[(i + 1) % hotel.r.length]![1] - hotel.r[(i + 1) % hotel.r.length]![0] * hotel.r[i]![1];
  return (a >= 0 ? [...hotel.r] : [...hotel.r].reverse()) as [number, number][];
})();

describe('Royal Castle Hotel', () => {
  it('is the OSM footprint named for it, and its look', () => {
    expect(hotel.n).toBe('Royal Castle Hotel');
    expect(landmarkFor(hotel.r)?.id).toBe('royal-castle-hotel');
    expect(spec.at).toEqual(ROYAL_CASTLE_AT);
    expect(spec.win).toBe(WIN.navySash);
    expect(spec.parapet).toBe('battlements');
  });

  it('stands four storeys (2.8 m each) to the parapet, a slate roof behind it', () => {
    const h = spec.heights!;
    expect(h.eaves - h.base).toBeGreaterThanOrEqual(4 * 2.8);
    expect(h.eaves - h.base).toBeLessThan(5 * 2.8);
    // The roof rises from the parapet's foot by the roof drop ('p': slopes up and in to a flat top).
    expect(spec.shape).toBe('p');
    expect(h.top - h.eaves).toBeCloseTo(spec.roofDrop!, 6);
  });

  it('has a turret at each corner of the front facing the Boatfloat (east), just above the parapet', () => {
    const h = spec.heights!;
    const extras = spec.extras!(h.base, h.top, ccw);
    expect(extras).toHaveLength(2);
    const [a, b] = facing(ccw, 30, 130);
    for (const x of extras) {
      if (x.kind !== 'tower') throw new Error('expected a tower');
      expect(x.toM).toBeGreaterThan(h.eaves);
      expect(x.toM).toBeLessThan(h.eaves + 1);
      // Within a metre of one of the front's corners.
      expect(Math.min(Math.hypot(x.at[0] - a[0], x.at[1] - a[1]), Math.hypot(x.at[0] - b[0], x.at[1] - b[1]))).toBeLessThan(1);
    }
  });

  it('carries its name on the east front, between the third and fourth storeys, facing out', () => {
    // No canvas in the test environment: build the plane's placement with a stub document.
    const g = globalThis as unknown as { document?: unknown };
    const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      const group = buildRoyalCastleLettering(ccw, spec.heights!.base);
      const plane = group.getObjectByName('royal-castle-lettering-plane') as THREE.Mesh;
      expect(plane).toBeTruthy();
      const y = plane.position.y - spec.heights!.base;
      expect(y).toBeGreaterThan(2 * 2.8 + 2.38);
      expect(y).toBeLessThan(3 * 2.8 + 0.48);
      // Facing east-ish (the plane's normal is +z, turned by its rotation; three.js x = east, z = −north).
      const n = new THREE.Vector3(0, 0, 1).applyEuler(plane.rotation);
      expect(n.x).toBeGreaterThan(0.9);
      // On the front: within 0.2 m of the east wall's line.
      const [a, b] = facing(ccw, 30, 130);
      const e = plane.position.x;
      const nn = -plane.position.z;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dist = ((e - a[0]) * (b[1] - a[1]) - (nn - a[1]) * (b[0] - a[0])) / len;
      expect(Math.abs(dist)).toBeLessThan(0.2);
    } finally {
      delete g.document;
    }
  });
});

describe("St Saviour's church", () => {
  const sav = LANDMARKS.find((l) => l.id === 'st-saviours')!;
  const church = features.buildings.find((b) => insideRing(b.r, sav.at[0], sav.at[1]))!;
  const ring = (() => {
    let a = 0;
    for (let i = 0; i < church.r.length; i++) a += church.r[i]![0] * church.r[(i + 1) % church.r.length]![1] - church.r[(i + 1) % church.r.length]![0] * church.r[i]![1];
    return (a >= 0 ? [...church.r] : [...church.r].reverse()) as [number, number][];
  })();

  it('is the OSM footprint named for it', () => {
    expect(church.n).toBe("St Saviour's");
    expect(landmarkFor(church.r)?.id).toBe('st-saviours');
  });

  it('has its tall tower at the west end and a clock facing east, down the nave to the river', () => {
    const extras = sav.extras!(church.b, church.t, ring);
    const tower = extras.find((x) => x.kind === 'tower');
    const clock = extras.find((x) => x.kind === 'clock');
    if (tower?.kind !== 'tower' || clock?.kind !== 'clock') throw new Error('expected a tower and a clock');
    const es = church.r.map((p) => p[0]);
    // West end: within the western quarter of the footprint.
    expect(tower.at[0]).toBeLessThan(Math.min(...es) + 0.25 * (Math.max(...es) - Math.min(...es)));
    expect(tower.toM - tower.fromM).toBeGreaterThan(15);
    // Embattled, as GENUKI and the picture have it.
    expect(tower.top).toBe('battlements');
    // The clock on the tower's east face, facing between north-east and south-east, high on the tower.
    expect(clock.at[0]).toBeGreaterThan(tower.at[0]);
    expect(clock.facingDeg).toBeGreaterThan(45);
    expect(clock.facingDeg).toBeLessThan(135);
    expect(clock.y).toBeGreaterThan(tower.fromM + 0.5 * (tower.toM - tower.fromM));
    expect(clock.y).toBeLessThan(tower.toM);
  });

  it('draws the clock face as geometry facing its bearing', () => {
    const kit = new Kit();
    buildExtra(kit, { kind: 'clock', at: [0, 0], y: 10, radius: 1, facingDeg: 90 });
    expect(kit.pos.length).toBeGreaterThan(0);
    // Every face of the dial points east (three.js +x).
    for (let i = 0; i < kit.nor.length; i += 3) expect(kit.nor[i]!).toBeGreaterThan(0.99);
  });
});
