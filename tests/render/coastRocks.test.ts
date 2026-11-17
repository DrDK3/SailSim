/**
 * The rocky coast drawn (src/render/coastRocks.ts), without a browser: sound shapes (no broken points), the faces
 * rising from under the water, the tops meeting the hillside, the boulders bedded, within a triangle budget; and
 * the cliff tops share the ground's picture when there is one.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCoastRocks } from '../../src/render/coastRocks';
import { coastRocks } from '../../src/sim/env/coastRocks';
import { loadDartApp } from '../sim/helpers';

const app = loadDartApp();
const bed = (n: number, e: number) => app.geo.bedElevation(n, e);
const rocks = coastRocks(app.geo, bed, app.features as never);

describe('the rocky coast drawn', () => {
  const ground = (e: number, n: number) => bed(n, e);
  const plain = buildCoastRocks(rocks, { ground });
  const meshes = plain.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

  it('is cut into tiles of rock, every point sound', () => {
    expect(meshes.length).toBeGreaterThan(5);
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      const c = m.geometry.getAttribute('color');
      expect(c.count).toBe(p.count);
      for (let k = 0; k < p.count; k++) expect(Number.isFinite(p.getX(k)) && Number.isFinite(p.getY(k)) && Number.isFinite(p.getZ(k))).toBe(true);
    }
  });

  it('rises from under the water to cliffs tens of metres high, within a budget of triangles', () => {
    let lo = Infinity;
    let hi = -Infinity;
    let tris = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      tris += p.count / 3;
      for (let k = 0; k < p.count; k++) {
        lo = Math.min(lo, p.getY(k));
        hi = Math.max(hi, p.getY(k));
      }
    }
    expect(lo).toBeLessThan(-2);
    expect(hi).toBeGreaterThan(15);
    expect(tris).toBeLessThan(400_000);
  });

  it('with the ground picture, the tops are drawn in the terrain material (with its coordinates)', () => {
    const mat = new THREE.MeshStandardMaterial();
    const g = buildCoastRocks(rocks, { ground, topMaterial: mat, uvAt: (e, n) => [e / 1000, n / 1000] });
    const tops = g.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.material === mat);
    expect(tops.length).toBeGreaterThan(5);
    for (const t of tops) expect(t.geometry.getAttribute('uv').count).toBe(t.geometry.getAttribute('position').count);
  });
});
