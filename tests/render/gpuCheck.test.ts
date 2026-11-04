import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { judge, lambertOf, type ProbeColour } from '../../src/render/gpuCheck';

/** Owner review, 4 Nov 2026: painted hulls and marks drew black on the owner's graphics card. */
describe('graphics check', () => {
  const probes = (orange: [number, number, number], hull: [number, number, number]): ProbeColour[] => [
    { name: 'orange paint (as the marks)', rgb: orange },
    { name: 'white vertex colour (as the hulls)', rgb: hull },
    { name: 'white textured (as the band)', rgb: [0.95, 0.95, 0.93] },
    { name: 'orange unlit (reference)', rgb: [1, 0.2, 0.01] },
    { name: 'white unlit (reference)', rgb: [1, 1, 1] },
  ];
  it('passes painted surfaces that draw as expected (the software renderer\'s measurements)', () => {
    expect(judge(probes([0.99, 0.23, 0.045], [0.986, 0.971, 0.936])).fault).toBe(false);
  });
  it('finds the fault seen on the owner\'s card: black paint beside a correct textured band', () => {
    const j = judge(probes([0.02, 0.01, 0.01], [0.03, 0.03, 0.03]));
    expect(j.fault).toBe(true);
    expect(j.reason).toMatch(/orange paint drew dark/);
    expect(j.reason).toMatch(/white vertex-coloured paint drew dark/);
  });
  it('the simple-material copy keeps colour, vertex colours, sides and opacity', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xff7a1a, vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const l = lambertOf(m);
    expect(l).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(l.color.getHex()).toBe(0xff7a1a);
    expect(l.vertexColors).toBe(true);
    expect(l.side).toBe(THREE.DoubleSide);
    expect(l.opacity).toBe(0.5);
  });
});
