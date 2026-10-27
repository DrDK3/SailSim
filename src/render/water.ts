import * as THREE from 'three';
import { WATER_MASK_ORDER } from './squibModel';

/**
 * The sea surface, driven by the modelled sea state (src/sim/env/seaState.ts): significant height, peak
 * wavelength, whitecap cover and steepness are sampled on a 32 × 32 field (50 m cells) round the camera and
 * read by the shaders, so the waves change from place to place - short, steep and breaking where the stream
 * runs against them (wind over tide), small in a lee. Eight Gerstner wave trains span 0.45 … 1.7 times the
 * reference wavelength; each place weights them by how near they are to its own peak wavelength (a
 * log-normal spectrum) and scales them to its own height, which shifts the energy to shorter waves without
 * the phase breaks a stretched wave would show. Normals are evaluated per pixel; foam forms where crests are
 * compressed, in proportion to the whitecap cover. Visual only: the physics reads the sea state itself.
 */
const N_COMP = 8;
const FIELD_N = 32;
const FIELD_CELL = 50;
/** How far onto the bank (m, beyond the tidal water outline) the water may be drawn: high water springs, E. */
const MASK_MARGIN_M = 24;
const FACTORS = [0.45, 0.58, 0.72, 0.86, 1.0, 1.17, 1.38, 1.7];
const SPREAD = [-0.55, 0.32, -0.18, 0.08, -0.04, 0.22, -0.36, 0.5];
const SPECTRUM_WIDTH = 0.32;
const G = 9.81;

const common = /* glsl */ `
uniform float uTime;
uniform vec4 uComp[${N_COMP}];   // (dirX, dirZ, wavelength, phase seed)
uniform vec2 uCurrent;           // stream (Three.js xz, m/s): advects the waves
uniform sampler2D uField;        // (Hs, peak wavelength, whitecaps, steepness)
uniform vec2 uFieldOrigin;       // xz of texel (0, 0)'s centre
uniform float uFieldCell;
const float FIELD_N = ${FIELD_N}.0;

vec4 seaField(vec2 xz) {
  vec2 uv = (xz - uFieldOrigin) / (uFieldCell * FIELD_N) + 0.5 / FIELD_N;
  return texture2D(uField, uv);
}

// Amplitude of each component here: log-normal weights about the local peak, scaled to the local Hs.
void amplitudes(vec4 f, out float amp[${N_COMP}]) {
  float lp = max(f.g, 0.3);
  float wsum = 0.0;
  float w[${N_COMP}];
  for (int i = 0; i < ${N_COMP}; i++) {
    float r = log(uComp[i].z / lp);
    w[i] = exp(-r * r / (2.0 * ${SPECTRUM_WIDTH} * ${SPECTRUM_WIDTH}));
    wsum += w[i];
  }
  // Hs = 4 sqrt(m0), m0 = sum a^2 / 2.
  for (int i = 0; i < ${N_COMP}; i++) amp[i] = f.r * 0.25 * sqrt(2.0 * w[i] / max(wsum, 1e-4));
}

float crestQ(vec4 f) { return mix(0.25, 0.9, smoothstep(0.02, 0.09, f.a)); }

float phaseOf(int i, vec2 xz) {
  vec2 d = uComp[i].xy;
  float k = 6.2831853 / uComp[i].z;
  float omega = sqrt(9.81 * k) + k * dot(d, uCurrent);
  return k * dot(d, xz) - omega * uTime + uComp[i].w;
}
`;

