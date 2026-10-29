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
/** Directions of the trains about the mean (rad): a wide spread keeps the crests short, as a wind sea's are. */
const SPREAD = [-0.85, 0.5, -0.3, 0.12, -0.06, 0.35, -0.6, 0.8];
const SPECTRUM_WIDTH = 0.32;
/** The bed texture's range (m ODN): deeper reads as deep, higher as dry land. */
const BED_MIN = -12;
const BED_MAX = 12;
/** Wind-ripple trains drawn per pixel: all of them with detailed water, the first few (coarser) with simple. */
const N_RIP = 13;
const G = 9.81;

/** The sea's wave trains and sea-state field (GLSL), shared with everything that lies on the surface (foam). */
export const SEA_COMMON = /* glsl */ `
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
const common = SEA_COMMON;

/** The surface at a world point: the Gerstner displacement the sea's vertices get (needs SEA_COMMON). */
export const SEA_DISPLACE = /* glsl */ `
vec3 seaDisplace(vec3 world) {
  vec2 xz = world.xz;
  vec4 f = seaField(xz);
  float amp[${N_COMP}];
  amplitudes(f, amp);
  float q = crestQ(f);
  vec3 p = world;
  for (int i = 0; i < ${N_COMP}; i++) {
    float ph = phaseOf(i, xz);
    float k = 6.2831853 / uComp[i].z;
    float qi = min(q / (k * max(amp[i], 1e-4) * ${N_COMP}.0), 1.0);
    p.xz += qi * amp[i] * uComp[i].xy * cos(ph);
    p.y += amp[i] * sin(ph);
  }
  return p;
}
`;

const vertex = /* glsl */ `
${common}
${SEA_DISPLACE}
varying vec3 vWorld;
varying vec2 vPlanar;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // The far plane (its corners 20 km out) stays flat: displaced only there, it would tilt and cut up through
  // the near sea's troughs, flattening them and hiding the wake that lies in them.
  vec3 p = dot(position.xz, position.xz) > 2.5e7 ? world.xyz : seaDisplace(world.xyz);
  vWorld = p;
  vPlanar = world.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
${common}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uShallowBank;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uRipple;
uniform float uGlint;
uniform float uLight;
uniform float uCloud;
uniform vec2 uWindTo;        // unit xz direction the wind blows towards (the ripples run with it)
uniform vec4 uPuffs[16];     // (x, z, radius, strength) in world metres; strength 0 = unused
uniform sampler2D uMask;     // signed distance to tidal water (m) = (v·255 - 128) / 2, > 0 in the water
uniform vec4 uMaskBox;       // e0, n0, width, height (m); width 0 = no mask
uniform sampler2D uBed;      // bed and ground elevation, 8 m grid (0 … 1 over ±12 m ODN): LIDAR near the shore, provisional mid-channel
uniform vec4 uBedBox;        // e0, n0, width, height (m); width 0 = no bed
uniform float uWaterLevel;   // the tide (m ODN)
uniform vec3 uBedColour;
#ifdef SKY_ENV
uniform sampler2D envMap;    // the sky's light (PMREM of the sky without the sun's disc)
#include <cube_uv_reflection_fragment>
#endif
varying vec3 vWorld;
varying vec2 vPlanar;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// How far one pixel reaches along a train's direction (m): a train aliases only when its crests pass faster than
// the pixels across them, so at a glancing view the trains running across the line of sight keep their detail
// while those running along it fade (anisotropic, as texture filtering is). dx, dy: the pixel's steps on the water.
float reach(vec2 dir, vec2 dx, vec2 dy) { return max(abs(dot(dir, dx)) + abs(dot(dir, dy)), 1e-4); }

// Wind ripples: short wave trains (0.12 … 3 m) spread about the wind, each with its slope; a train finer than
// the pixel can show fades out and its slope variance goes into the roughness instead (no shimmer, no tiling).
// Each train's constants come from the CPU (setRipples): (dirX, dirZ, wavelength, slope factor), (k, omega, phase).
const int NR = ${N_RIP};
uniform vec4 uRipA[${N_RIP}];
uniform vec4 uRipB[${N_RIP}];
uniform float uRipCount;
vec2 ripples(vec2 xz, vec2 dx, vec2 dy, float strength, out float lostVar) {
  vec2 g = vec2(0.0);
  lostVar = 0.0;
  for (int i = 0; i < NR; i++) {
    if (float(i) >= uRipCount) break;
    vec4 a = uRipA[i];
    float slope = strength * a.w;
    float vis = 1.0 - smoothstep(a.z * 0.2, a.z * 0.7, reach(a.xy, dx, dy));
    lostVar += 0.5 * slope * slope * (1.0 - vis);
    // A train finer than the pixel costs nothing more.
    if (vis <= 0.0) continue;
    vec4 b = uRipB[i];
    float ph = b.x * dot(a.xy, xz) - b.y * uTime + b.z;
    g += a.xy * slope * cos(ph) * vis;
  }
  return g;
}

