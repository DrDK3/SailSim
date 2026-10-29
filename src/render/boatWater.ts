import * as THREE from 'three';
import { SEA_COMMON, SEA_DISPLACE } from './water';

/**
 * Where the boat meets the water, drawn on the waves themselves (each vertex is moved by the same wave trains
 * as the sea's surface, so nothing floats above a trough or sinks into a crest). Visual only, driven by the
 * boat's speed through the water, her rudder and her motion over the waves:
 *
 * - **Wake** (`WakeTrail`): a trail through the stern's recent positions. A turbulent white core (stirred
 *   more by the rudder) fades over about ten seconds; faint lines at its edges spread at the Kelvin angle
 *   (19.5° each side), as a displacement hull's wake does at any speed.
 * - **Hull foam and bow wave** (`HullFoam`): white water round the waterline, heaped at the bow and thrown
 *   out and aft as the speed rises, washing down the sides.
 * - **Spray** (`BowSpray`): droplets thrown up when the bow drops hard onto a wave at speed, blown downwind.
 *
 * Foam amounts and timings are estimates for the eye (E). A Squib is a displacement keelboat: below about
 * 1 m/s there is almost no white water, and spray needs both speed and a steep sea.
 */

const NOISE = /* glsl */ `
float bwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bwNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bwHash(i), bwHash(i + vec2(1.0, 0.0)), u.x), mix(bwHash(i + vec2(0.0, 1.0)), bwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bwFbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * bwNoise(p); p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; }
  return s;
}
`;

/** Uniforms the foam shares with the sea (the same objects: the wave trains move together). */
export type SeaUniforms = Record<'uTime' | 'uComp' | 'uCurrent' | 'uField' | 'uFieldOrigin' | 'uFieldCell', THREE.IUniform>;

const FOAM = new THREE.Color(0.92, 0.95, 0.96);
const KELVIN = Math.tan((19.47 * Math.PI) / 180);