const vertex = /* glsl */ `
${common}
varying vec3 vWorld;
varying vec2 vPlanar;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 xz = world.xz;
  vec4 f = seaField(xz);
  float amp[${N_COMP}];
  amplitudes(f, amp);
  float q = crestQ(f);
  vec3 p = world.xyz;
  for (int i = 0; i < ${N_COMP}; i++) {
    float ph = phaseOf(i, xz);
    float k = 6.2831853 / uComp[i].z;
    float qi = q / (k * max(amp[i], 1e-4) * ${N_COMP}.0);
    qi = min(qi, 1.0);
    p.xz += qi * amp[i] * uComp[i].xy * cos(ph);
    p.y += amp[i] * sin(ph);
  }
  vWorld = p;
  vPlanar = xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
${common}
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRipple;
uniform float uGlint;
uniform float uLight;
uniform vec4 uPuffs[16];     // (x, z, radius, strength) in world metres; strength 0 = unused
uniform sampler2D uMask;     // signed distance to tidal water (m) = (v·255 - 128) / 2, > 0 in the water
uniform vec4 uMaskBox;       // e0, n0, width, height (m); width 0 = no mask
varying vec3 vWorld;
varying vec2 vPlanar;

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
  // Only tidal water and its banks: low ground inland (below the tide but not connected) stays dry.
  if (uMaskBox.z > 0.0) {
    vec2 muv = (vec2(vWorld.x, -vWorld.z) - uMaskBox.xy) / uMaskBox.zw;
    if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0 && (texture2D(uMask, muv).r * 255.0 - 128.0) * 0.5 < -${MASK_MARGIN_M.toFixed(1)}) discard;
  }
  float dist = length(cameraPosition - vWorld);
  vec4 f = seaField(vPlanar);
  float amp[${N_COMP}];
  amplitudes(f, amp);
  float q = crestQ(f);
  // Gerstner normal and crest compression (Jacobian) at this pixel; short trains fade out with distance
  // before they alias.
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jac = 1.0;
  float h = 0.0;
  for (int i = 0; i < ${N_COMP}; i++) {
    float lambda = uComp[i].z;
    float fade = 1.0 - smoothstep(lambda * 60.0, lambda * 160.0, dist);
    float ph = phaseOf(i, vPlanar);
    float k = 6.2831853 / lambda;
    float wa = k * amp[i] * fade;
    float qi = min(q / (k * max(amp[i], 1e-4) * ${N_COMP}.0), 1.0);
    float c = cos(ph);
    float s = sin(ph);
    n.x -= uComp[i].x * wa * c;
    n.z -= uComp[i].y * wa * c;
    n.y -= qi * wa * s;
    jac -= qi * wa * s * ${N_COMP}.0 * 0.5;
    h += amp[i] * s;
  }
  n = normalize(n);
  // Puffs: darker, rougher water ("cat's paws"), as sailors read gusts on the surface.
  float puff = 0.0;
  for (int i = 0; i < 16; i++) {
    vec4 p = uPuffs[i];
    if (p.w <= 0.0) continue;
    vec2 d = vWorld.xz - p.xy;
    puff += p.w * exp(-dot(d, d) / (2.0 * p.z * p.z));
  }
  puff = clamp(puff * 2.5, 0.0, 1.0);
  float steep = smoothstep(0.02, 0.08, f.a);
  vec2 g = rippleGrad(vWorld.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2)) * 0.6
         + rippleGrad(vWorld.xz * 2.7 - vec2(uTime * 0.6, -uTime * 0.25)) * 0.3
         + rippleGrad(vWorld.xz * 6.0 - vec2(uTime * 1.2, uTime * 0.7)) * 0.35 * max(puff, steep);
  float near = exp(-dist / 450.0);
  n = normalize(n + vec3(-g.x, 0.0, -g.y) * uRipple * (1.0 + 0.8 * puff + 0.6 * steep) * near);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
  vec3 refl = reflect(-viewDir, n);
  vec3 skyCol = mix(uHorizon, uSky, clamp(refl.y * 2.0, 0.0, 1.0));
  float facing = max(dot(n, viewDir), 0.0);
  vec3 body = mix(uDeep, uShallow, pow(1.0 - facing, 2.0) * 0.5) * uLight;
  // Light through the thin crest of a steep wave.
  body += uShallow * uLight * 0.6 * smoothstep(0.2, 0.9, h / max(f.r * 0.5, 0.02)) * steep;
  // In a puff the surface is rougher, so it reflects less sky and reads darker; the edge of a puff is darker
  // still, as sailors see a gust line coming (strengths chosen for the eye, E).
  float edge = smoothstep(0.15, 0.45, puff) * (1.0 - smoothstep(0.55, 0.9, puff));
  vec3 col = mix(body, skyCol, fres * (1.0 - 0.6 * puff));
  col *= 1.0 - 0.3 * puff - 0.08 * edge;
  vec3 hv = normalize(uSunDir + viewDir);
  col += vec3(1.0, 0.96, 0.85) * pow(max(dot(n, hv), 0.0), 220.0) * 1.6 * (0.25 + 0.75 * near) * uGlint;
  // Whitecaps: foam on compressed crests, as much as the modelled cover, broken up and streaked downwind.
  // A few per cent cover already reads as a sea of white horses, so the cover is scaled up for the eye.
  float cover = clamp(f.b * 20.0, 0.0, 1.0);
  float crest = smoothstep(0.85, 0.15, jac) * smoothstep(0.0, 0.5, h / max(f.r * 0.5, 0.02));
  float breakup = noise(vWorld.xz * 0.35 + uComp[4].xy * uTime * 0.6) * 0.6 + noise(vWorld.xz * 1.7) * 0.4;
  float streaks = noise(vec2(dot(vWorld.xz, uComp[4].xy) * 0.08, dot(vWorld.xz, vec2(-uComp[4].y, uComp[4].x)) * 1.2));
  float foam = clamp(crest * cover * 2.5 * smoothstep(0.3, 0.7, breakup) + cover * 0.25 * smoothstep(0.62, 0.9, streaks) * steep, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.95, 0.96) * (0.35 + 0.65 * uLight), foam * (0.3 + 0.7 * near));
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}
`;

