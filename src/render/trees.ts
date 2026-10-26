import * as THREE from 'three';

/**
 * Woodland and hedgerow trees, where the satellite image (the terrain drape, Sentinel-2, 10 m) shows them: a
 * dark, green-dominant pixel is woodland (the Dart valley's hanging oak woods), a lighter green one field or
 * pasture with an occasional hedgerow tree. Trees are kept off the water and foreshore and out of the towns'
 * building footprints. Positions, sizes and kinds are drawn from a seeded hash of the place (the same trees
 * every time), not surveyed: illustrative (E). Built in chunks around the camera as instanced meshes, with a
 * coarser shape further off; beyond that the drape's colour stands for the woods.
 */

export interface WoodlandInput {
  /** The drape's pixels (RGBA, rows north to south) and where they lie. */
  pixels: Uint8ClampedArray;
  drape: { nx: number; ny: number; cell: number; e0: number; n0: number };
  /** Ground (m ODN) where the picture draws it. */
  groundAt(e: number, n: number): number;
  /** Building footprints (e, n rings): no trees in them. */
  buildings?: [number, number][][];
}

const CHUNK = 400;
const SPACING = 8.5;
const NEAR_M = 850;
const FAR_M = 2300;
const DROP_M = 2700;
/** Ground below this (m ODN) is foreshore or water: no trees (about high water springs, E). */
const SHORE_ODN = 3.2;

function hash(x: number, y: number, k: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A unit tree (height 1, crown 1 across): trunk and a lumpy crown with soft (radial) normals, darker towards
 * its underside where the leaves shade each other.
 */
function broadleaf(detail: number): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(0.5, detail);
  const p = crown.getAttribute('position');
  const nrm = new Float32Array(p.count * 3);
  const shade = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const dir = v.clone().normalize();
    nrm.set([dir.x, dir.y * 1.2, dir.z], i * 3);
    shade[i] = 0.62 + 0.38 * (0.5 + 0.5 * dir.y);
    const bump = 1 + 0.3 * (hash(Math.round(v.x * 50), Math.round(v.y * 50), Math.round(v.z * 50)) - 0.5);
    v.multiplyScalar(bump).multiply(new THREE.Vector3(1, 0.8, 1));
    p.setXYZ(i, v.x, v.y + 0.6, v.z);
  }
  crown.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  crown.getAttribute('normal').needsUpdate = true;
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5);
  trunk.translate(0, 0.21, 0);
  const g = coloured([
    [crown, 0x34502a],
    [trunk, 0x45372a],
  ]);
  // Self-shading of the crown (the trunk's vertices follow it in order, unshaded).
  const col = g.getAttribute('color');
  const idx = crown.index;
  const order = idx ? Array.from({ length: idx.count }, (_, k) => idx.getX(k)) : Array.from({ length: p.count }, (_, k) => k);
  order.forEach((vi, k) => col.setXYZ(k, col.getX(k) * shade[vi]!, col.getY(k) * shade[vi]!, col.getZ(k) * shade[vi]!));
  for (let k = 0; k < g.getAttribute('normal').count; k++) {
    const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), k).normalize();
    g.getAttribute('normal').setXYZ(k, n.x, n.y, n.z);
  }
  return g;
}

function conifer(sides: number): THREE.BufferGeometry {
  const crown = new THREE.ConeGeometry(0.42, 0.85, sides);
  crown.translate(0, 0.58, 0);
  const lower = new THREE.ConeGeometry(0.5, 0.5, sides);
  lower.translate(0, 0.38, 0);
  const trunk = new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5);
  trunk.translate(0, 0.15, 0);
  return coloured([
    [crown, 0x2a4529],
    [lower, 0x2d4a2b],
    [trunk, 0x4a3a2a],
  ]);
}

