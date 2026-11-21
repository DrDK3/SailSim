import * as THREE from 'three';

/** How see-through a ghost is (ghost racing: only a picture of an earlier run). */
export const GHOST_OPACITY = 0.35;

/**
 * Make a group see-through, as a ghost: its own copies of the materials (transparent, faint, not writing depth) and
 * no shadows. Marks the group, so parts made later (a spinnaker the first time it is carried) are made see-through
 * too (src/render/squibModel.ts).
 */
export function makeGhost(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    const one = (x: THREE.Material) => {
      const c = x.clone();
      c.transparent = true;
      c.opacity = GHOST_OPACITY * (x.opacity ?? 1);
      c.depthWrite = false;
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
  });
  group.userData.ghost = true;
}
