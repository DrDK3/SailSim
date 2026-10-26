import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BerthedFleet } from '../../src/render/berthed';

/** Berthed and moored boats: hundreds of instances of a few reduced-detail models, plain hulls far off. */
describe('berthed boats', () => {
  it('each detailed model is light enough to draw by the hundred', () => {
    const tris = BerthedFleet.trianglesPerVariant();
    console.log(`[berthed] triangles per model: ${tris.map((t) => Math.round(t)).join(', ')}`);
    for (const t of tris) {
      expect(t).toBeGreaterThan(300);
      expect(t).toBeLessThan(2500);
    }
  });

  it('near boats get detailed models, far ones plain hulls; empty berths are not drawn', () => {
    const fleet = new BerthedFleet(10, 100, 1000);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 10, 0);
    fleet.set(0, { n: 20, e: 0, heading: 0, length: 10, kind: 'yacht', seed: 0, visible: true });
    fleet.set(1, { n: 500, e: 0, heading: 1, length: 12, kind: 'motor', seed: 1, visible: true });
    fleet.set(2, { n: 30, e: 5, heading: 2, length: 9, kind: 'yacht', seed: 2, visible: false });
    fleet.set(3, { n: 5000, e: 0, heading: 0, length: 9, kind: 'yacht', seed: 3, visible: true });
    fleet.update(cam);
    const meshes = fleet.group.children as THREE.InstancedMesh[];
    // Boats drawn with models whose names match: one count per variant (its meshes share the count).
    const drawn = (re: RegExp) => {
      const per = new Map<string, number>();
      for (const m of meshes) if (re.test(m.name)) per.set(m.name, m.count);
      return [...per.values()].reduce((a, b) => a + b, 0);
    };
    expect(drawn(/^berthed-yacht#/)).toBe(1);
    expect(drawn(/^berthed-motor#/)).toBe(0);
    expect(drawn(/^berthed-far-motor$/)).toBe(1);
    expect(drawn(/^berthed-far-yacht$/)).toBe(0);
    // A boat comes back to its berth: it is drawn.
    fleet.setVisible(2, true);
    fleet.update(cam);
    expect(drawn(/^berthed-yacht#/)).toBe(2);
  });
});