function coloured(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const [g0, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    c.setHex(hex, THREE.SRGBColorSpace);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

interface TreeList {
  broad: Float32Array; // e, n, y, crown, height, yaw, tint
  conifer: Float32Array;
}

interface Chunk {
  key: string;
  ce: number;
  cn: number;
  trees: TreeList;
  meshes?: { near: boolean; broad: THREE.InstancedMesh; conifer: THREE.InstancedMesh };
}

const STRIDE = 7;

export class Woodland {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly material = leafMaterial();
  private readonly geo = { broadNear: broadleaf(1), broadFar: broadleaf(0), coniferNear: conifer(8), coniferFar: conifer(5) };
  private readonly built = new Set<Chunk>();
  private readonly occupied: Set<number>;
  private frames = 0;
  /** How many trees there are in the chunks built so far (for tests and the report). */
  count = 0;

  constructor(private readonly input: WoodlandInput) {
    this.group.name = 'woodland';
    // Building footprints on an 8 m grid (with a cell's margin), where no tree stands.
    this.occupied = new Set();
    for (const ring of input.buildings ?? []) {
      let e0 = Infinity;
      let e1 = -Infinity;
      let n0 = Infinity;
      let n1 = -Infinity;
      for (const [e, n] of ring) {
        e0 = Math.min(e0, e);
        e1 = Math.max(e1, e);
        n0 = Math.min(n0, n);
        n1 = Math.max(n1, n);
      }
      for (let i = Math.floor(e0 / 8) - 1; i <= Math.floor(e1 / 8) + 1; i++) for (let j = Math.floor(n0 / 8) - 1; j <= Math.floor(n1 / 8) + 1; j++) this.occupied.add(cellKey(i, j));
    }
  }

  /** Woodland density 0…1 from the drape at (e, n): dark green woods, an occasional tree in green fields. */
  density(e: number, n: number): number {
    const d = this.input.drape;
    const i = Math.floor((e - d.e0) / d.cell);
    const j = d.ny - 1 - Math.floor((n - d.n0) / d.cell);
    if (i < 0 || j < 0 || i >= d.nx || j >= d.ny) return 0;
    const k = (j * d.nx + i) * 4;
    const px = this.input.pixels;
    const r = px[k]!;
    const g = px[k + 1]!;
    const b = px[k + 2]!;
    if (!(g > r * 1.12 && g > b * 1.08)) return 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const wood = Math.min(1, Math.max(0, (68 - lum) / 14));
    const hedge = lum < 100 ? 0.012 : 0;
    return Math.max(wood * 0.85, hedge);
  }

  private plant(ce: number, cn: number): TreeList {
    const broad: number[] = [];
    const con: number[] = [];
    for (let n = cn; n < cn + CHUNK; n += SPACING) {
      for (let e = ce; e < ce + CHUNK; e += SPACING) {
        const x = e + (hash(e, n, 1) - 0.5) * SPACING * 0.9;
        const y = n + (hash(e, n, 2) - 0.5) * SPACING * 0.9;
        const p = this.density(x, y);
        if (p <= 0 || hash(e, n, 3) > p) continue;
        if (this.occupied.has(cellKey(Math.floor(x / 8), Math.floor(y / 8)))) continue;
        const ground = this.input.groundAt(x, y);
        if (!(ground > SHORE_ODN)) continue;
        const isConifer = hash(e, n, 4) < 0.12;
        const h = isConifer ? 12 + 9 * hash(e, n, 5) : 10 + 8 * hash(e, n, 5);
        // Crowns wider than the spacing in woodland, so the canopy closes over.
        const crown = isConifer ? 3.6 + 1.8 * hash(e, n, 6) : (p > 0.3 ? 9 : 7) + 4 * hash(e, n, 6);
        (isConifer ? con : broad).push(x, y, ground - 0.4, crown, h, hash(e, n, 7) * Math.PI * 2, hash(e, n, 8));
      }
    }
    return { broad: Float32Array.from(broad), conifer: Float32Array.from(con) };
  }

  private mesh(list: Float32Array, geo: THREE.BufferGeometry): THREE.InstancedMesh {
    const count = list.length / STRIDE;
    const m = new THREE.InstancedMesh(geo, this.material, Math.max(1, count));
    m.count = count;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const o = k * STRIDE;
      q.setFromAxisAngle(Y, list[o + 5]!);
      mat.compose(new THREE.Vector3(list[o]!, list[o + 2]!, -list[o + 1]!), q, new THREE.Vector3(list[o + 3]!, list[o + 4]!, list[o + 3]!));
      m.setMatrixAt(k, mat);
      // Greens from dark oak to lighter ash and birch, a few yellowing.
      const t = list[o + 6]!;
      c.setRGB(0.78 + 0.22 * t, 0.8 + 0.2 * t, 0.78 + 0.08 * t);
      if (t > 0.95) c.setRGB(1.12, 1.0, 0.62);
      m.setColorAt(k, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = true;
    m.castShadow = m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }

  /**
   * Build, coarsen and drop chunks around the camera: every few frames (whether or not the simulation is
   * running), nearest first, a few new chunks at a time so no frame stalls.
   */
  update(camera: THREE.Camera, maxNew = 3): void {
    if (this.frames++ % 8 !== 0) return;
    const cx = camera.position.x;
    const cn = -camera.position.z;
    // The first time, everything in range (planting is cheap: about a millisecond a chunk).
    let budget = this.chunks.size ? maxNew : Infinity;
    const r = Math.ceil(FAR_M / CHUNK);
    const i0 = Math.floor(cx / CHUNK);
    const j0 = Math.floor(cn / CHUNK);
    const near: [number, number, number][] = [];
    for (let j = j0 - r; j <= j0 + r; j++) {
      for (let i = i0 - r; i <= i0 + r; i++) {
        const d = Math.hypot(i * CHUNK + CHUNK / 2 - cx, j * CHUNK + CHUNK / 2 - cn);
        if (d <= FAR_M) near.push([d, i, j]);
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    const wanted: [number, Chunk][] = [];
    for (const [d, i, j] of near) {
      const key = `${i},${j}`;
      let c = this.chunks.get(key);
      if (!c) {
        if (budget-- <= 0) continue;
        c = { key, ce: i * CHUNK, cn: j * CHUNK, trees: this.plant(i * CHUNK, j * CHUNK) };
        this.chunks.set(key, c);
        this.count += (c.trees.broad.length + c.trees.conifer.length) / STRIDE;
      }
      wanted.push([d, c]);
    }
    for (const [d, c] of wanted) {
      const near = d < NEAR_M;
      if (c.meshes && c.meshes.near === near) continue;
      if (c.meshes) this.dropMeshes(c);
      if (!c.trees.broad.length && !c.trees.conifer.length) continue;
      c.meshes = {
        near,
        broad: this.mesh(c.trees.broad, near ? this.geo.broadNear : this.geo.broadFar),
        conifer: this.mesh(c.trees.conifer, near ? this.geo.coniferNear : this.geo.coniferFar),
      };
      this.group.add(c.meshes.broad, c.meshes.conifer);
      this.built.add(c);
    }
    for (const c of [...this.built]) {
      if (Math.hypot(c.ce + CHUNK / 2 - cx, c.cn + CHUNK / 2 - cn) > DROP_M) {
        this.dropMeshes(c);
        this.built.delete(c);
      }
    }
  }

  private dropMeshes(c: Chunk): void {
    if (!c.meshes) return;
    this.group.remove(c.meshes.broad, c.meshes.conifer);
    c.meshes.broad.dispose();
    c.meshes.conifer.dispose();
    c.meshes = undefined;
  }
}

const Y = new THREE.Vector3(0, 1, 0);

/** Foliage: clumps of light and shade over each crown (noise in the tree's own frame, offset per tree). */
function leafMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLeaf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeaf = position * vec3(7.0, 9.0, 7.0) + instanceMatrix[3].xyz * 0.37;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLeaf;
        float lHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float lNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(lHash(i), lHash(i + vec3(1, 0, 0)), f.x), mix(lHash(i + vec3(0, 1, 0)), lHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(lHash(i + vec3(0, 0, 1)), lHash(i + vec3(1, 0, 1)), f.x), mix(lHash(i + vec3(0, 1, 1)), lHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.62 + 0.5 * (lNoise(vLeaf) * 0.65 + lNoise(vLeaf * 2.7) * 0.35);');
  };
  return m;
}
const cellKey = (i: number, j: number) => i * 100003 + j;