/** After the opaque scene and the boats' water masks (WATER_MASK_ORDER), so the stencil is set when it is drawn. */
const WATER_ORDER = WATER_MASK_ORDER + 1;

/** The sea state at a point, as the renderer needs it (dirTo: compass rad the waves travel towards). */
export interface SeaSample {
  hs: number;
  wavelength: number;
  dirTo: number;
  whitecaps: number;
  steepness: number;
}

/** Concentric rings, dense near the centre (0.4 m) and sparse at the edge: the camera sits at the centre. */
function polarGrid(rings: number, segments: number, r0: number, r1: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let j = 0; j < rings; j++) {
    const r = r0 * Math.pow(r1 / r0, j / (rings - 1));
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < segments; i++) idx.push(0, 1 + ((i + 1) % segments), 1 + i);
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = 1 + j * segments + i;
      const b = 1 + j * segments + ((i + 1) % segments);
      idx.push(a, b, a + segments, b, b + segments, a + segments);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

export class Water {
  readonly mesh: THREE.Mesh;
  /** Flat, very large plane beyond the detailed mesh (same shader), so the horizon is water, not seabed. */
  readonly farMesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly fieldData = new Float32Array(FIELD_N * FIELD_N * 4);
  private readonly fieldTex: THREE.DataTexture;
  private fieldOrigin = new THREE.Vector2(NaN, NaN);
  /** A field being filled over several frames (origin, data, next texel). */
  private pending?: { origin: THREE.Vector2; data: Float32Array; next: number };
  private lastRefresh = -Infinity;
  private refL = 0;
  private refDir = NaN;

