/**
 * Owner, 22 Nov 2026: "All flags should hang at the angle of the pole." A flag lashed to a staff turns about the staff
 * with its hoist along it. On a raked staff (Mosaique's ensign staff, 26° aft; the river boats', 11°) the flag hung from
 * the truck with its hoist vertical, clear of the staff below the truck. Now the hoist runs down the staff, whatever the
 * wind. Flags on upright staffs (the committee boat, the pin end) were and are along theirs.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { VesselState } from '../../src/sim/env/traffic';
import type { Course } from '../../src/sim/course/types';
import type { ResolvedCourse } from '../../src/sim/course/course';

// The traffic's name labels need a canvas (none here).
vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
vi.mock('../../src/render/colours', async (orig) => ({ ...(await orig<typeof import('../../src/render/colours')>()), coloursFlying: () => true }));
const { ShipBuoysView } = await import('../../src/render/mosaique');
const { TrafficView } = await import('../../src/render/traffic');
const { CourseScene } = await import('../../src/render/course');
const { ClubEnsign } = await import('../../src/render/clubEnsign');

const DEG = Math.PI / 180;
const DAY = Date.parse('2026-07-15T12:00:00Z');
const WINDS: [number, number][] = [
  [0, 1.5],
  [75, 5],
  [160, 11],
  [225, 3],
  [300, 8],
];

/** The hoist edge (the vertices at the flag's own x = 0) in world space: its top and bottom. */
function hoist(mesh: THREE.Mesh): { top: THREE.Vector3; bottom: THREE.Vector3 } {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let top: THREE.Vector3 | undefined;
  let bottom: THREE.Vector3 | undefined;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.abs(v.x) > 1e-4) continue;
    if (!top || v.y > top.y) top = v.clone();
    if (!bottom || v.y < bottom.y) bottom = v.clone();
  }
  return { top: top!.applyMatrix4(mesh.matrixWorld), bottom: bottom!.applyMatrix4(mesh.matrixWorld) };
}

/** Distance from a point to the line through `at` along `dir`. */
const offLine = (p: THREE.Vector3, at: THREE.Vector3, dir: THREE.Vector3) => {
  const d = p.clone().sub(at);
  return d.addScaledVector(dir, -d.dot(dir)).length();
};

describe('a flag on a raked staff hangs along the staff', () => {
  it('Mosaique’s ensign: its hoist down the staff from the truck (26° aft), in every wind', () => {
    const view = new ShipBuoysView();
    const cloth = view.yacht.getObjectByName('mosaique-ensign-cloth') as THREE.Mesh;
    const pivot = view.yacht.getObjectByName('mosaique-ensign')!;
    for (const [d, s] of WINDS) {
      view.update(DAY, { fromDir: d * DEG, speed: s }, 4.1);
      view.yacht.updateMatrixWorld(true);
      // The staff as drawn (src/render/mosaique.ts): from its head, raked 0.45 rad aft (+z in her frame).
      const head = pivot.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, Math.cos(0.45), Math.sin(0.45)).transformDirection(view.yacht.matrixWorld);
      const h = hoist(cloth);
      expect(offLine(h.top, head, dir), `top, ${d}° ${s} m/s`).toBeLessThan(0.03);
      // The hoist's foot 1.2 m down: on the staff (it hung 0.5 m clear of it before).
      expect(offLine(h.bottom, head, dir), `foot, ${d}° ${s} m/s`).toBeLessThan(0.03);
      expect(h.top.distanceTo(h.bottom)).toBeCloseTo(1.2, 1);
    }
  });

  it('the river boats’ ensigns: their hoists down their staffs (11° aft), lying still and under way', () => {
    const view = new TrafficView();
    const cam = new THREE.PerspectiveCamera();
    const state = (sog: number): VesselState =>
      ({ id: 'rc', name: 'test', label: 'test', unit: 0, kind: 'river-cruiser', length: 30, beam: 6.4, ram: false, n: 0, e: 0, heading: 0.7, sog, moving: true, phase: 'underway', parts: [] }) as VesselState;
    for (const [d, s] of WINDS) {
      for (const sog of [0, 4]) {
        // The wind where she is, as the air's velocity over the ground (north, east: m/s).
        const at = () => ({ n: -s * Math.cos(d * DEG), e: -s * Math.sin(d * DEG) });
        view.update([state(sog)], 3.3, cam, false, { fromDir: d * DEG, speed: s, at });
        view.group.updateMatrixWorld(true);
        const pivot = view.group.getObjectByName('ensign')!;
        const cloth = pivot.getObjectByName('ensign-flag') as THREE.Mesh;
        const staff = pivot.parent!;
        const head = pivot.getWorldPosition(new THREE.Vector3());
        // The staff as drawn: 1.3 m up for 0.25 m aft (+z in the boat's frame).
        const boat = staff.parent!;
        const dir = new THREE.Vector3(0, 1.3, 0.25).normalize().transformDirection(boat.matrixWorld);
        const h = hoist(cloth);
        expect(offLine(h.top, head, dir), `top, ${d}° ${s} m/s, ${sog} m/s`).toBeLessThan(0.02);
        expect(offLine(h.bottom, head, dir), `foot, ${d}° ${s} m/s, ${sog} m/s`).toBeLessThan(0.02);
      }
    }
  });
});

