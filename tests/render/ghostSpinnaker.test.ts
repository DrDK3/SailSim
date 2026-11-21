import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SquibModel } from '../../src/render/squibModel';
import { GHOST_OPACITY, makeGhost } from '../../src/render/ghostLook';
import { squibParams } from '../../src/sim/index';
import type { SpinnakerPose } from '../../src/render/spinnakerView';

/**
 * A ghost (ghost racing) is see-through all over, its spinnaker too (CI, 21 Nov 2026: the spinnaker and its pole,
 * made the first time the ghost's recording carried one, after the rest of the ghost was made see-through, were
 * drawn solid: 42 of 44 meshes see-through).
 */
const SPIN: SpinnakerPose = { phase: 'up', deployed: 1, fill: 1, poleSide: 1, awa: 2.4, aws: 4, progress: 0 };

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

const seeThrough = (m: THREE.Mesh) => {
  const mat = m.material as THREE.Material;
  return mat.transparent && mat.opacity < 0.5;
};

describe('a ghost boat', () => {
  it('is see-through all over, the spinnaker made later included, and keeps its colours when they change', () => {
    const m = new SquibModel(squibParams());
    makeGhost(m.group);
    const before = meshes(m.group).length;
    m.update({ main: { angle: 0.6, luff: 0, fill: 1 }, jib: { angle: -0.6, luff: 0, fill: 1 }, rudder: 0, crewY: 0, time: 1, aws: 4, awa: 2.4, spin: SPIN, dt: 1 / 60 });
    const all = meshes(m.group);
    expect(all.length).toBeGreaterThan(before); // the spinnaker and its pole were made
    expect(all.filter((x) => !seeThrough(x)).map((x) => x.name)).toEqual([]);
    m.setSpinnakerColours(['#ff0000', '#ffffff', '#0000ff']);
    const sail = all.find((x) => x.name === 'spinnaker-sail')!;
    expect((sail.material as THREE.Material).opacity).toBeCloseTo(GHOST_OPACITY, 6);
  });

  it('a boat that is not a ghost keeps a solid spinnaker', () => {
    const m = new SquibModel(squibParams());
    m.update({ main: { angle: 0.6, luff: 0, fill: 1 }, jib: { angle: -0.6, luff: 0, fill: 1 }, rudder: 0, crewY: 0, time: 1, aws: 4, awa: 2.4, spin: SPIN, dt: 1 / 60 });
    const sail = meshes(m.group).find((x) => x.name === 'spinnaker-sail')!;
    expect((sail.material as THREE.Material).transparent).toBe(false);
  });
});
