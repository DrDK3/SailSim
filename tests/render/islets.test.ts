/**
 * The islets' rock and the Daymark, built without a browser: sound shapes at the right heights, within a budget.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildIslets, isletGeometry } from '../../src/render/islets';
import { DAYMARK, buildDaymark } from '../../src/render/daymark';
import { isletOutlines } from '../../src/sim/env/islets';

describe('the islets drawn', () => {
  const outs = isletOutlines();

  it('each rises from below the water to about its height, with no broken (NaN) points', () => {
    outs.forEach((o, i) => {
      const g = isletGeometry(o.ring, o.height, i + 1);
      const p = g.getAttribute('position');
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        expect(Number.isFinite(p.getX(k)) && Number.isFinite(y) && Number.isFinite(p.getZ(k))).toBe(true);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      expect(lo).toBeLessThan(-3);
      expect(hi).toBeGreaterThan(o.height * 0.9);
      expect(hi).toBeLessThan(o.height * 1.15 + 0.5);
    });
  });

  it('all of them together stay a small model (under 12 000 triangles)', () => {
    const m = buildIslets(outs);
    expect(m.geometry.getAttribute('position').count / 3).toBeLessThan(12_000);
    expect(m.name).toBe('islets');
  });
});

describe('the Daymark drawn', () => {
  it('is 24 m high from its foot, octagonal, and stands where it is put', () => {
    const m = buildDaymark(100, -200, 140);
    const box = new THREE.Box3().setFromObject(m);
    expect(box.max.y - (140 - 0.3)).toBeCloseTo(DAYMARK.height, 1);
    expect(m.position.x).toBe(100);
    expect(m.position.z).toBe(200);
    // Its base about 6.8 m across, the octagon's corners.
    expect(box.max.x - box.min.x).toBeGreaterThan(6);
    expect(box.max.x - box.min.x).toBeLessThan(7.5);
  });
});
