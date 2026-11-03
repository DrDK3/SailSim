import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { squibParams } from '../../src/sim/boat/squib';
import { SquibModel } from '../../src/render/squibModel';
import { SAMARITAN, samaritanModel } from '../../src/render/samaritan';
import { CourseScene } from '../../src/render/course';
import type { Course } from '../../src/sim/course/types';
import type { ResolvedCourse } from '../../src/sim/course/course';

/**
 * Owner review (1 Nov 2026): the Squib's rudder could not be seen (it sat inside the hull), and the start boat,
 * a grey box, is to be the committee boat SAMARITAN, a Southerly with a navy blue canopy (owner's photograph).
 */

function bounds(o: THREE.Object3D): THREE.Box3 {
  let root = o;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

/** A stand-in for the browser's canvas (the scene's text labels draw on one): every call does nothing. */
function stubCanvas(): void {
  const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 60 }) : () => undefined), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}
afterEach(() => vi.unstubAllGlobals());

describe('the Squib rudder', () => {
  const m = new SquibModel(squibParams());
  const find = (name: string) => {
    let hit: THREE.Object3D | undefined;
    m.group.traverse((o) => {
      if (!hit && o.name === name) hit = o;
    });
    return hit!;
  };

  it('hangs on the transom: the blade aft of it, the head above its top, the blade 0.8 m deep', () => {
    const transom = bounds(find('hull-transom'));
    const blade = bounds(find('rudder-blade'));
    const head = bounds(find('rudder-head'));
    // The blade's leading edge is just aft of the transom (not inside the hull), and most of it outside.
    expect(blade.min.z).toBeGreaterThan(transom.max.z);
    expect(blade.max.z - transom.max.z).toBeGreaterThan(0.25);
    // Its head stands clear above the transom's top, where the tiller is fixed.
    expect(head.max.y).toBeGreaterThan(transom.max.y + 0.15);
    // The blade reaches from near the transom's top down to the physics' rudder-heel depth (0.8 m).
    expect(blade.max.y).toBeGreaterThan(transom.max.y - 0.1);
    expect(blade.min.y).toBeCloseTo(-0.81, 1);
  });

  it('the tiller runs from the head forward over the deck into the cockpit', () => {
    const tiller = bounds(find('tiller'));
    const transom = bounds(find('hull-transom'));
    expect(tiller.max.z).toBeGreaterThan(transom.max.z);
    expect(tiller.min.z).toBeLessThan(transom.max.z - 1);
    expect(tiller.min.y).toBeGreaterThan(transom.max.y);
  });
});

describe('the committee boat SAMARITAN', () => {
  it('is a Southerly-sized sloop with her navy canopy, sail cover and name', () => {
    const g = samaritanModel();
    const b = bounds(g);
    const size = b.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(SAMARITAN.loa - 0.2);
    expect(size.z).toBeLessThan(SAMARITAN.loa + 1.2); // with the pulpit, bow roller and flag
    expect(size.x).toBeGreaterThan(SAMARITAN.beam - 0.2);
    expect(size.x).toBeLessThan(SAMARITAN.beam + 1.2);
    expect(b.max.y).toBeGreaterThan(13.5); // her mast
    // Navy canvas (sprayhood, canopy, sail cover) among the vertex colours.
    let navy = 0;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const col = mesh.geometry?.getAttribute('color');
      if (!col) return;
      const c = new THREE.Color();
      for (let i = 0; i < col.count; i += 3) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.LinearSRGBColorSpace);
        const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
        if (hsl.h > 0.55 && hsl.h < 0.7 && hsl.l < 0.12) navy++;
      }
    });
    expect(navy).toBeGreaterThan(50);
  });

  it('has what the owner\'s photograph shows: tinted glass, burgundy hatch covers, a white furled genoa', () => {
    const g = samaritanModel();
    const glass = g.children.find((c) => c.name === 'samaritan-glass') as THREE.Mesh;
    const tint = (glass.material as THREE.MeshStandardMaterial).color.getHSL({ h: 0, s: 0, l: 0 });
    expect(tint.l).toBeLessThan(0.1);
    // Vertex colours of the canvas parts: burgundy (hatch covers), navy (canopy, stack pack) and the genoa's white.
    const counts = { burgundy: 0, navy: 0, white: 0 };
    g.traverse((o) => {
      const col = (o as THREE.Mesh).geometry?.getAttribute('color');
      if (!col) return;
      const c = new THREE.Color();
      for (let i = 0; i < col.count; i++) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.LinearSRGBColorSpace);
        const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
        if ((hsl.h > 0.95 || hsl.h < 0.03) && hsl.s > 0.4 && hsl.l < 0.25) counts.burgundy++;
        else if (hsl.h > 0.55 && hsl.h < 0.7 && hsl.l < 0.12) counts.navy++;
        else if (hsl.l > 0.8) counts.white++;
      }
    });
    expect(counts.burgundy).toBeGreaterThan(20);
    expect(counts.navy).toBeGreaterThan(200);
    expect(counts.white).toBeGreaterThan(1000);
  });

  it('replaces the box at the line end and lies as the simulation says (head to wind here)', () => {
    stubCanvas();
    const course = {
      id: 't', name: 'T', marks: [{ id: 'cb', name: 'Start boat', kind: 'committee-boat' }, { id: 'pin', name: 'Pin', kind: 'pin' }],
    } as unknown as Course;
    const r = {
      pos: new Map([['cb', { n: 100, e: 50 }], ['pin', { n: 100, e: -50 }]]),
      start: [{ n: 100, e: -50 }, { n: 100, e: 50 }], finish: [{ n: 100, e: -50 }, { n: 100, e: 50 }], legs: [], boundaries: [],
    } as unknown as ResolvedCourse;
    const scene = new CourseScene(r, course);
    let boat: THREE.Object3D | undefined;
    scene.group.traverse((o) => {
      if (o.name === 'committee-boat') boat = o;
    });
    expect(boat).toBeDefined();
    // Lying head to a wind from the south-west (src/sim/race/anchored.ts): the bow (−z in the model) points there.
    scene.setCommitteeHeading(() => (225 * Math.PI) / 180);
    boat!.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(boat!.matrixWorld);
    // In the scene, x = east and −z = north: south-west is (−x, +z).
    expect(fwd.x).toBeLessThan(-0.6);
    expect(fwd.z).toBeGreaterThan(0.6);
  });
});
