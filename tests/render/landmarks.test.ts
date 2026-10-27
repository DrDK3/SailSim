/**
 * Landmarks drawn as themselves, and street life: each bespoke landmark is matched to its real OSM footprint;
 * the roof inset and edge helpers; roads, cars (keeping left) and people.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Kit, LANDMARKS, WIN, battlements, buildExtra, facing, insetRing, insetRingAdaptive, insideRing, landmarkFor, longAxisDeg, outward, simplifyRing } from '../../src/render/landmarks';
import { CAR_SPEED, ROAD_WIDTH, StreetLife, TOWNS, along, buildRoadSurfaces, carGeometry, personGeometry, type RoadsData } from '../../src/render/population';
import type { DartFeatures } from '../../src/app/geoLoader';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as DartFeatures;
const roads = JSON.parse(readFileSync(new URL('../../public/geo/roads.json', import.meta.url), 'utf8')) as RoadsData;
const manifest = JSON.parse(readFileSync(new URL('../../public/geo/manifest.json', import.meta.url), 'utf8'));

const SQUARE: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('landmarks', () => {
  it('each bespoke landmark lies in exactly one footprint, the one named for it where OSM names it', () => {
    for (const l of LANDMARKS) {
      const hits = features.buildings.filter((b) => insideRing(b.r, l.at[0], l.at[1]));
      expect(hits, l.id).toHaveLength(1);
    }
    const named = (id: string) => features.buildings.find((b) => insideRing(b.r, LANDMARKS.find((l) => l.id === id)!.at[0], LANDMARKS.find((l) => l.id === id)!.at[1]))!.n;
    expect(named('rdyc')).toBe('Royal Dart Yacht Club');
    expect(named('royal-dart-hotel')).toBe('Royal Dart Hotel');
    expect(named('kingswear-castle')).toBe('Kingswear Castle');
    expect(named('dartmouth-castle')).toBe('Dartmouth Castle');
    expect(named('st-petrox')).toBe('St. Petrox');
  });

  it('BRNC: brick with stone dressings, a perimeter roof, and the clock tower inside its footprint', () => {
    const brnc = LANDMARKS.find((l) => l.id === 'brnc')!;
    const fp = features.buildings.find((b) => insideRing(b.r, brnc.at[0], brnc.at[1]))!;
    expect(brnc.win).toBe(WIN.brickAndStone);
    expect(brnc.shape).toBe('p');
    const tower = brnc.extras!(fp.b, fp.t, fp.r)[0]!;
    expect(tower.kind).toBe('tower');
    if (tower.kind === 'tower') {
      expect(insideRing(fp.r, tower.at[0], tower.at[1])).toBe(true);
      expect(tower.toM).toBeGreaterThan(fp.t);
    }
    expect(landmarkFor(fp.r)?.id).toBe('brnc');
  });

  it('insets a ring, and refuses one that would fold over itself', () => {
    const inner = insetRing(SQUARE, 2)!;
    expect(inner.map(([e, n]) => [Math.round(e * 1e6) / 1e6, Math.round(n * 1e6) / 1e6])).toEqual([[2, 2], [8, 2], [8, 8], [2, 8]]);
    expect(insetRing(SQUARE, 6)).toBeUndefined();
    // The BRNC footprint (counter-clockwise) takes a 6 m inset or a smaller one.
    const brnc = LANDMARKS.find((l) => l.id === 'brnc')!;
    let r = features.buildings.find((b) => insideRing(b.r, brnc.at[0], brnc.at[1]))!.r;
    let a = 0;
    for (let i = 0; i < r.length; i++) a += r[i]![0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * r[i]![1];
    if (a < 0) r = [...r].reverse();
    const simple = simplifyRing(r);
    expect(simple.length).toBeLessThan(r.length);
    expect(insetRingAdaptive(simple, 6)).toBeDefined();
    expect(insetRing(simple, 6)).toBeUndefined(); // the notches fold a uniform inset
    // Collinear points and short jogs go; corners stay.
    expect(simplifyRing([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]])).toHaveLength(4);
  });

  it('finds the river-facing wall and the long axis', () => {
    expect(outward([0, 0], [10, 0])).toEqual([0, -1]);
    const [a, b] = facing(SQUARE, 225, 315);
    expect([a, b]).toEqual([[0, 10], [0, 0]]);
    expect(longAxisDeg([[0, 0], [30, 0], [30, 8], [0, 8]])).toBeCloseTo(90, 6);
    expect(longAxisDeg([[0, 0], [8, 0], [8, 30], [0, 30]])).toBeCloseTo(0, 6);
  });

  it('builds battlements, towers, turrets, a flagstaff, a veranda and balconies', () => {
    const kit = new Kit();
    battlements(kit, SQUARE, 10, 0x777777);
    const afterBattlements = kit.pos.length;
    expect(afterBattlements).toBeGreaterThan(0);
    for (const x of [
      { kind: 'tower', at: [5, 5], w: 5, d: 5, bearingDeg: 0, fromM: 0, toM: 20, top: 'battlements', walls: 0x777777, dressing: 0x999999 },
      { kind: 'tower', at: [5, 5], w: 9, d: 9, bearingDeg: 50, fromM: 0, toM: 30, top: 'clock-cupola', walls: 0x9a4d3c, dressing: 0xe6e0d0 },
      { kind: 'turret', at: [0, 0], radius: 3, sides: 8, fromM: 0, toM: 15, walls: 0x777777 },
      { kind: 'flagstaff', at: [0, 0], fromM: 0, height: 13 },
      { kind: 'veranda', a: [0, 0], b: [0, 10], floorM: 3, topM: 7, depth: 2, canopy: 1 },
      { kind: 'balconies', a: [10, 0], b: [10, 10], floorsM: [3, 6], depth: 1.5 },
    ] as const) {
      const before = kit.pos.length;
      buildExtra(kit, x as never);
      expect(kit.pos.length, x.kind).toBeGreaterThan(before);
    }
    const mesh = kit.mesh('t');
    expect(mesh.geometry.getAttribute('position').count).toBe(kit.pos.length / 3);
    expect(Number.isFinite(mesh.geometry.boundingSphere!.radius)).toBe(true);
  });
});

describe('roads and street life', () => {
  it('the data has the main road classes, and the manifest lists the file and its provenance', () => {
    const by = new Map<string, number>();
    for (const r of roads.roads) by.set(r.c, (by.get(r.c) ?? 0) + 1);
    for (const c of ['p', 's', 't', 'r', 'f']) expect(by.get(c) ?? 0, c).toBeGreaterThan(20);
    expect(manifest.roads.file).toBe('roads.json');
    const layer = manifest.layers.find((l: { id: string }) => l.id === 'roads');
    expect(layer.notes.join(' ')).toMatch(/illustrative \(E\)/);
    for (const c of Object.keys(CAR_SPEED)) expect(ROAD_WIDTH[c]).toBeGreaterThan(3.5);
  });

  it('draws the road surfaces just above the ground', () => {
    const mesh = buildRoadSurfaces({ roads: [{ c: 'p', l: [[0, 0], [0, 40]] }, { c: 'x', l: [[0, 0], [5, 5]] }] }, () => 2);
    const p = mesh.geometry.getAttribute('position');
    // 10 steps of 4 m, two edges each: 22 vertices; steps are not drawn.
    expect(p.count).toBe(22);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(2.12, 6);
    // Width 6.5 m across x (the road runs north).
    expect(Math.abs(p.getX(0) - p.getX(1))).toBeCloseTo(6.5, 6);
  });

  it('cars keep to the left and face their way; people and cars stay small models', () => {
    const life = new StreetLife({ roads: { roads: [{ c: 'p', l: [[0, 0], [0, 400]] }] }, groundAt: () => 0, seed: 1 });
    expect(life.counts.cars).toBe(130);
    const cars = life.fixed.children.find((c) => c.name === 'cars') as THREE.InstancedMesh;
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 50, -200);
    life.update(0, cam);
    life.update(0.1, cam);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let checked = 0;
    for (let i = 0; i < cars.count; i++) {
      cars.getMatrixAt(i, m);
      m.decompose(pos, q, s);
      if (s.x === 0) continue;
      // The car's bow (-z in the model) points north (three.js -z) or south (+z); on the left of its way.
      const bow = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const north = bow.z < 0;
      expect(Math.abs(bow.x)).toBeLessThan(1e-6);
      expect(north ? pos.x < 0 : pos.x > 0).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    expect(carGeometry().getAttribute('position').count / 3).toBeLessThan(400);
    expect(personGeometry().getAttribute('position').count / 3).toBeLessThan(200);
  });

  it('positions along a polyline', () => {
    const seg = { c: 'r', pts: [[0, 0], [10, 0], [10, 10]] as [number, number][], cum: [0, 10, 20], len: 20, a: '', b: '' };
    expect(along(seg, 5)).toMatchObject({ e: 5, n: 0, de: 1, dn: 0 });
    expect(along(seg, 15)).toMatchObject({ e: 10, n: 5, de: 0, dn: 1 });
    expect(along(seg, 99)).toMatchObject({ e: 10, n: 10 });
  });

  it('the towns contain Dartmouth’s and Kingswear’s quays', () => {
    const inTown = (e: number, n: number) => TOWNS.some((t) => e >= t.eMin && e <= t.eMax && n >= t.nMin && n <= t.nMax);
    expect(inTown(-330, 300)).toBe(true); // Dartmouth embankment
    expect(inTown(0, 0)).toBe(true); // RDYC, Kingswear
    expect(inTown(-3500, 1200)).toBe(false); // Start Bay
  });
});
