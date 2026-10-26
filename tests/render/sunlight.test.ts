import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SunLight } from '../../src/render/sunlight';

/** Cascaded shadows: every lit material is set up once, keeping its own shader changes and program key. */

type Shader = { uniforms: Record<string, unknown>; fragmentShader: string };

describe('cascaded shadows', () => {
  it('sets up lit materials only, chains their shader hooks, and gives each its own program key', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 25000);
    const sun = new SunLight(scene, camera, 'high');
    sun.set(new THREE.Vector3(0.3, 0.8, 0.2), 3, new THREE.Color(0xffffff));
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = (s) => {
      s.fragmentShader += '\n// building';
    };
    const b = new THREE.MeshStandardMaterial();
    b.onBeforeCompile = (s) => {
      s.fragmentShader += '\n// terrain';
    };
    const unlit = new THREE.MeshBasicMaterial();
    for (const m of [a, b, unlit]) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
    sun.update(new THREE.Vector3());
    expect(a.defines!.USE_CSM).toBe(1);
    expect(b.defines!.USE_CSM).toBe(1);
    expect(unlit.defines?.USE_CSM).toBeUndefined();
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    const shader: Shader = { uniforms: {}, fragmentShader: '' };
    a.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('// building');
    expect(shader.uniforms.CSM_cascades).toBeDefined();
    // The cascade lights replace the single sun: three, each with a shadow.
    const lights: THREE.DirectionalLight[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) lights.push(o);
    });
    expect(lights).toHaveLength(3);
    expect(lights.every((l) => l.castShadow)).toBe(true);
  });

  it('a copy of a material (three.js copies neither its shader hook nor its defines) is set up too', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 25000);
    const sun = new SunLight(scene, camera, 'high');
    const a = new THREE.MeshPhysicalMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), a));
    sun.update(new THREE.Vector3());
    const c = a.clone();
    expect(c.defines!.USE_CSM).toBeUndefined();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), c));
    sun.update(new THREE.Vector3());
    expect(c.defines!.USE_CSM).toBe(1);
    expect(c.defines!.PHYSICAL).toBe('');
    const shader: Shader = { uniforms: {}, fragmentShader: '' };
    c.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.CSM_cascades).toBeDefined();
  });

  it('without cascades (software rendering) one shadow follows the boat', () => {
    const scene = new THREE.Scene();
    const sun = new SunLight(scene, new THREE.PerspectiveCamera(), 'low');
    sun.set(new THREE.Vector3(0, 1, 0), 2, new THREE.Color(0xffffff));
    sun.update(new THREE.Vector3(100, 0, 50));
    const lights: THREE.DirectionalLight[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) lights.push(o);
    });
    expect(lights).toHaveLength(1);
    expect(lights[0]!.target.position.x).toBe(100);
  });
});
