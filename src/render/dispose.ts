import * as THREE from 'three';

/**
 * Releasing GPU memory (comprehensive review, GR-2). Removing an object from the scene does not free its
 * geometry buffers or textures on the GPU: each race restart left about 55 geometries behind. `disposeObject`
 * frees what an object subtree owns. Materials, textures and geometries that many objects share (module-level
 * ones) are registered with `shared` and left alone: disposing them would only make three.js upload them again.
 */
const SHARED = new WeakSet<object>();

/** Register resources that outlive any one object (module-level materials, cached textures, shared geometry). */
export function shared<T extends object>(x: T): T {
  SHARED.add(x);
  return x;
}

/** Register every value of a record of materials (e.g. a module's `MAT` table). */
export function sharedAll<T extends Record<string, object>>(table: T): T {
  for (const v of Object.values(table)) SHARED.add(v);
  return table;
}

export function isShared(x: object): boolean {
  return SHARED.has(x);
}

function disposeTexturesOf(mat: THREE.Material, seen: Set<object>): void {
  const visit = (v: unknown) => {
    if (v instanceof THREE.Texture && !SHARED.has(v) && !seen.has(v)) {
      seen.add(v);
      v.dispose();
    }
  };
  for (const v of Object.values(mat)) visit(v);
  const uniforms = (mat as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) visit(u?.value);
}

/** Free the GPU resources owned by `root` and everything below it. Call after removing it from the scene. */
export function disposeObject(root: THREE.Object3D): void {
  const seen = new Set<object>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // Sprites share one quad geometry inside three.js: never dispose it.
    if (m.geometry && !(o instanceof THREE.Sprite) && !SHARED.has(m.geometry) && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      disposeTexturesOf(mat, seen);
      if (!SHARED.has(mat)) mat.dispose();
    }
  });
}
