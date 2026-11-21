import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Woodland } from '../../src/render/trees';

/**
 * Trees (package C, review #35): several shapes, still instanced, at the same places as before (a shape is picked by
 * a hash of the tree's position, so no tree moves and none is added), and far off, at the lowest preset, crossed-quad
 * impostors that cast no shadow.
 */

/** A square of dark-green drape (woodland) 1 km across, centred on the origin, on flat ground above the shore. */
function wood(impostors = false): Woodland {
  const nx = 100;
  const pixels = new Uint8ClampedArray(nx * nx * 4);
  for (let k = 0; k < nx * nx; k++) pixels.set([32, 58, 30, 255], k * 4);
  const w = new Woodland({ pixels, drape: { nx, ny: nx, cell: 10, e0: -500, n0: -500 }, groundAt: () => 20 });
  w.impostors = impostors;
  return w;
}

function cameraAt(e: number, n: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera();
  c.position.set(e, 40, -n);
  return c;
}

const meshes = (w: Woodland) => w.group.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);

/** Every tree's position (e, n) from the instance matrices, sorted. */
function positions(w: Woodland): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const mesh of meshes(w)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push(`${p.x.toFixed(2)},${(-p.z).toFixed(2)}`);
    }
  }
  return out.sort();
}

describe('trees', () => {
  it('near trees come in several shapes, each one instanced mesh', () => {
    const w = wood();
    w.update(cameraAt(0, 0));
    const geos = new Set(meshes(w).map((m) => m.geometry.uuid));
    // Three broadleaf shapes and two conifers (a cone and a pine): more than the two meshes there were before.
    expect(geos.size).toBeGreaterThanOrEqual(4);
    expect(w.count).toBeGreaterThan(1000);
    // Every tree drawn once.
    expect(meshes(w).reduce((s, m) => s + m.count, 0)).toBe(w.count);
  });

  it('the shapes do not move or add trees: the same places, whichever band draws them', () => {
    const near = wood();
    near.update(cameraAt(0, 0));
    const far = wood(true);
    far.update(cameraAt(0, 1850)); // the whole wood beyond the impostor distance
    expect(positions(far)).toEqual(positions(near));
    // And the same every time (the shape from a hash of the place).
    const again = wood();
    again.update(cameraAt(0, 0));
    expect(meshes(again).map((m) => m.count)).toEqual(meshes(near).map((m) => m.count));
  });

  it('far off, with impostors on, each tree is two crossed quads (4 triangles) that cast no shadow', () => {
    const w = wood(true);
    w.update(cameraAt(0, 1850));
    const ms = meshes(w);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      expect(tris).toBe(4);
      expect(m.castShadow).toBe(false);
    }
    // Without impostors the same view draws the far crowns (more triangles each).
    const plain = wood(false);
    plain.update(cameraAt(0, 1850));
    for (const m of meshes(plain)) expect((m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3).toBeGreaterThan(4);
  });
});