const trailVertex = /* glsl */ `
${SEA_COMMON}
${SEA_DISPLACE}
attribute float aAge;
attribute float aLat;
attribute float aSpeed;
attribute float aStir;
attribute float aHalf;
varying float vAge;
varying float vLat;
varying float vSpeed;
varying float vStir;
varying float vHalf;
varying vec2 vXZ;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vXZ = world.xz;
  vec3 p = seaDisplace(world.xyz);
  // Just above the surface; more in a bigger sea, where the sea's own facets cut across the troughs.
  p.y += 0.025 + 0.12 * seaField(world.xz).r;
  vAge = aAge; vLat = aLat; vSpeed = aSpeed; vStir = aStir; vHalf = aHalf;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const trailFragment = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uFoam;
varying float vAge;
varying float vLat;
varying float vSpeed;
varying float vStir;
varying float vHalf;
varying vec2 vXZ;
${NOISE}
#include <fog_pars_fragment>
void main() {
  float speedF = smoothstep(0.5, 2.6, vSpeed);
  // Distance from the track (m) and the share of the wake's half-width.
  float lat = abs(vLat);
  float e = lat / max(vHalf, 1e-3);
  // The turbulent core: about the transom's width, slowly widening, boiling (noise anchored to the water).
  float coreW = 0.55 + 0.09 * vAge;
  float core = (1.0 - smoothstep(0.35 * coreW, coreW, lat)) * exp(-vAge / (5.0 + 3.0 * speedF)) * speedF * (0.8 + 0.4 * vStir);
  float boil = bwFbm(vXZ * 1.6 + vec2(uTime * 0.21, -uTime * 0.17));
  // A pale band of bubbles, brighter where the turbulence boils up.
  float coreFoam = core * mix(0.4, 1.0, smoothstep(0.35, 0.75, boil));
  // The slick: water the hull has smoothed, a wider, paler band that outlasts the bubbles.
  float slickW = 0.9 + 0.12 * vAge;
  float slick = (1.0 - smoothstep(0.6 * slickW, slickW, lat)) * exp(-vAge / 10.0) * speedF;
  // Kelvin lines at the edges: faint, broken, fading as they spread.
  float arms = smoothstep(0.8, 0.95, e) * (1.0 - smoothstep(0.95, 1.0, e)) * exp(-vAge / 5.0) * speedF;
  // Broken into short feathers (the divergent waves' crests), not a drawn line.
  arms *= smoothstep(0.35, 0.8, bwNoise(vec2(vAge * 3.2, e * 3.0) + vXZ * 0.35));
  float a = clamp(coreFoam * 0.85 + slick * 0.12 + arms * 0.2, 0.0, 0.85) * smoothstep(0.0, 0.25, vAge);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uFoam * uLight, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

interface TrailPoint {
  x: number;
  z: number;
  dx: number;
  dz: number;
  t: number;
  s: number;
  stir: number;
}

/** The wake: a trail through the stern's recent positions, lying on the waves. */
export class WakeTrail {
  readonly mesh: THREE.Mesh;
  private readonly max = 220;
  /** Vertices across the trail (edge, arm, core edge, centre, …): each band lies on the waves, not on a chord. */
  private static readonly COLS = 7;
  private readonly points: TrailPoint[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private lastT = -1;
  private readonly stern = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly cols = new Float64Array(WakeTrail.COLS);

  constructor(sea: SeaUniforms) {
    const C = WakeTrail.COLS;
    const n = this.max * C;
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    for (const a of ['aAge', 'aLat', 'aSpeed', 'aStir', 'aHalf']) this.geo.setAttribute(a, new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      for (let j = 0; j < C - 1; j++) {
        const a = i * C + j;
        idx.push(a, a + C, a + 1, a + 1, a + C, a + C + 1);
      }
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: 1 }, uFoam: { value: FOAM.clone() } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    // The sea's own uniform objects, so the trail follows the same waves.
    Object.assign(this.material.uniforms, sea);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'wake';
  }

  setLight(light: number): void {
    this.material.uniforms.uLight!.value = light;
  }

  /** `boat`: the hull's pose; `stw` speed through the water (m/s); `rudder` (rad); `time` render time (s). */
  update(boat: THREE.Object3D, stw: number, rudder: number, time: number): void {
    if (time < this.lastT) this.points.length = 0; // restarted
    if (time - this.lastT >= 0.1) {
      this.lastT = time;
      const stern = this.stern.set(0, 0, 2.55).applyQuaternion(boat.quaternion).add(boat.position);
      // A jump (a restart, a new start position) begins a new trail.
      const last = this.points[0];
      if (last && Math.hypot(stern.x - last.x, stern.z - last.z) > 30) this.points.length = 0;
      // Across the hull, level (heel does not tilt the trail).
      const side = this.side.set(1, 0, 0).applyQuaternion(boat.quaternion);
      side.y = 0;
      side.normalize();
      this.points.unshift({ x: stern.x, z: stern.z, dx: side.x, dz: side.z, t: time, s: stw, stir: Math.min(1, Math.abs(rudder) / 0.35) });
      if (this.points.length > this.max) this.points.pop();
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const age = this.geo.getAttribute('aAge') as THREE.BufferAttribute;
    const spd = this.geo.getAttribute('aSpeed') as THREE.BufferAttribute;
    const stir = this.geo.getAttribute('aStir') as THREE.BufferAttribute;
    const half = this.geo.getAttribute('aHalf') as THREE.BufferAttribute;
    const lat = this.geo.getAttribute('aLat') as THREE.BufferAttribute;
    const C = WakeTrail.COLS;
    const cols = this.cols;
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i]!;
      const a = time - p.t;
      // Half-width: the hull's half-beam, then the Kelvin wedge as the water behind falls astern.
      const w = Math.min(28, 0.7 + p.s * a * KELVIN);
      // Across: the edges and the arms near them, the slick's and core's edge, and the track itself.
      const c = Math.min(0.85 * w, 1.0 + 0.12 * a);
      cols[0] = -w;
      cols[1] = -0.9 * w;
      cols[2] = -c;
      cols[3] = 0;
      cols[4] = c;
      cols[5] = 0.9 * w;
      cols[6] = w;
      for (let j = 0; j < C; j++) {
        const k = i * C + j;
        const off = cols[j]!;
        pos.setXYZ(k, p.x + p.dx * off, 0, p.z + p.dz * off);
        lat.setX(k, off);
        age.setX(k, a);
        spd.setX(k, p.s);
        stir.setX(k, p.stir);
        half.setX(k, w);
      }
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * (C - 1) * 6);
    for (const a of [pos, lat, age, spd, stir, half]) a.needsUpdate = true;
  }
}

const ringVertex = /* glsl */ `
${SEA_COMMON}
${SEA_DISPLACE}
attribute float aS;
attribute float aT;
varying float vS;
varying float vT;
varying vec2 vXZ;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vXZ = world.xz;
  vec3 p = seaDisplace(world.xyz);
  p.y += 0.03 + 0.12 * seaField(world.xz).r;
  vS = aS; vT = aT;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const ringFragment = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform float uSpeed;
