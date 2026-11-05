/**
 * The Royal Dart, Kingswear, as the owner's photographs show it (5 Nov 2026): its splayed bay with two balconies
 * under a tented canopy facing the river, the sign, the low roof at the data's top, the north wing's loggia where
 * the passenger gangway lands; and the passenger pier drawn as a truss gangway and a pontoon.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DartFeatures } from '../../src/app/geoLoader';
import { standingSpots } from '../../src/render/dart';
import { insideRing, landmarkFor } from '../../src/render/landmarks';
import { buildPontoons } from '../../src/render/pontoons';
import { KINGSWEAR_PASSENGER_PIER, RD_BAY, RD_LEVELS, RD_WING, buildRoyalDart, offsetPolyline, passengerPierAsDrawn, royalDartFromEN } from '../../src/render/royalDart';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as DartFeatures;
const footprint = (id: string) => features.buildings.find((b) => landmarkFor(b.r)?.id === id)!;
const hotel = footprint('royal-dart-hotel');
const wingFoot = footprint('royal-dart-wing');
const rd = buildRoyalDart(wingFoot.r);
rd.group.updateMatrixWorld(true);

/** Every vertex of the group's meshes whose name ends with `part`, in local (e, n, height). */
function vertices(part: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  rd.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.name.endsWith(part)) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) out.push([p.getX(i), -p.getZ(i), p.getY(i)]);
  });
  return out;
}

describe('the Royal Dart', () => {
  it('stands on its own and its wing’s footprints, the roof at the data’s top', () => {
    expect(hotel.n).toBe('Royal Dart Hotel');
    expect(rd.triangles).toBeGreaterThan(2000);
    // The zinc roof (and the canopy) top out at the data's 16.1 m ODN (plus the ridge capping).
    const zinc = vertices('-lead');
    expect(Math.max(...zinc.map((v) => v[2]))).toBeGreaterThan(16.0);
    expect(Math.max(...zinc.map((v) => v[2]))).toBeLessThan(16.4);
    // Everything stays within the eaves' overhang of the two footprints (0.9 m; 1.3–1.5 m at a corner, where
    // the data's front wall steps 0.3 m).
    const near = (e: number, n: number) => {
      for (const ring of [hotel.r, wingFoot.r]) {
        if (insideRing(ring, e, n)) return true;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % ring.length]!;
          const t = Math.max(0, Math.min(1, ((e - a[0]) * (b[0] - a[0]) + (n - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)));
          if (Math.hypot(e - a[0] - (b[0] - a[0]) * t, n - a[1] - (b[1] - a[1]) * t) < 1.6) return true;
        }
      }
      return false;
    };
    const stray = vertices('').filter(([e, n]) => !near(e, n));
    expect(stray).toEqual([]);
  });

  it('has the splayed bay on the river front, with the sign facing the river', () => {
    // The bay's front is the footprint's: its corners are vertices of the data's outline (within 0.3 m).
    const ring = hotel.r.map(([e, n]) => royalDartFromEN(e, n));
    for (const [x, y] of RD_BAY.slice(1, 3)) expect(Math.min(...ring.map(([rx, ry]) => Math.hypot(rx - x, ry - y)))).toBeLessThan(0.3);
    // The sign: on the bay's front, at the fascia, facing west-north-west (towards the river, the far bank).
    let sign: THREE.Mesh | undefined;
    rd.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'royal-dart-sign') sign = o;
    });
    expect(sign).toBeDefined();
    const g = sign!.geometry;
    g.computeVertexNormals();
    const nrm = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal') as THREE.BufferAttribute, 0);
    const bearing = ((Math.atan2(nrm.x, -nrm.z) * 180) / Math.PI + 360) % 360;
    expect(bearing).toBeGreaterThan(270);
    expect(bearing).toBeLessThan(300);
    const ys = vertices('-sign').map((v) => v[2]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(RD_LEVELS.fascia);
    expect(Math.max(...ys)).toBeLessThanOrEqual(RD_LEVELS.first);
  });

  it('sets the balconies back inside the bay’s outline, the ends on the wall', () => {
    const inner = offsetPolyline(RD_BAY, -1, 0);
    expect(inner[0]![0]).toBeCloseTo(0, 6);
    expect(inner[3]![0]).toBeCloseTo(0, 6);
    expect(inner[1]![0]).toBeCloseTo(-0.95, 6);
    expect(inner[2]![0]).toBeCloseTo(-0.95, 6);
    // Symmetric about the bay's middle, and narrower than the outline.
    expect(inner[1]![1] + inner[2]![1]).toBeCloseTo(RD_BAY[1]![1] + RD_BAY[2]![1], 6);
    expect(inner[2]![1] - inner[1]![1]).toBeLessThan(RD_BAY[2]![1] - RD_BAY[1]![1]);
  });

  it('lights its windows at night', () => {
    let glass: THREE.MeshStandardMaterial | undefined;
    rd.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'royal-dart-glass') glass = o.material as THREE.MeshStandardMaterial;
    });
    rd.setNight(0);
    expect(glass!.emissiveIntensity).toBe(0);
    rd.setNight(1);
    expect(glass!.emissiveIntensity).toBeGreaterThan(0.5);
    rd.setNight(0);
  });
});

