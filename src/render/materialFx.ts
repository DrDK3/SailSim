import * as THREE from 'three';

/**
 * Small shader additions to three.js's lit materials. Each keeps any hook the material already has and gives
 * the program its own cache key (sunlight.ts chains its shadow cascades onto these in the same way).
 */

type Hook = THREE.Material['onBeforeCompile'];

function chain(m: THREE.Material, key: string, add: Hook): void {
  const base = m.onBeforeCompile;
  const baseKey = m.customProgramCacheKey();
  m.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    base.call(this, shader, renderer);
    add.call(this, shader, renderer);
  };
  m.customProgramCacheKey = () => `${baseKey}|${key}`;
  m.needsUpdate = true;
}

/**
 * The sun's light for translucent cloth, set once a frame by the scene: its direction in view space and its
 * colour × intensity, already zero when the hills hide the sun from the boat. (The shadow map cannot be used:
 * a thin sail shadows its own far face, so light passing through would always read as shadowed.)
 */
export const SUN_THROUGH = { uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uSunLight: { value: new THREE.Color(0, 0, 0) } };

/**
 * Light through a thin, pale fabric: sunlight striking one face of a sail also shows on the other, as the glow
 * of a sail seen against the sun, darker where the cloth is doubled (seams and patches, from its map). `amount`
 * is the share of the light that passes (Dacron sailcloth: a quarter to a third, E).
 */
export function addTranslucency(m: THREE.MeshStandardMaterial, amount: number): void {
  const u = { uTranslucency: { value: amount } };
  chain(m, `translucent`, (shader) => {
    shader.uniforms.uTranslucency = u.uTranslucency;
    shader.uniforms.uSunDirView = SUN_THROUGH.uSunDirView;
    shader.uniforms.uSunLight = SUN_THROUGH.uSunLight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTranslucency;\nuniform vec3 uSunDirView;\nuniform vec3 uSunLight;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
// The sun on the far face shows through (the normal faces the viewer on either side of a double-sided sail).
reflectedLight.directDiffuse += uSunLight * saturate( - dot( normal, uSunDirView ) ) * uTranslucency * BRDF_Lambert( material.diffuseColor );`,
      );
  });
}

/**
 * A wet band at the waterline: the gelcoat just above the water (in the model's frame, y = 0 at the waterline)
 * darker and glossier, as spray and the bow wave keep it wet. `height` (m) is how far up it reaches.
 */
export function addWetBand(m: THREE.MeshStandardMaterial, height = 0.14): void {
  chain(m, `wet${height}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vModelY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vModelY;')
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
float wetBand = 1.0 - smoothstep(${(height * 0.4).toFixed(3)}, ${height.toFixed(3)}, vModelY);
diffuseColor.rgb *= 1.0 - 0.16 * wetBand;
roughnessFactor = mix(roughnessFactor, 0.08, wetBand);`,
      );
  });
}