uniform vec3 uFoam;
varying float vS;
varying float vT;
varying vec2 vXZ;
${NOISE}
#include <fog_pars_fragment>
void main() {
  float speedF = smoothstep(0.6, 3.0, uSpeed);
  // Heaped at the bow, washing down the sides, thin along the quarters.
  float bow = exp(-vS * 3.5);
  float amount = min(1.0, 1.3 * speedF * (0.35 + 0.65 * bow)) * pow(1.0 - vT, 1.1);
  // Foam streams aft at the boat's speed (noise moves with the water past the hull).
  float n = bwFbm(vXZ * 2.4 + vec2(uTime * 0.3, uTime * 0.25));
  float foam = amount * smoothstep(0.5 - 0.35 * amount, 0.85, n + 0.3 * (1.0 - vT));
  // A thin line of bubbles where the hull meets the water, even slowly.
  foam = max(foam, (1.0 - smoothstep(0.0, 0.18, vT)) * 0.22 * smoothstep(0.15, 0.8, uSpeed) * (0.6 + 0.4 * n));
  float a = clamp(foam, 0.0, 0.85);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uFoam * uLight, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const STATIONS = 22;
/** The Squib's waterline (m, model frame: bow at -z): from the bow to the immersed stern (E, from the hull lines). */
const WL = { bow: -2.65, stern: 2.35, half: 0.78, sternHalf: 0.55 };

function waterlineHalf(s: number): number {
  // s: 0 at the bow … 1 at the stern.
  const fwd = Math.pow(Math.min(1, s / 0.45), 0.62);
  return WL.half * fwd - (WL.half - WL.sternHalf) * THREE.MathUtils.smoothstep(s, 0.6, 1);
}

/** White water round the waterline and the bow wave; lies on the waves, turns with the boat (not her heel). */
export class HullFoam {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private lastSpeed = -1;

  constructor(sea: SeaUniforms) {
    // Per side: STATIONS+1 stations × (inner, outer); the two sides join at the bow.
    const verts = 2 * (STATIONS + 1) * 2;
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3));
    const aS = new Float32Array(verts);
    const aT = new Float32Array(verts);
    const idx: number[] = [];
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i <= STATIONS; i++) {
        const v = (side * (STATIONS + 1) + i) * 2;
        aS[v] = aS[v + 1] = i / STATIONS;
        aT[v] = 0;
        aT[v + 1] = 1;
        if (i < STATIONS) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    this.geo.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    this.geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    this.geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: 1 }, uSpeed: { value: 0 }, uFoam: { value: FOAM.clone() } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    Object.assign(this.material.uniforms, sea);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'hull-foam';
    this.shape(0);
  }

  /** The ring's outline for a speed: the bow wave thrown wider and further aft as the boat goes faster. */
  private shape(stw: number): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const speedF = THREE.MathUtils.smoothstep(stw, 0.6, 3.0);
    for (let side = 0; side < 2; side++) {
      const sx = side ? 1 : -1;
      for (let i = 0; i <= STATIONS; i++) {
        const s = i / STATIONS;
        const z = WL.bow + (WL.stern - WL.bow) * s;
        const h = waterlineHalf(s);
        const bow = Math.exp(-s * 3.5);
        const w = 0.18 + (0.25 + 1.1 * bow) * speedF;
        const v = (side * (STATIONS + 1) + i) * 2;
        pos.setXYZ(v, sx * Math.max(0.02, h - 0.04), 0, z);
        pos.setXYZ(v + 1, sx * (h + w), 0, z + w * (0.4 + 0.6 * bow));
      }
    }
    pos.needsUpdate = true;
  }

  setLight(light: number): void {
    this.material.uniforms.uLight!.value = light;
  }

  /**
   * Follow the boat at speed `stw` (m/s): position and heading, and her heel (rad, > 0 to starboard), which
   * moves the waterline towards the lee side (about half a metre at 30°, E).
   */
  update(x: number, z: number, heading: number, stw: number, heel = 0): void {
    const off = Math.sin(heel) * 0.9;
    this.mesh.position.set(x + Math.cos(heading) * off, 0, z + Math.sin(heading) * off);
    this.mesh.rotation.set(0, -heading, 0);
    this.material.uniforms.uSpeed!.value = stw;
    if (Math.abs(stw - this.lastSpeed) > 0.05) {
      this.lastSpeed = stw;
      this.shape(stw);
    }
  }
}