vec3 skyLight(vec3 r, float rough) {
  // A ray reflected downwards off a steep facet meets another wave and then the sky: fold it up.
  r.y = abs(r.y);
  vec3 grad = mix(uHorizon, uSky, clamp(r.y * 2.0, 0.0, 1.0));
#ifdef SKY_ENV
  vec3 env = textureCubeUV(envMap, normalize(vec3(r.x, max(r.y, 0.015), r.z)), max(rough, 0.12)).rgb;
  #ifdef TONE_MAPPING
  env = toneMapping(env);
  #endif
  // The sky's own colours (golden at sunset, pale at the horizon) tempered by the water's usual sky tones, so
  // the ripples' tilt does not flash between white and blue; under cloud (drawn by its own dome, not in the
  // sky's map) the grey sky takes over.
  return mix(mix(grad, env, 0.65), grad, clamp(uCloud * 1.1, 0.0, 1.0));
#else
  return grad;
#endif
}

void main() {
  // Only tidal water and its banks: low ground inland (below the tide but not connected) stays dry.
  // Distance into the water from its edge (m); far out at sea, off the mask.
  float inWater = 60.0;
  if (uMaskBox.z > 0.0) {
    vec2 muv = (vec2(vWorld.x, -vWorld.z) - uMaskBox.xy) / uMaskBox.zw;
    if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) {
      inWater = (texture2D(uMask, muv).r * 255.0 - 128.0) * 0.5;
      if (inWater < -${MASK_MARGIN_M.toFixed(1)}) discard;
    }
  }
  // Depth here (m) from the bed grid and the tide; far out of the grid, deep.
  float depthHere = 1e4;
  bool onBed = false;
  if (uBedBox.z > 0.0) {
    vec2 buv = (vec2(vPlanar.x, -vPlanar.y) - uBedBox.xy) / uBedBox.zw;
    if (buv.x > 0.0 && buv.y > 0.0 && buv.x < 1.0 && buv.y < 1.0) {
      depthHere = uWaterLevel - (${BED_MIN.toFixed(1)} + texture2D(uBed, buv).r * ${(BED_MAX - BED_MIN).toFixed(1)});
      onBed = true;
    }
  }
  float dist = length(cameraPosition - vWorld);
  // The pixel's steps across the water (m): the finest detail it can show, in each direction.
  vec2 pdx = dFdx(vPlanar);
  vec2 pdy = dFdy(vPlanar);
  vec4 f = seaField(vPlanar);
  float amp[${N_COMP}];
  amplitudes(f, amp);
  float q = crestQ(f);
  // Gerstner normal and crest compression (Jacobian) at this pixel; a train finer than the pixel fades out and
  // adds to the roughness.
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jac = 1.0;
  float h = 0.0;
  float lostVar = 0.0;
  for (int i = 0; i < ${N_COMP}; i++) {
    float lambda = uComp[i].z;
    float fade = 1.0 - smoothstep(lambda * 0.15, lambda * 0.5, reach(uComp[i].xy, pdx, pdy));
    float ph = phaseOf(i, vPlanar);
    float k = 6.2831853 / lambda;
    float wa = k * amp[i];
    float qi = min(q / (k * max(amp[i], 1e-4) * ${N_COMP}.0), 1.0);
    float c = cos(ph);
    float s = sin(ph);
    n.x -= uComp[i].x * wa * c * fade;
    n.z -= uComp[i].y * wa * c * fade;
    n.y -= qi * wa * s * fade;
    jac -= qi * wa * s * ${N_COMP}.0 * 0.5 * fade;
    h += amp[i] * s;
    lostVar += 0.5 * wa * wa * (1.0 - fade);
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
  // Ripples grow with the wind (uRipple), in the puffs and on a steep sea; broad, slow patches of stronger and
  // weaker ripple (the wind's own streaks) keep the surface from looking uniform.
  float patches = 0.75 + 0.5 * noise(vWorld.xz * 0.025 + uWindTo * uTime * 0.04);
  float strength = uRipple * patches * (1.0 + 0.9 * puff + 0.6 * steep);
  float rippleLost;
  vec2 g = ripples(vWorld.xz, pdx, pdy, strength, rippleLost);
  n = normalize(n + vec3(-g.x, 0.0, -g.y));
  lostVar += rippleLost;
  // Roughness (GGX alpha) from the slopes the pixel cannot show.
  float rough = clamp(0.035 + 1.4 * sqrt(lostVar), 0.035, 0.45);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float facing = max(dot(n, viewDir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 skyCol = skyLight(reflect(-viewDir, n), rough);
  vec3 body = mix(uDeep, uShallow, pow(1.0 - facing, 2.0) * 0.5) * uLight;
  // Shallows along the banks: lighter and greener over the bed (as the photographs from above show), fading
  // out over the first 40 m (E). Where the bed is known, through the water's depth instead: the bed shows less
  // the longer the light's path through the Dart's green water (about 1.5 m hides it, E), and so less at a
  // glancing view; the shallows' greener water over it.
  if (onBed) {
    float path = max(depthHere, 0.0) * (1.0 + 2.0 * (1.0 - facing));
    float seeBed = exp(-path / 1.5);
    body = mix(body, uShallowBank * uLight, (1.0 - smoothstep(0.5, 5.0, depthHere)) * 0.45);
    body = mix(body, uBedColour * uLight, seeBed * 0.7);
  } else {
    body = mix(body, uShallowBank * uLight, (1.0 - smoothstep(4.0, 40.0, inWater)) * 0.55);
  }
  // Light through the thin crest of a steep wave, most when looking towards the sun through it.
  float crestLift = smoothstep(0.2, 0.9, h / max(f.r * 0.5, 0.02)) * steep;
  float towardSun = pow(max(dot(-viewDir, normalize(uSunDir)), 0.0), 3.0);
  body += uShallow * uLight * (0.45 + 0.8 * towardSun) * crestLift;
  // In a puff the surface is rougher, so it reflects less sky and reads darker; the edge of a puff is darker
  // still, as sailors see a gust line coming (strengths chosen for the eye, E).
  float edge = smoothstep(0.15, 0.45, puff) * (1.0 - smoothstep(0.55, 0.9, puff));
  vec3 col = mix(body, skyCol, fres * (1.0 - 0.6 * puff));
  col *= 1.0 - 0.3 * puff - 0.08 * edge;
  // The sun's glint: a microfacet (GGX) highlight. Fine ripples the pixel cannot show widen it into the long
  // glitter path a low sun lays across the water.
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + viewDir);
  float NdotH = max(dot(n, H), 0.0);
  float NdotL = max(dot(n, L), 0.0);
  float a2 = rough * rough;
  float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, viewDir), 0.0), 5.0);
  float spec = D * Fs * NdotL / (4.0 * max(facing, 0.05));
  col += uSunColor * (1.0 - exp(-spec * 0.12)) * 1.5 * uGlint;
  // Whitecaps: foam on compressed crests, as much as the modelled cover, broken up and streaked downwind.
  // A few per cent cover already reads as a sea of white horses, so the cover is scaled up for the eye.
  float near = exp(-dist / 450.0);
  float cover = clamp(f.b * 20.0, 0.0, 1.0);
  float crest = smoothstep(0.85, 0.15, jac) * smoothstep(0.0, 0.5, h / max(f.r * 0.5, 0.02));
  float breakup = noise(vWorld.xz * 0.35 + uComp[4].xy * uTime * 0.6) * 0.6 + noise(vWorld.xz * 1.7) * 0.4;
  float streaks = noise(vec2(dot(vWorld.xz, uComp[4].xy) * 0.08, dot(vWorld.xz, vec2(-uComp[4].y, uComp[4].x)) * 1.2));
  float foam = clamp(crest * cover * 2.5 * smoothstep(0.3, 0.7, breakup) + cover * 0.25 * smoothstep(0.62, 0.9, streaks) * steep, 0.0, 1.0);
  // The wash at the water's edge: a thin, broken line of foam where waves run up the shore (none on a calm
  // river: it grows with the wave height).
  if (onBed) {
    float wash = (1.0 - smoothstep(0.02, 0.15 + 1.5 * f.r, depthHere)) * step(-0.05, depthHere) * smoothstep(0.03, 0.25, f.r);
    float lap = noise(vPlanar * 1.4 + vec2(uTime * 0.35, -uTime * 0.2)) + 0.35 * sin(uTime * 1.2 + dot(vPlanar, vec2(0.21, 0.17)));
    foam = max(foam, wash * smoothstep(0.45, 0.95, lap));
  }
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
        uSunColor: { value: new THREE.Color(1, 0.96, 0.85) },
        uCloud: { value: 0 },
        uWindTo: { value: new THREE.Vector2(0, -1) },
        uRipA: { value: Array.from({ length: N_RIP }, () => new THREE.Vector4()) },
        uRipB: { value: Array.from({ length: N_RIP }, () => new THREE.Vector4()) },
        uRipCount: { value: N_RIP },
        envMap: { value: null },
        // The estuary's green-teal (the owner's photographs from above, and the satellite picture's water).
        uDeep: { value: new THREE.Color(0x0f3a36) },
        uShallow: { value: new THREE.Color(0x2a6c62) },
        uShallowBank: { value: new THREE.Color(0x3d8273) },
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
        uBed: { value: null },
        uBedBox: { value: new THREE.Vector4(0, 0, 0, 0) },
        uWaterLevel: { value: 0 },
        // Estuary mud and sand seen through a little water (E).
        uBedColour: { value: new THREE.Color(0x6a6440) },
      },
      defines: { WATER_HIGH: 1 },
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
    // Beyond the near mesh (1.8 km), below the deepest trough so it never shows through the near sea.
    this.farMesh.position.y = -4;
    this.farMesh.frustumCulled = false;
    this.farMesh.renderOrder = WATER_ORDER;
    this.farMesh.name = 'water-far';
    this.setWind(5, 0);
  }

  /**
   * The wind-ripple trains: wavelengths from 0.12 m up (finer steps with detailed water), directions within
   * about ±80° of the wind (short-crested), capillary-gravity speeds; fixed pseudo-random jitter (E).
   */
  private setRipples(): void {
    const u = this.material.uniforms;
    const high = !!(this.material.defines as Record<string, unknown>).WATER_HIGH;
    const w = u.uWindTo!.value as THREE.Vector2;
    const A = u.uRipA!.value as THREE.Vector4[];
    const B = u.uRipB!.value as THREE.Vector4[];
    const frac = (x: number) => x - Math.floor(x);
    const count = high ? N_RIP : 5;
    for (let i = 0; i < N_RIP; i++) {
      const lambda = high ? 0.12 * Math.pow(1.3, i) * (0.85 + 0.3 * frac(Math.sin(i * 78.233) * 43758.5453)) : 0.12 * Math.pow(2.2, i);
      const ang = (frac(Math.sin(i * 12.9898 + 4.1) * 43758.5453) - 0.5) * 2.8;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const k = (2 * Math.PI) / lambda;
      A[i]!.set(w.x * ca - w.y * sa, w.x * sa + w.y * ca, lambda, 0.075 * Math.pow(lambda / 3, 0.2));
      B[i]!.set(k, Math.sqrt(G * k + 7.4e-5 * k * k * k), i * 1.7, 0);
    }
    u.uRipCount!.value = count;
  }

  /** The wave uniforms (the same objects), for things drawn on the surface that must move with it. */
  get seaUniforms(): Record<'uTime' | 'uComp' | 'uCurrent' | 'uField' | 'uFieldOrigin' | 'uFieldCell', THREE.IUniform> {
    const u = this.material.uniforms;
    return { uTime: u.uTime!, uComp: u.uComp!, uCurrent: u.uCurrent!, uField: u.uField!, uFieldOrigin: u.uFieldOrigin!, uFieldCell: u.uFieldCell! };
  }

  /**
   * Detail: 'high' reflects the sky's own light (the environment map, when there is one) and draws thirteen ripple
   * trains; 'low' a sky gradient and five trains.
   */
  setDetail(detail: 'low' | 'high'): void {
    const d = this.material.defines as Record<string, unknown>;
    const want = detail === 'high';
    if (!!d.WATER_HIGH === want) return;
    if (want) d.WATER_HIGH = 1;
    else delete d.WATER_HIGH;
    this.setRipples();
    this.setEnv(want ? this.env : null, true);
    this.material.needsUpdate = true;
  }

  private env: THREE.Texture | null = null;

  /**
   * The sky's light to reflect: a PMREM (cube UV) texture of the sky, or null for the gradient. Its size sets
   * the lookup's constants, as three.js does for its own materials.
   */
  setEnv(tex: THREE.Texture | null, keep = false): void {
    if (!keep) this.env = tex;
    const d = this.material.defines as Record<string, unknown>;
    const use = !!tex && !!d.WATER_HIGH;
    const h = (tex?.image as { height?: number } | undefined)?.height ?? 0;
    this.material.uniforms.envMap!.value = use ? tex : null;
    const maxMip = h ? Math.log2(h) - 2 : 0;
    const want = use && h ? { SKY_ENV: 1, ENVMAP_TYPE_CUBE_UV: 1, CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)), CUBEUV_TEXEL_HEIGHT: 1 / h, CUBEUV_MAX_MIP: `${maxMip}.0` } : {};
    const same = !!d.SKY_ENV === !!want.SKY_ENV && d.CUBEUV_TEXEL_HEIGHT === (want as { CUBEUV_TEXEL_HEIGHT?: number }).CUBEUV_TEXEL_HEIGHT;
    if (same) return;
    for (const k of ['SKY_ENV', 'ENVMAP_TYPE_CUBE_UV', 'CUBEUV_TEXEL_WIDTH', 'CUBEUV_TEXEL_HEIGHT', 'CUBEUV_MAX_MIP']) delete d[k];
    Object.assign(d, want);
    this.material.needsUpdate = true;
  }

  /** Draw the water only near tidal water (the River Dart's mask), or everywhere (undefined). */
  setMask(mask: { texture: THREE.Texture; box: THREE.Vector4 } | undefined): void {
    const u = this.material.uniforms;
    u.uMask!.value = mask?.texture ?? null;
    (u.uMaskBox!.value as THREE.Vector4).copy(mask?.box ?? new THREE.Vector4(0, 0, 0, 0));
  }

  /**
   * The bed and ground elevation grid (m ODN; rows south to north, cell-centred), uploaded once as a texture:
   * the water's colour then follows its depth at every tide. Undefined removes it.
   */
  setBed(g: { e0: number; n0: number; cell: number; nx: number; ny: number; values: Float32Array } | undefined): void {
    const u = this.material.uniforms;
    (u.uBed!.value as THREE.Texture | null)?.dispose();
    if (!g) {
      u.uBed!.value = null;
      (u.uBedBox!.value as THREE.Vector4).set(0, 0, 0, 0);
      return;
    }
    // 8 bits over ±12 m ODN (9 cm steps): every depth at which the bed can show, filtered on any GPU. (A
    // half-float texture stopped the scenery drawing under a software renderer.)
    const bytes = new Uint8Array(g.values.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, (g.values[i]! - BED_MIN) / (BED_MAX - BED_MIN))) * 255);
    const tex = new THREE.DataTexture(bytes, g.nx, g.ny, THREE.RedFormat, THREE.UnsignedByteType);
    tex.unpackAlignment = 1;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    u.uBed!.value = tex;
    (u.uBedBox!.value as THREE.Vector4).set(g.e0, g.n0, g.nx * g.cell, g.ny * g.cell);
  }

  /** The tide (m ODN): the water's depth over the bed. */
  setWaterLevel(odn: number): void {
    this.material.uniforms.uWaterLevel!.value = odn;
  }

  /** The haze's colour (changes as the camera turns when the atmosphere follows the sky). */
  setFogColour(c: THREE.Color): void {
    (this.material.uniforms.uFogColor!.value as THREE.Color).copy(c);
  }

  setFog(density: number): void {
    this.material.uniforms.uFogDensity!.value = density;
  }

  /**
   * The sky the water reflects and the light on it: sun direction, fog, cloud cover (greys the reflected sky),
   * daylight (0 night … 1 day) and the strength of the sun's glint (0 when the sun is hidden).
   */
  setSky(o: { sunDir: THREE.Vector3; fogColor: THREE.Color; fogDensity: number; cloud: number; day: number; glint: number; sunColor?: THREE.Color }): void {
    const u = this.material.uniforms;
    if (o.sunColor) (u.uSunColor!.value as THREE.Color).copy(o.sunColor);
    u.uCloud!.value = o.cloud;
    (u.uSunDir!.value as THREE.Vector3).copy(o.sunDir).normalize();
    (u.uFogColor!.value as THREE.Color).copy(o.fogColor);
    u.uFogDensity!.value = o.fogDensity;
    // Colours are linear here; the output's sRGB encoding lifts dark values, so night needs a low floor.
    const light = 0.012 + 0.988 * o.day * o.day;
    (u.uSky!.value as THREE.Color).setHex(0x75a0c4).lerp(new THREE.Color(0x6f777c), o.cloud).multiplyScalar(light);
    (u.uHorizon!.value as THREE.Color).setHex(0xc9dbe6).lerp(new THREE.Color(0x8e979c), o.cloud).multiplyScalar(light);
    u.uGlint!.value = o.glint;
    u.uLight!.value = light * (1 - 0.3 * o.cloud);
  }

  /** The light on the water (0 at night … 1 in full daylight): foam and spray are lit alike. */
  get light(): number {
    return this.material.uniforms.uLight!.value as number;
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
    // The ripples run downwind (Three.js xz of the compass direction the wind blows to).
    (this.material.uniforms.uWindTo!.value as THREE.Vector2).set(Math.sin(twdFrom + Math.PI), -Math.cos(twdFrom + Math.PI));
    this.setRipples();
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
