/**
 * SAMARITAN's name across her transom (owner, 18 Nov 2026: "Add the name … across the stern of the committee boat";
 * the owner typed 'Samartian': her name, from the owner's photograph and the code, is SAMARITAN). The plate lies on
 * the transom's face, leaning with its rake, between the bathing platform and the deck edge, facing aft.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SAMARITAN, samaritanModel } from '../../src/render/samaritan';

describe('SAMARITAN across her stern', () => {
  const boat = samaritanModel();
  boat.updateMatrixWorld(true);
  const plate = boat.getObjectByName('samaritan-name-stern') as THREE.Mesh;
  const body = boat.getObjectByName('samaritan-body') as THREE.Mesh;

  it('is her name, on the transom, facing aft, across most of its width', () => {
    expect(SAMARITAN.name).toBe('SAMARITAN');
    expect(plate).toBeDefined();
    // Facing aft (+z in the model: the bow is −z), leaning forward a little at the top, as the transom does.
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plate.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.z).toBeGreaterThan(0.97);
    expect(normal.y).toBeGreaterThan(0);
    // Above the bathing platform (its top 0.41 m), below the deck edge.
    const box = new THREE.Box3().setFromObject(plate);
    expect(box.min.y).toBeGreaterThan(0.41);
    expect(box.max.y).toBeLessThan(1.6);
    expect(box.max.x - box.min.x).toBeGreaterThan(1.8);
  });

  it('lies on the transom\'s face: just aft of the hull at its middle and its ends', () => {
    const ray = new THREE.Raycaster();
    const geo = plate.geometry as THREE.PlaneGeometry;
    const w = geo.parameters.width;
    const h = geo.parameters.height;
    for (const [u, v] of [[0, 0], [-0.45, 0], [0.45, 0], [0, 0.45], [0, -0.45]] as const) {
      const p = plate.localToWorld(new THREE.Vector3(u * w, v * h, 0));
      // Look forward at the hull from behind, at this point's height and offset.
      ray.set(new THREE.Vector3(p.x, p.y, p.z + 5), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(body, false)[0];
      expect(hit, `the hull behind the plate at (${u}, ${v})`).toBeDefined();
      const gap = p.z - hit!.point.z;
      expect(gap, `gap at (${u}, ${v})`).toBeGreaterThan(0.005);
      expect(gap, `gap at (${u}, ${v})`).toBeLessThan(0.08);
    }
  });
});
