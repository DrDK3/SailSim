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

  /** Every vertex of the meshes named `name` in the vessel's model (model coordinates). */
  function vertices(kind: VesselState['kind'], length: number, beam: number, name: string): THREE.Vector3[] {
    const view = new TrafficView();
    view.update([state(kind, length, beam, { heading: 0, n: 0, e: 0 })], 0, cam, false);
    const root = view.group.children.find((c) => c.name === `vessel-${kind}`)!;
    const out: THREE.Vector3[] = [];
    let part: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (!part && o.name === name) part = o;
    });
    part?.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    });
    return out;
  }

  it("the Lower Ferry's float has no cabin: nothing stands on its walkways above the rails but the lamps and the ramp gear (owner, 5 Nov 2026)", () => {
    const v = vertices('tug-float', 33, 11, 'float');
    expect(v.length).toBeGreaterThan(1000);
    const deck = Math.min(...v.filter((p) => Math.abs(p.x) < 1 && Math.abs(p.z) < 2).map((p) => p.y).filter((y) => y > 0.3));
    // Where the crew shelter stood (on the port walkway, amidships): clear above the rails.
    const shelter = v.filter((p) => p.x > -5.3 && p.x < -4.3 && p.z > 0.6 && p.z < 3.4 && p.y > deck + 1.25 && p.y < deck + 2.6);
    expect(shelter).toHaveLength(0);
  });

  it('the Higher Ferry is symmetrical, her control cabin high on a gantry amidships over the car deck (owner, 5 Nov 2026)', () => {
    const v = vertices('floating-bridge', 50, 16, 'higher-ferry');
    const top = Math.max(...v.map((p) => p.y));
    const high = v.filter((p) => p.y > top - 3.5);
    const meanX = high.reduce((a, p) => a + p.x, 0) / high.length;
    const meanZ = high.reduce((a, p) => a + p.z, 0) / high.length;
    expect(top).toBeGreaterThan(9);
    expect(Math.abs(meanX)).toBeLessThan(0.6);
    expect(Math.abs(meanZ)).toBeLessThan(1.5);
    // Cars pass under it: nothing between the lanes' outer lines from the car tops (2 m) up to the bridge deck.
    const underBridge = v.filter((p) => Math.abs(p.x) < 5 && Math.abs(p.z) < 1.4 && p.y > 4 && p.y < 7);
    expect(underBridge).toHaveLength(0);
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
