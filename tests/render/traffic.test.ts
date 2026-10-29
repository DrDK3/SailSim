import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { VesselState } from '../../src/sim/env/traffic';

// Labels draw text on a canvas (a browser API): plain sprites here.
vi.mock('../../src/render/labels', () => ({ makeLabel: () => new THREE.Sprite() }));
const { TrafficView, minehunterModel } = await import('../../src/render/traffic');

/** The river traffic's models (visual only): every kind builds, within a budget, with its moving parts. */

const KINDS: [VesselState['kind'], number, number][] = [
  ['tug-float', 33, 11],
  ['floating-bridge', 50, 16],
  ['passenger-ferry', 18, 5.2],
  ['launch', 10, 3.5],
  ['river-cruiser', 30, 6.4],
  ['river-cruiser', 12, 4],
  ['motor-cruiser', 10.5, 3.6],
  ['yacht', 10, 3.3],
  ['rib', 6.5, 2.5],
];

function state(kind: VesselState['kind'], length: number, beam: number, extra: Partial<VesselState> = {}): VesselState {
  return {
    id: `${kind}-${length}`, name: 'test', label: 'test', unit: 0, kind, length, beam, ram: kind === 'tug-float',
    n: 0, e: 0, heading: 0, sog: 1.5, moving: true, phase: 'underway', ramp: 1, parts: [],
    tug: kind === 'tug-float' ? { n: 0, e: 7, heading: 0 } : undefined,
    ...extra,
  } as VesselState;
}

function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((m) => {
    if (m instanceof THREE.Mesh && m.visible) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  });
  return n;
}

describe('river traffic models', () => {
  const cam = new THREE.PerspectiveCamera();

  it('every kind builds as a handful of merged meshes within a triangle budget', () => {
    for (const [kind, length, beam] of KINDS) {
      const view = new TrafficView();
      view.update([state(kind, length, beam)], 0, cam, false);
      const root = view.group.children.find((c) => c.name === `vessel-${kind}`)!;
      expect(root).toBeDefined();
      let meshes = 0;
      root.traverse((m) => {
        if (m instanceof THREE.Mesh && m.parent?.name !== 'lights') meshes++;
      });
      expect(meshes).toBeLessThanOrEqual(16);
      expect(triangles(view.group)).toBeLessThan(45_000);
      expect(triangles(view.group)).toBeGreaterThan(3_000);
    }
  });

  it("the Lower Ferry's tug is its own model; the ramps hinge down to load and up to cross", () => {
    const view = new TrafficView();
    view.update([state('tug-float', 33, 11, { ramp: 0, moving: false, phase: 'berthed' })], 0, cam, false);
    const names = new Set<string>();
    view.group.traverse((o) => names.add(o.name));
    expect(names.has('tug')).toBe(true);
    const ramp = () => {
      let r: THREE.Object3D | undefined;
      view.group.traverse((o) => {
        if (o.name === 'ramp-bow') r = o;
      });
      return r!.rotation.x;
    };
    const down = ramp();
    view.update([state('tug-float', 33, 11, { ramp: 1 })], 1, cam, false);
    expect(Math.abs(ramp() - down)).toBeGreaterThan(0.2);
  });

  it('the Hindostan (a moored Sandown-class minehunter) builds at her size, bow along -z, its mast forward of amidships', () => {
    const ship = minehunterModel(52.5, 10.5);
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    expect(box.max.z - box.min.z).toBeGreaterThan(50);
    expect(box.max.z - box.min.z).toBeLessThan(56);
    expect(box.max.x - box.min.x).toBeGreaterThan(9.5);
    expect(box.max.x - box.min.x).toBeLessThan(12.5);
    // The highest point (the masthead) lies forward of amidships.
    let top = { y: -Infinity, z: 0 };
    ship.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top.y) top = { y: pos.getY(i), z: pos.getZ(i) };
    });
    expect(top.z).toBeLessThan(0);
    expect(triangles(ship)).toBeLessThan(45_000);
  });

  it('copies of a model share its geometry; each has its own wake', () => {
    const view = new TrafficView();
    // Two boats that draw the same version (the view picks it from a hash of the id).
    const variant = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 12;
    const twin = Array.from({ length: 50 }, (_, i) => `b${i}`).find((id) => variant(id) === variant('a'))!;
    view.update([state('motor-cruiser', 10.5, 3.6, { id: 'a' }), state('motor-cruiser', 10.5, 3.6, { id: twin })], 0, cam, false);
    const [a, b] = view.group.children.filter((c) => c.name === 'vessel-motor-cruiser');
    const geos = (o: THREE.Object3D) => {
      const out: THREE.BufferGeometry[] = [];
      o.traverse((m) => {
        if (m instanceof THREE.Mesh && m.name !== 'wake') out.push(m.geometry);
      });
      return out;
    };
    expect(geos(a!)[0]).toBe(geos(b!)[0]);
    const wake = (o: THREE.Object3D) => {
      let w: THREE.Mesh | undefined;
      o.traverse((m) => {
        if (m.name === 'wake') w = m as THREE.Mesh;
      });
      return w!.material;
    };
    expect(wake(a!)).not.toBe(wake(b!));
  });
});
