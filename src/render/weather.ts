import * as THREE from 'three';

/**
 * Visual weather: a procedural cloud layer on a dome around the camera, and rain streaks. Driven by the
 * environment's sky state (src/sim/env/sky.ts) and the sun; never read by the physics.
 */

const cloudVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const cloudFragment = /* glsl */ `
uniform float uCover;
uniform float uLow;
uniform float uDay;
uniform vec2 uDrift;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogMix;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  if (d.y <= 0.0) discard;
  // Project onto a flat cloud layer: clouds shrink and crowd towards the horizon.
  vec2 uv = d.xz / (d.y + 0.08) * 0.8 + uDrift;
  float n = fbm(uv);
  // Cover 0 = clear, 1 = overcast: the threshold moves through the noise, and near 1 the layer closes.
  float c = smoothstep(1.02 - uCover, 1.22 - uCover, n + 0.25 * uCover);
  c = max(c, smoothstep(0.82, 1.0, uCover));
  float horizon = smoothstep(0.0, 0.15, d.y);
  float alpha = c * mix(0.55 + 0.45 * uCover, 1.0, horizon);
  float toSun = max(dot(d, normalize(uSunDir)), 0.0);
  vec3 lit = vec3(0.97, 0.97, 0.98) * (0.75 + 0.25 * toSun);
  vec3 grey = mix(vec3(0.62, 0.65, 0.69), vec3(0.42, 0.45, 0.49), uLow);
  vec3 col = mix(lit, grey, clamp(uCover * 0.85 + uLow * 0.3, 0.0, 1.0) * (0.55 + 0.45 * n));
  col *= mix(0.015, 1.0, uDay);
  // In mist and fog the sky is the fog: blend to its colour and close the gaps.
  col = mix(col, uFogColor, uFogMix);
  alpha = max(alpha, uFogMix);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

export class CloudDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private drift = new THREE.Vector2();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uCover: { value: 0.3 },
        uLow: { value: 0.1 },
        uDay: { value: 1 },
        uDrift: { value: this.drift },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFogColor: { value: new THREE.Color() },
        uFogMix: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.mesh.name = 'clouds';
  }

  /** `fogMix` 0 … 1: how far the sky is lost in mist or fog (blends the dome to `fogColor`). */
  set(cover: number, low: number, day: number, sunDir: THREE.Vector3, fogColor: THREE.Color, fogMix: number): void {
    const u = this.material.uniforms;
    u.uCover!.value = cover;
    u.uLow!.value = low;
    u.uDay!.value = day;
    (u.uSunDir!.value as THREE.Vector3).copy(sunDir);
    (u.uFogColor!.value as THREE.Color).copy(fogColor);
    u.uFogMix!.value = fogMix;
    this.mesh.visible = cover > 0.02 || fogMix > 0;
  }

  /** Follow the camera; drift with the wind (Three.js xz direction the air moves to, m/s). */
  update(camera: THREE.Camera, dt: number, windToX: number, windToZ: number): void {
    this.mesh.position.copy(camera.position);
    // Clouds move with the wind aloft, roughly twice the surface wind (E), on a layer ~1 km up.
    this.drift.x += (windToX * 2 * dt) / 1000;
    this.drift.y += (windToZ * 2 * dt) / 1000;
  }
}

const MAX_STREAKS = 9000;
const BOX = { half: 30, below: 8, above: 22 };

/** Rain: short falling streaks in a box around the camera, as many as the rain rate calls for. */
export class Rain {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private count = 0;
  private seed = 1;

  constructor() {
    this.pos = new Float32Array(MAX_STREAKS * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xe2e9ef, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    this.lines.name = 'rain';
    for (let i = 0; i < MAX_STREAKS; i++) this.place(i, 0, 0, 0, true);
  }

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return this.seed / 4294967296;
  }

  private place(i: number, cx: number, cy: number, cz: number, anyHeight: boolean): void {
    const o = i * 6;
    this.pos[o] = cx + (this.rnd() * 2 - 1) * BOX.half;
    this.pos[o + 1] = cy + (anyHeight ? -BOX.below + this.rnd() * (BOX.below + BOX.above) : BOX.above);
    this.pos[o + 2] = cz + (this.rnd() * 2 - 1) * BOX.half;
  }

  /** Rain rate in mm/h: streak count rises with it (visual scale, E). */
  setRate(mmPerH: number): void {
    this.count = mmPerH < 0.05 ? 0 : Math.min(MAX_STREAKS, Math.round(900 + 800 * mmPerH));
    this.lines.visible = this.count > 0;
    this.geo.setDrawRange(0, this.count * 2);
  }

  update(camera: THREE.Camera, dt: number, windToX: number, windToZ: number): void {
    if (!this.count) return;
    const c = camera.position;
    const fall = 6.5; // m/s, a typical raindrop (E)
    const len = 0.07; // streak length in seconds of travel (motion blur of a falling drop)
    const step = Math.min(dt, 0.1);
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      let x = this.pos[o]! + windToX * step;
      let y = this.pos[o + 1]! - fall * step;
      let z = this.pos[o + 2]! + windToZ * step;
      const left = Math.abs(x - c.x) > BOX.half || Math.abs(z - c.z) > BOX.half;
      if (left || y < c.y - BOX.below) {
        // A drop that fell through starts again at the top; one the camera left behind is re-seeded at any height.
        this.place(i, c.x, c.y, c.z, left);
        x = this.pos[o]!;
        y = this.pos[o + 1]!;
        z = this.pos[o + 2]!;
      }
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x - windToX * len;
      this.pos[o + 4] = y + fall * len;
      this.pos[o + 5] = z - windToZ * len;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
