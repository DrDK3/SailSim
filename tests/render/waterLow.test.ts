import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOW_RIPPLES, Water } from '../../src/render/water';

/**
 * Simple water (the Performance preset; package C): Start Bay showed regular parallel stripes, because simple water
 * drew five ripple trains at regular wavelengths (0.12 m × 2.2ⁿ, the longest 2.8 m) that ran in step over the whole
 * bay. It now draws every other train of the detailed spectrum (the same jittered wavelengths and directions), fades
 * each before the pixel reaches half its wavelength, and varies alternate trains in patches.
 */

type Rip = { a: THREE.Vector4[]; b: THREE.Vector4[]; count: number };

function ripples(detail: 'low' | 'high'): Rip {
  const w = new Water(new THREE.Vector3(0.3, 0.8, 0.2).normalize(), new THREE.Color(0xa0b0c0), 0.0004);
  w.setDetail(detail);
  w.setWind(6, Math.PI / 4);
  const u = (w.mesh.material as THREE.ShaderMaterial).uniforms;
  return { a: (u.uRipA!.value as THREE.Vector4[]).map((v) => v.clone()), b: (u.uRipB!.value as THREE.Vector4[]).map((v) => v.clone()), count: u.uRipCount!.value as number };
}

describe('simple water (Performance preset)', () => {
  it('draws every other train of the detailed spectrum, the same wavelengths and directions', () => {
    const hi = ripples('high');
    const lo = ripples('low');
    expect(hi.count).toBe(13);
    expect(lo.count).toBe(LOW_RIPPLES.length);
    LOW_RIPPLES.forEach((i, j) => {
      expect(lo.a[j]!.z).toBeCloseTo(hi.a[i]!.z, 10); // wavelength
      expect(lo.a[j]!.x).toBeCloseTo(hi.a[i]!.x, 10); // direction
      expect(lo.a[j]!.y).toBeCloseTo(hi.a[i]!.y, 10);
      expect(lo.b[j]!.x).toBeCloseTo(hi.b[i]!.x, 10); // wavenumber
    });
  });

  it('no two of its trains are in a regular ratio (the stripes came from 0.12 m × 2.2ⁿ)', () => {
    const lo = ripples('low');
    const ratios = lo.a.slice(1, lo.count).map((v, j) => v.z / lo.a[j]!.z);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(spread).toBeGreaterThan(0.1);
    for (const r of ratios) expect(Math.abs(r - 2.2)).toBeGreaterThan(0.05);
  });

  it('its shader fades each train earlier and varies alternate trains in patches; detailed water is as it was', () => {
    const w = new Water(new THREE.Vector3(0, 1, 0), new THREE.Color(0xffffff), 0.0004);
    const src = (w.mesh.material as THREE.ShaderMaterial).fragmentShader;
    expect(src).toContain('#ifndef WATER_HIGH');
    expect(src).toContain('smoothstep(a.z * 0.12, a.z * 0.45');
    expect(src).toContain('patchA');
    // The detailed path keeps its fade.
    expect(src).toContain('smoothstep(a.z * 0.2, a.z * 0.7');
  });
});
