import * as THREE from 'three';
import { BUMP_GLSL, bumpBlock } from './bump';

/**
 * Woodland and hedgerow trees, where the satellite image (the terrain drape, Sentinel-2, 10 m) shows them: a
 * dark, green-dominant pixel is woodland (the Dart valley's hanging oak woods), a lighter green one field or
 * pasture with an occasional hedgerow tree. Since the photo round (the owner's photographs of the harbour), the
 * steep valley sides outside the towns are wooded down to the rocks wherever the picture is dark or spoiled
 * (a pale 10 m pixel of surf or sunlit rock), and the towns' gardens have trees and shrubs between the houses,
 * as the photographs show. Trees are kept off the water and foreshore, out of building footprints and off the
 * roads. Positions, sizes and kinds are drawn from a seeded hash of the place (the same trees every time), not
 * surveyed: illustrative (E). Built in chunks around the camera as instanced meshes, with a coarser shape
 * further off; beyond that the drape's colour stands for the woods.
 */

export interface WoodlandInput {
  /** The drape's pixels (RGBA, rows north to south) and where they lie. */
  pixels: Uint8ClampedArray;
  drape: { nx: number; ny: number; cell: number; e0: number; n0: number };
  /** Ground (m ODN) where the picture draws it. */
  groundAt(e: number, n: number): number;
  /** Building footprints (e, n rings): no trees in them. */
  buildings?: [number, number][][];
  /** On a road (no tree there). */
  onRoad?: (e: number, n: number) => boolean;
  /** The towns (garden trees and shrubs; no woodland by slope), as well as wherever houses stand. */
  towns?: readonly { eMin: number; eMax: number; nMin: number; nMax: number }[];
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
 * A unit tree (height 1, crown 1 across): trunk and a crown. Near trees have a crown of several overlapping
 * lobes (a cloud of foliage rather than a ball), far ones a single lumpy ball. Normals point out from the
 * crown's centre, so the crown shades softly as a whole; it is darker towards its underside where the leaves
 * shade each other.
 */
function broadleaf(detail: number): THREE.BufferGeometry {
  const centre = new THREE.Vector3(0, 0.62, 0);
  // Lobes: centre (x, y, z) and radius; one ball when far.
  const lobes: [number, number, number, number][] = detail >= 1
    ? [[0, 0.62, 0, 0.34], [0.2, 0.56, 0.07, 0.27], [-0.18, 0.58, 0.11, 0.26], [0.04, 0.55, -0.21, 0.27], [-0.1, 0.78, -0.06, 0.24], [0.12, 0.76, 0.12, 0.22]]
    : [[0, 0.62, 0, 0.5]];
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const leaf = new THREE.Color().setHex(0x42552c, THREE.SRGBColorSpace);
  lobes.forEach(([lx, ly, lz, r], li) => {
    const ico = new THREE.IcosahedronGeometry(r, 0);
    const g = ico.index ? ico.toNonIndexed() : ico;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const bump = 1 + 0.25 * (hash(Math.round(v.x * 50) + li * 7, Math.round(v.y * 50), Math.round(v.z * 50)) - 0.5);
      v.multiplyScalar(bump).multiply(new THREE.Vector3(1, detail >= 1 ? 0.9 : 0.8, 1));
      v.add(new THREE.Vector3(lx, ly - (detail >= 1 ? 0 : 0.02), lz));
      const dir = v.clone().sub(centre).normalize();
      // Lobes vary a little in tone (sunlit and shaded clumps).
      const tone = 0.9 + 0.2 * hash(li, 3, 9);
      const shade = (0.6 + 0.4 * (0.5 + 0.5 * dir.y)) * tone;
      pos.push(v.x, v.y, v.z);
      nor.push(dir.x, dir.y * 1.2, dir.z);
      col.push(leaf.r * shade, leaf.g * shade, leaf.b * shade);
    }
  });
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5).translate(0, 0.21, 0).toNonIndexed();
  const bark = new THREE.Color().setHex(0x45372a, THREE.SRGBColorSpace);
  const tp = trunk.getAttribute('position');
  const tn = trunk.getAttribute('normal');
  for (let i = 0; i < tp.count; i++) {
    pos.push(tp.getX(i), tp.getY(i), tp.getZ(i));
    nor.push(tn.getX(i), tn.getY(i), tn.getZ(i));
    col.push(bark.r, bark.g, bark.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nv = new THREE.Float32BufferAttribute(nor, 3);
  for (let k = 0; k < nv.count; k++) {
    const n = new THREE.Vector3().fromBufferAttribute(nv, k).normalize();
    nv.setXYZ(k, n.x, n.y, n.z);
  }
  g.setAttribute('normal', nv);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
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
  /** 24 m cells with a building within about one cell: gardens there, not woods. */
  private readonly settled = new Set<number>();
  /** Building footprints on a 4 m grid, no margin (garden trees grow right up to the houses). */
  private readonly footprint = new Set<number>();
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
      for (let i = Math.floor(e0 / 4); i <= Math.floor(e1 / 4); i++) for (let j = Math.floor(n0 / 4); j <= Math.floor(n1 / 4); j++) this.footprint.add(cellKey(i, j));
      for (let i = Math.floor(e0 / 24) - 1; i <= Math.floor(e1 / 24) + 1; i++) for (let j = Math.floor(n0 / 24) - 1; j <= Math.floor(n1 / 24) + 1; j++) this.settled.add(cellKey(i, j));
    }
  }

  /** The drape's pixel (sRGB 0–255) at (e, n), or undefined off the picture. */
  private pixel(e: number, n: number): [number, number, number] | undefined {
    const d = this.input.drape;
    const i = Math.floor((e - d.e0) / d.cell);
    const j = d.ny - 1 - Math.floor((n - d.n0) / d.cell);
    if (i < 0 || j < 0 || i >= d.nx || j >= d.ny) return undefined;
    const k = (j * d.nx + i) * 4;
    const px = this.input.pixels;
    return [px[k]!, px[k + 1]!, px[k + 2]!];
  }

  /** Woodland density 0…1 from the drape at (e, n): dark green woods, an occasional tree in green fields. */
  density(e: number, n: number): number {
    const p = this.pixel(e, n);
    if (!p) return 0;
    const [r, g, b] = p;
    if (!(g > r * 1.12 && g > b * 1.08)) return 0;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const wood = Math.min(1, Math.max(0, (72 - lum) / 14));
    const hedge = lum < 100 ? 0.012 : 0;
    return Math.max(wood * 0.92, hedge);
  }

  /**
   * Woods on a steep bank (outside the towns) where the picture cannot be trusted: dark of any hue (woods
   * shading the water's edge) or pale and grey (surf, sunlit rock, a white boat). Steep green fields keep
   * their grass. 0…1.
   */
  steepWood(e: number, n: number, slope: number): number {
    const p = this.pixel(e, n);
    if (!p) return 0;
    const [r, g, b] = p;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const dark = lum < 82 ? 1 : 0;
    const pale = lum > 105 && sat < 30 ? 0.8 : 0;
    const k = Math.min(1, Math.max(0, (slope - 0.32) / 0.22));
    return k * Math.max(dark, pale) * 0.9;
  }

  private plant(ce: number, cn: number): TreeList {
    const broad: number[] = [];
    const con: number[] = [];
    const towns = this.input.towns ?? [];
    const G = (e: number, n: number) => this.input.groundAt(e, n);
    for (let n = cn; n < cn + CHUNK; n += SPACING) {
      for (let e = ce; e < ce + CHUNK; e += SPACING) {
        const x = e + (hash(e, n, 1) - 0.5) * SPACING * 0.9;
        const y = n + (hash(e, n, 2) - 0.5) * SPACING * 0.9;
        const town = towns.some((t) => x >= t.eMin && x <= t.eMax && y >= t.nMin && y <= t.nMax) || this.settled.has(cellKey(Math.floor(x / 24), Math.floor(y / 24)));
        let p = this.density(x, y);
        let garden = false;
        if (p < 0.5) {
          const ground0 = G(x, y);
          if (!(ground0 > SHORE_ODN)) continue;
          const slope = Math.hypot(G(x + 3, y) - G(x - 3, y), G(x, y + 3) - G(x, y - 3)) / 6;
          if (town) {
            // Gardens: a tree or a shrub on most open plots, more on the steep gardens of the hillsides (E).
            const g = 0.5 + 0.3 * Math.min(1, slope / 0.5);
            if (g > p) {
              p = g;
              garden = true;
            }
          } else p = Math.max(p, this.steepWood(x, y, slope));
        }
        if (p <= 0 || hash(e, n, 3) > p) continue;
        if (garden ? this.footprint.has(cellKey(Math.floor(x / 4), Math.floor(y / 4))) : this.occupied.has(cellKey(Math.floor(x / 8), Math.floor(y / 8)))) continue;
        const ground = G(x, y);
        if (!(ground > SHORE_ODN)) continue;
        if ((town || garden) && this.input.onRoad?.(x, y)) continue;
        const isConifer = hash(e, n, 4) < (garden ? 0.18 : 0.1);
        let h = isConifer ? 12 + 9 * hash(e, n, 5) : 10 + 8 * hash(e, n, 5);
        // Crowns wider than the spacing in woodland, so the canopy closes over.
        let crown = isConifer ? 3.6 + 1.8 * hash(e, n, 6) : (p > 0.3 ? 10 : 7) + 4 * hash(e, n, 6);
        if (garden) {
          // Garden trees and shrubs: smaller, and half of them bushes (E).
          const shrub = hash(e, n, 9) < 0.5;
          h = shrub ? 2 + 1.5 * hash(e, n, 5) : 5 + 5 * hash(e, n, 5);
          crown = shrub ? 2.4 + 1.6 * hash(e, n, 6) : (isConifer ? 3 : 4.5) + 3 * hash(e, n, 6);
        }
        (isConifer ? con : broad).push(x, y, ground - (garden ? 0.2 : 0.4), crown, h, hash(e, n, 7) * Math.PI * 2, hash(e, n, 8));
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
      // Greens from dark oak and holm oak to lighter ash and birch, a few yellowing (the photographs' woods
      // are olive, not emerald).
      const t = list[o + 6]!;
      c.setRGB(0.74 + 0.4 * t, 0.8 + 0.3 * t, 0.78 + 0.02 * t);
      if (t > 0.94) c.setRGB(1.2, 1.06, 0.6);
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
        }
        ${BUMP_GLSL}`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.62 + 0.5 * (lNoise(vLeaf) * 0.65 + lNoise(vLeaf * 2.7) * 0.35);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bumpBlock('lNoise(vLeaf) * 0.65 + lNoise(vLeaf * 2.7) * 0.35', 1.6, 15, 450)}`);
  };
  return m;
}
const cellKey = (i: number, j: number) => i * 100003 + j;