const sprayVertex = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vLife = aLife;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const sprayFragment = /* glsl */ `
uniform float uLight;
varying float vLife;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float a = (1.0 - r * 4.0) * clamp(vLife * 2.0, 0.0, 1.0) * 0.75;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * uLight, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Droplets thrown from the bow when it drops hard onto a wave at speed. */
export class BowSpray {
  readonly points: THREE.Points;
  private readonly max = 360;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private seed = 7;
  private carry = 0;
  enabled = true;

  constructor() {
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: sprayVertex,
      fragmentShader: sprayFragment,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: 1 }, uScale: { value: 600 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.name = 'spray';
  }

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return this.seed / 4294967296;
  }

  setLight(light: number): void {
    this.material.uniforms.uLight!.value = light;
  }

  /** Point size scale for the drawing buffer's height (pixels). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * `boat`: the hull's pose; `stw` (m/s); `bowDrop`: the bow's vertical speed (m/s, < 0 falling); `windTo`:
   * the wind's velocity over the water in Three.js xz (m/s); `dt` (s).
   */
  update(boat: THREE.Object3D, stw: number, bowDrop: number, windToX: number, windToZ: number, dt: number): void {
    const step = Math.min(dt, 0.1);
    // Emit: droplets a second, by how hard the bow comes down and how fast she is going.
    const rate = this.enabled ? 900 * Math.max(0, -bowDrop - 0.45) * THREE.MathUtils.smoothstep(stw, 1.6, 3.2) : 0;
    this.carry += rate * step;
    if (this.carry > 0) {
      const q = boat.quaternion;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        const side = this.rnd() < 0.5 ? -1 : 1;
        const along = -2.2 + this.rnd() * 0.7;
        const o = i * 3;
        const bx = boat.position.x - fwd.x * along + right.x * side * (0.25 + this.rnd() * 0.3);
        const bz = boat.position.z - fwd.z * along + right.z * side * (0.25 + this.rnd() * 0.3);
        this.pos[o] = bx;
        this.pos[o + 1] = boat.position.y + 0.1;
        this.pos[o + 2] = bz;
        const out = 0.8 + this.rnd() * 1.6;
        this.vel[o] = fwd.x * stw * 0.6 + right.x * side * out;
        this.vel[o + 1] = 1.2 + this.rnd() * 2.2;
        this.vel[o + 2] = fwd.z * stw * 0.6 + right.z * side * out;
        this.life[i] = 0.6 + this.rnd() * 0.5;
        this.size[i] = 0.05 + this.rnd() * 0.09;
      }
      (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    } else this.carry = 0;
    // Move: gravity, air drag towards the wind's velocity.
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      alive++;
      const o = i * 3;
      const k = Math.min(1, 1.6 * step);
      this.vel[o] = this.vel[o]! + (windToX - this.vel[o]!) * k;
      this.vel[o + 2] = this.vel[o + 2]! + (windToZ - this.vel[o + 2]!) * k;
      this.vel[o + 1] = this.vel[o + 1]! - 9.81 * step;
      this.pos[o] = this.pos[o]! + this.vel[o]! * step;
      this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * step;
      this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * step;
      this.life[i] = this.life[i]! - step;
      if (this.pos[o + 1]! < boat.position.y - 0.3) this.life[i] = 0;
    }
    this.points.visible = alive > 0;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }
}