  constructor(sunDir: THREE.Vector3, fogColor: THREE.Color, fogDensity: number) {
    this.fieldTex = new THREE.DataTexture(this.fieldData, FIELD_N, FIELD_N, THREE.RGBAFormat, THREE.FloatType);
    this.fieldTex.magFilter = THREE.LinearFilter;
    this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.wrapS = this.fieldTex.wrapT = THREE.ClampToEdgeWrapping;
    this.fieldTex.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uComp: { value: Array.from({ length: N_COMP }, () => new THREE.Vector4(1, 0, 6, 0)) },
        uCurrent: { value: new THREE.Vector2() },
        uField: { value: this.fieldTex },
        uFieldOrigin: { value: new THREE.Vector2() },
        uFieldCell: { value: FIELD_CELL },
        uSunDir: { value: sunDir.clone().normalize() },
        uDeep: { value: new THREE.Color(0x0b2f3d) },
        uShallow: { value: new THREE.Color(0x1d5a63) },
        uSky: { value: new THREE.Color(0x6a9ccf) },
        uHorizon: { value: new THREE.Color(0xc9dbe6) },
        uFogColor: { value: fogColor.clone() },
        uFogDensity: { value: fogDensity },
        uRipple: { value: 0.35 },
        uGlint: { value: 1 },
        uLight: { value: 1 },
        uPuffs: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 1, 0)) },
        uMask: { value: null },
        uMaskBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      },
      // Not drawn where a boat's deck mask marked the stencil (inside the hulls: squibModel.ts).
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.mesh = new THREE.Mesh(polarGrid(170, 200, 0.4, 1800), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = WATER_ORDER;
    this.mesh.name = 'water';
    const far = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    far.rotateX(-Math.PI / 2);
    this.farMesh = new THREE.Mesh(far, this.material);
    this.farMesh.position.y = -0.25;
    this.farMesh.frustumCulled = false;
    this.farMesh.renderOrder = WATER_ORDER;
    this.farMesh.name = 'water-far';
    this.setWind(5, 0);
  }

  /** Draw the water only near tidal water (the River Dart's mask), or everywhere (undefined). */
  setMask(mask: { texture: THREE.Texture; box: THREE.Vector4 } | undefined): void {
    const u = this.material.uniforms;
    u.uMask!.value = mask?.texture ?? null;
    (u.uMaskBox!.value as THREE.Vector4).copy(mask?.box ?? new THREE.Vector4(0, 0, 0, 0));
  }

  setFog(density: number): void {
    this.material.uniforms.uFogDensity!.value = density;
  }

  /**
   * The sky the water reflects and the light on it: sun direction, fog, cloud cover (greys the reflected sky),
   * daylight (0 night … 1 day) and the strength of the sun's glint (0 when the sun is hidden).
   */
  setSky(o: { sunDir: THREE.Vector3; fogColor: THREE.Color; fogDensity: number; cloud: number; day: number; glint: number }): void {
    const u = this.material.uniforms;
    (u.uSunDir!.value as THREE.Vector3).copy(o.sunDir).normalize();
    (u.uFogColor!.value as THREE.Color).copy(o.fogColor);
    u.uFogDensity!.value = o.fogDensity;
    // Colours are linear here; the output's sRGB encoding lifts dark values, so night needs a low floor.
    const light = 0.012 + 0.988 * o.day * o.day;
    (u.uSky!.value as THREE.Color).setHex(0x6a9ccf).lerp(new THREE.Color(0x6f777c), o.cloud).multiplyScalar(light);
    (u.uHorizon!.value as THREE.Color).setHex(0xc9dbe6).lerp(new THREE.Color(0x8e979c), o.cloud).multiplyScalar(light);
    u.uGlint!.value = o.glint;
    u.uLight!.value = light * (1 - 0.3 * o.cloud);
  }

  /** Up to 16 puffs as (x, z, radius, strength) in Three.js world coordinates. */
  setPuffs(puffs: { x: number; z: number; radius: number; strength: number }[]): void {
    const u = this.material.uniforms.uPuffs!.value as THREE.Vector4[];
    for (let i = 0; i < u.length; i++) {
      const p = puffs[i];
      if (p) u[i]!.set(p.x, p.z, p.radius, p.strength);
      else u[i]!.w = 0;
    }
  }

  /**
   * Fine ripples follow the wind; without a sea state (no sampler) this also sets a plausible uniform sea
   * from the wind alone (TWS m/s, FROM direction twd, compass radians).
   */
  setWind(twsMs: number, twdFrom: number): void {
    const s = Math.min(1, twsMs / 10);
    this.material.uniforms.uRipple!.value = 0.15 + 0.5 * s;
    if (Number.isNaN(this.fieldOrigin.x)) {
      const hs = 0.04 + 0.3 * s * s;
      const l = 3 + 10 * s;
      this.fieldData.fill(0);
      for (let i = 0; i < FIELD_N * FIELD_N; i++) this.fieldData.set([hs, l, 0.01 * s, hs / l], i * 4);
      this.fieldTex.needsUpdate = true;
      this.setComponents(l, twdFrom + Math.PI);
    }
  }

  /** The wave trains: directions spread about the mean, wavelengths about the reference. */
  private setComponents(refL: number, dirTo: number): void {
    this.refL = refL;
    this.refDir = dirTo;
    const comps = this.material.uniforms.uComp!.value as THREE.Vector4[];
    comps.forEach((c, i) => {
      const a = dirTo + SPREAD[i]!;
      c.set(Math.sin(a), -Math.cos(a), Math.max(0.5, refL * FACTORS[i]!), (i * 2.399) % (2 * Math.PI));
    });
  }

  /**
   * Keep the sea-state field round the camera up to date from `sample` (n, e → sea state at the current sim
   * time). The first fill is immediate; after that, when the camera has moved or every few seconds, a new
   * field is filled a few texels per frame and swapped in whole. `boat` sets the reference wavelength and
   * direction from the sea where the user is sailing; `current` advects the waves (m/s, n/e).
   */
  updateField(sample: (n: number, e: number) => SeaSample, camX: number, camZ: number, now: number, boat: SeaSample, current: { n: number; e: number }): void {
    const ox = Math.round(camX / FIELD_CELL) * FIELD_CELL - (FIELD_N / 2) * FIELD_CELL;
    const oz = Math.round(camZ / FIELD_CELL) * FIELD_CELL - (FIELD_N / 2) * FIELD_CELL;
    (this.material.uniforms.uCurrent!.value as THREE.Vector2).set(current.e, -current.n);
    const lRef = Math.max(0.6, boat.wavelength || 1);
    const dd = Math.abs(Math.atan2(Math.sin(boat.dirTo - this.refDir), Math.cos(boat.dirTo - this.refDir)));
    if (!(Math.abs(lRef / this.refL - 1) < 0.2) || !(dd < 0.2)) this.setComponents(lRef, boat.dirTo);
    const fill = (origin: THREE.Vector2, data: Float32Array, from: number, to: number) => {
      for (let k = from; k < to; k++) {
        const i = k % FIELD_N;
        const j = Math.floor(k / FIELD_N);
        const x = origin.x + i * FIELD_CELL;
        const z = origin.y + j * FIELD_CELL;
        const s = sample(-z, x);
        data[k * 4] = s.hs;
        data[k * 4 + 1] = s.wavelength;
        data[k * 4 + 2] = s.whitecaps;
        data[k * 4 + 3] = s.steepness;
      }
    };
    const total = FIELD_N * FIELD_N;
    if (Number.isNaN(this.fieldOrigin.x)) {
      this.fieldOrigin.set(ox, oz);
      fill(this.fieldOrigin, this.fieldData, 0, total);
      this.swapIn();
      this.lastRefresh = now;
      return;
    }
    const moved = Math.abs(ox - this.fieldOrigin.x) > 6 * FIELD_CELL || Math.abs(oz - this.fieldOrigin.y) > 6 * FIELD_CELL;
    if (!this.pending && (moved || now - this.lastRefresh > 4)) {
      this.pending = { origin: new THREE.Vector2(ox, oz), data: new Float32Array(total * 4), next: 0 };
    }
    const p = this.pending;
    if (p) {
      const to = Math.min(total, p.next + 96);
      fill(p.origin, p.data, p.next, to);
      p.next = to;
      if (to >= total) {
        this.fieldData.set(p.data);
        this.fieldOrigin.copy(p.origin);
        this.pending = undefined;
        this.lastRefresh = now;
        this.swapIn();
      }
    }
  }

  private swapIn(): void {
    (this.material.uniforms.uFieldOrigin!.value as THREE.Vector2).copy(this.fieldOrigin);
    this.fieldTex.needsUpdate = true;
  }

  update(time: number, camera: THREE.Camera): void {
    this.material.uniforms.uTime!.value = time;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.farMesh.position.x = camera.position.x;
    this.farMesh.position.z = camera.position.z;
  }

  /** The field (bilinear, as the GPU samples it) at a world point. */
  private fieldAt(x: number, z: number): [number, number, number, number] {
    const o = Number.isNaN(this.fieldOrigin.x) ? new THREE.Vector2() : this.fieldOrigin;
    const fx = Math.min(FIELD_N - 1, Math.max(0, (x - o.x) / FIELD_CELL));
    const fz = Math.min(FIELD_N - 1, Math.max(0, (z - o.y) / FIELD_CELL));
    const i = Math.min(FIELD_N - 2, Math.floor(fx));
    const j = Math.min(FIELD_N - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const d = this.fieldData;
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const a = d[(j * FIELD_N + i) * 4 + c]!;
      const b = d[(j * FIELD_N + i + 1) * 4 + c]!;
      const e = d[((j + 1) * FIELD_N + i) * 4 + c]!;
      const f = d[((j + 1) * FIELD_N + i + 1) * 4 + c]!;
      out[c] = (a * (1 - tx) + b * tx) * (1 - tz) + (e * (1 - tx) + f * tx) * tz;
    }
    return out;
  }

  /** CPU copy of the shader's surface height at a world point (for floating objects and the boats' motion). */
  heightAt(x: number, z: number, time: number): number {
    const [hs, lp] = this.fieldAt(x, z);
    const comps = this.material.uniforms.uComp!.value as THREE.Vector4[];
    const cur = this.material.uniforms.uCurrent!.value as THREE.Vector2;
    const w = comps.map((c) => {
      const r = Math.log(c.z / Math.max(lp, 0.3));
      return Math.exp(-(r * r) / (2 * SPECTRUM_WIDTH * SPECTRUM_WIDTH));
    });
    const wsum = w.reduce((a, b) => a + b, 0);
    let h = 0;
    comps.forEach((c, i) => {
      const amp = hs * 0.25 * Math.sqrt((2 * w[i]!) / Math.max(wsum, 1e-4));
      const k = (2 * Math.PI) / c.z;
      const omega = Math.sqrt(G * k) + k * (c.x * cur.x + c.y * cur.y);
      h += amp * Math.sin(k * (c.x * x + c.y * z) - omega * time + c.w);
    });
    return h;
  }
}