describe('a drooping flag keeps its hoist on its staff (it no longer swings off it in light air)', () => {
  /** A course with a committee boat and a pin end at (100, ±50), as in flagWind.test.ts. */
  function courseScene() {
    const course = { id: 't', name: 'T', marks: [{ id: 'cb', name: 'Start boat', kind: 'committee-boat' }, { id: 'pin', name: 'Pin', kind: 'pin' }] } as unknown as Course;
    const r = {
      pos: new Map([['cb', { n: 100, e: 50 }], ['pin', { n: 100, e: -50 }]]),
      start: [{ n: 100, e: -50 }, { n: 100, e: 50 }], finish: [{ n: 100, e: -50 }, { n: 100, e: 50 }], legs: [], boundaries: [],
    } as unknown as ResolvedCourse;
    const scene = new CourseScene(r, course);
    const named: Record<string, THREE.Mesh> = {};
    scene.group.traverse((o) => {
      if (o.name === 'committee-flag-cloth' || o.name === 'robot-mark-flag') named[o.name] = o as THREE.Mesh;
    });
    return { scene, committee: named['committee-flag-cloth']!, pin: named['robot-mark-flag']! };
  }
  /** The hoist's lean from its staff (degrees): the staff is upright in the flag's boat or mark. */
  const leanFromUpright = (cloth: THREE.Mesh) => {
    const h = hoist(cloth);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(cloth.parent!.parent!.matrixWorld);
    return (h.top.clone().sub(h.bottom).normalize().angleTo(up) * 180) / Math.PI;
  };

  it('the committee boat’s flag and the pin end’s, in a calm and a breeze', () => {
    const { scene, committee, pin } = courseScene();
    for (const [d, s] of WINDS) {
      scene.setWind(d * DEG, () => ({ n: -s * Math.cos(d * DEG), e: -s * Math.sin(d * DEG) }), s);
      scene.setCommitteeHeading(() => (d + 10) * DEG);
      scene.update(0, 'racing', false, 5.2);
      scene.group.updateMatrixWorld(true);
      // The hoist upright, along the staff (it leaned as far as the flag drooped: 39° at 1.5 m/s).
      expect(leanFromUpright(committee), `committee ${d}° ${s} m/s`).toBeLessThan(1);
      expect(leanFromUpright(pin), `pin ${d}° ${s} m/s`).toBeLessThan(1);
    }
  });

  it('the club’s ensign: its hoist hangs straight below its head in a calm', () => {
    const en = new ClubEnsign([0, 0], 5, 12);
    en.update(DAY, { fromDir: 250 * DEG, speed: 1 }, 3);
    en.group.updateMatrixWorld(true);
    const cloth = en.group.getObjectByName('club-ensign-flag') as THREE.Mesh;
    const h = hoist(cloth);
    expect((h.top.clone().sub(h.bottom).normalize().angleTo(new THREE.Vector3(0, 1, 0)) * 180) / Math.PI).toBeLessThan(1);
  });
});
