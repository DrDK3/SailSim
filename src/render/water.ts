import * as THREE from 'three';

/**
 * Procedural open water: a sum of directional waves (displacement + analytic normals) plus fine
 * procedural ripples, fresnel sky reflection and sun glint. Visual only: the physics uses flat water in
 * Phase 1. The mesh follows the camera in grid-snapped steps; the pattern is in world coordinates.
 */
const vertex = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[4];      // (dirX, dirZ, wavelength, amplitude)
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 p = world.xyz;
  float h = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = normalize(uWaves[i].xy);
    float k = 6.2831853 / uWaves[i].z;
    float c = sqrt(9.81 / k);
    float ph = k * (dot(d, p.xz) - c * uTime);
    h += uWaves[i].w * sin(ph);
    grad += uWaves[i].w * k * cos(ph) * d;
  }
  p.y += h;
  vWorld = p;
  vNormalW = normalize(vec3(-grad.x, 1.0, -grad.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRipple;
varying vec3 vWorld;
varying vec3 vNormalW;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 rippleGrad(vec2 p) {
  float e = 0.05;
  float n0 = noise(p);
  return vec2(noise(p + vec2(e, 0.0)) - n0, noise(p + vec2(0.0, e)) - n0) / e;
}

void main() {
  vec3 n = vNormalW;
  vec2 g = rippleGrad(vWorld.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2)) * 0.6
         + rippleGrad(vWorld.xz * 2.7 - vec2(uTime * 0.6, -uTime * 0.25)) * 0.3;
  n = normalize(n + vec3(-g.x, 0.0, -g.y) * uRipple);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
  vec3 refl = reflect(-viewDir, n);
  vec3 skyCol = mix(uHorizon, uSky, clamp(refl.y * 2.0, 0.0, 1.0));
  float facing = max(dot(n, viewDir), 0.0);
  vec3 body = mix(uDeep, uShallow, pow(1.0 - facing, 2.0) * 0.5);
  vec3 col = mix(body, skyCol, fres);
  vec3 h = normalize(uSunDir + viewDir);
  col += vec3(1.0, 0.96, 0.85) * pow(max(dot(n, h), 0.0), 220.0) * 1.6;
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}
`;

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly cell = 20;

  constructor(sunDir: THREE.Vector3, fogColor: THREE.Color, fogDensity: number) {
    const geo = new THREE.PlaneGeometry(2400, 2400, 240, 240);
    geo.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uWaves: { value: [new THREE.Vector4(1, 0, 9, 0.05), new THREE.Vector4(1, 0, 5, 0.03), new THREE.Vector4(1, 0, 3, 0.02), new THREE.Vector4(1, 0, 14, 0.04)] },
        uSunDir: { value: sunDir.clone().normalize() },
        uDeep: { value: new THREE.Color(0x0b2f3d) },
        uShallow: { value: new THREE.Color(0x1d5a63) },
        uSky: { value: new THREE.Color(0x6a9ccf) },
        uHorizon: { value: new THREE.Color(0xc9dbe6) },
        uFogColor: { value: fogColor.clone() },
        uFogDensity: { value: fogDensity },
        uRipple: { value: 0.35 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
  }

  /** Waves scale with wind speed and travel downwind (wind FROM direction twd, compass radians). */
  setWind(twsMs: number, twdFrom: number): void {
    // Direction the waves travel, in Three.js xz (x = east, z = south).
    const to = twdFrom + Math.PI;
    const base = new THREE.Vector2(Math.sin(to), -Math.cos(to));
    const s = Math.min(1, twsMs / 10);
    const amp = 0.02 + 0.13 * s * s;
    const waves = this.material.uniforms.uWaves!.value as THREE.Vector4[];
    const spread = [0, 0.35, -0.5, 0.2];
    const lengths = [4 + 10 * s, 3 + 5 * s, 2 + 2.5 * s, 7 + 14 * s];
    const amps = [amp, amp * 0.55, amp * 0.3, amp * 0.6];
    waves.forEach((w, i) => {
      const d = base.clone().rotateAround(new THREE.Vector2(), spread[i]!);
      w.set(d.x, d.y, lengths[i]!, amps[i]!);
    });
    this.material.uniforms.uRipple!.value = 0.15 + 0.5 * s;
  }

  update(time: number, camera: THREE.Camera): void {
    this.material.uniforms.uTime!.value = time;
    this.mesh.position.set(Math.round(camera.position.x / this.cell) * this.cell, 0, Math.round(camera.position.z / this.cell) * this.cell);
  }

  /** CPU copy of the vertex-shader surface height at a world point (for floating objects). */
  heightAt(x: number, z: number, time: number): number {
    const waves = this.material.uniforms.uWaves!.value as THREE.Vector4[];
    let h = 0;
    for (const w of waves) {
      const len = Math.hypot(w.x, w.y);
      const k = (2 * Math.PI) / w.z;
      const c = Math.sqrt(9.81 / k);
      h += w.w * Math.sin(k * ((w.x / len) * x + (w.y / len) * z - c * time));
    }
    return h;
  }
}