describe('the passenger pier at the Royal Dart', () => {
  const { shore } = KINGSWEAR_PASSENGER_PIER;
  const isOurs = (p: DartFeatures['piers'][number]) => {
    const pts = 'line' in p ? p.line : p.poly;
    return pts.some(([e, n]) => Math.hypot(e - shore[0], n - shore[1]) < 1.5);
  };
  const ours = features.piers.filter(isOurs);
  const outline = ours.find((p) => 'poly' in p) as { poly: [number, number][] } & DartFeatures['piers'][number];

  it('is drawn as a truss gangway from the wing’s loggia to a pontoon, inside the data’s outline', () => {
    expect(ours.length).toBe(2);
    const drawn = ours.flatMap((p) => passengerPierAsDrawn(p));
    expect(drawn.length).toBe(1);
    const pontoon = drawn[0]!;
    expect(pontoon.floating).toBe(true);
    expect(pontoon.gangway?.style).toBe('truss');
    expect(pontoon.gangway?.shoreY).toBe(RD_WING.loggia);
    // The pontoon and the gangway's landing lie inside the outline boats meet; the shore end on the wing's loggia.
    const [h0, h1] = pontoon.line!;
    const along = (t: number): [number, number] => [h0![0] + (h1![0] - h0![0]) * t, h0![1] + (h1![1] - h0![1]) * t];
    for (const [e, n] of [along(0.03), along(0.5), along(0.97), pontoon.gangway!.pontoon]) expect(insideRing(outline.poly, e, n)).toBe(true);
    const loggia = vertices('-paving').filter((v) => Math.abs(v[2] - RD_WING.loggia) < 0.01);
    expect(Math.min(...loggia.map(([e, n]) => Math.hypot(e - pontoon.gangway!.shore[0], n - pontoon.gangway!.shore[1])))).toBeLessThan(2.5);
    // Every other pier is unchanged.
    for (const p of features.piers.filter((x) => !isOurs(x))) expect(passengerPierAsDrawn(p)).toEqual([p]);
  });

  it('tilts the gangway with the tide, from the pontoon up to the loggia', () => {
    const drawn = ours.flatMap((p) => passengerPierAsDrawn(p));
    const pontoons = buildPontoons(drawn, () => 3);
    expect(pontoons.gangways.length).toBe(1);
    const g = pontoons.gangways[0]!;
    expect(g.mesh.getObjectByName('gangway-truss')).toBeDefined();
    for (const level of [-2, 0, 2]) {
      pontoons.update(level);
      g.mesh.updateMatrixWorld(true);
      // The span's far end (z = 1 in the gangway's frame) is at the loggia's floor.
      const far = new THREE.Vector3(0, 0, 1).applyMatrix4(g.mesh.matrixWorld);
      expect(far.y).toBeCloseTo(RD_WING.loggia, 1);
      expect(Math.hypot(far.x - shore[0], -far.z - shore[1])).toBeLessThan(0.2);
      const near = new THREE.Vector3(0, 0, 0).applyMatrix4(g.mesh.matrixWorld);
      expect(near.y).toBeCloseTo(level + 0.42, 1);
    }
  });

  it('has nobody standing on the gangway, nor at the old jetty’s fixed deck', () => {
    const drawn = passengerPierAsDrawn(outline)[0]!;
    const [a, b] = [drawn.gangway!.pontoon, drawn.gangway!.shore];
    const spots = standingSpots(features);
    for (const s of spots) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((s.e - a[0]) * (b[0] - a[0]) + (s.n - a[1]) * (b[1] - a[1])) / (L * L);
      const d = Math.hypot(s.e - a[0] - (b[0] - a[0]) * t, s.n - a[1] - (b[1] - a[1]) * t);
      if (t > 0.1 && t < 0.9) expect(d).toBeGreaterThan(1.5);
    }
    // Anyone within the outline is on the pontoon, floating with it (the outline was a fixed deck at 3 m ODN).
    for (const s of spots.filter((x) => insideRing(outline.poly, x.e, x.n))) expect(s.floating).toBe(true);
  });
});
