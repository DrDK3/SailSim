import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROCK_FOOT_ODN, type Boulder, type CoastRocks, type CoastSection } from '../sim/env/coastRocks';

/**
 * The rocky coast (src/sim/env/coastRocks.ts) drawn: along each run of sections a craggy face of slate from below
 * the water up to the cliff top, buttressed and gullied, flat-shaded so the facets read as rock; its top runs back
 * to meet the hillside and is drawn with the ground's own picture (the terrain's material), so the cliff top is the
 * same heath, grass or wood as the slope above it. Below high water the rock is dark with weed, at high water a
 * band of black lichen, above it grey-brown slate with ochre lichen and rust streaks, as the owner's photographs
 * of the mouth show. Boulders lie at the foot. Shapes and colours are illustrative (E). Land-fixed group (m ODN).
 */

const hash = (a: number, b: number) => {
  let h = (a * 73856093) ^ (b * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const C = {
  weed: new THREE.Color().setHex(0x2a281d, THREE.SRGBColorSpace),
  wet: new THREE.Color().setHex(0x37332e, THREE.SRGBColorSpace),
  black: new THREE.Color().setHex(0x252420, THREE.SRGBColorSpace),
  rock: new THREE.Color().setHex(0x5b554d, THREE.SRGBColorSpace),
  pale: new THREE.Color().setHex(0x736c62, THREE.SRGBColorSpace),
  lichen: new THREE.Color().setHex(0x7f7342, THREE.SRGBColorSpace),
  rust: new THREE.Color().setHex(0x664b35, THREE.SRGBColorSpace),
  green: new THREE.Color().setHex(0x48552f, THREE.SRGBColorSpace),
};

/** Smooth noise along the shore (by distance) for the buttresses and gullies: sums of sines. */
function along(s: number, k: number): number {
  return 0.5 * Math.sin(s * 0.21 + k * 1.7) + 0.3 * Math.sin(s * 0.53 + k * 2.9) + 0.2 * Math.sin(s * 1.31 + k * 0.6);
}

/** Rock colour for a face whose middle is at (x, y, z) with upward share `up`, `seed` for its variation. */
function rockColour(out: THREE.Color, x: number, y: number, z: number, up: number, top: number): THREE.Color {
  const v = 0.5 + 0.5 * Math.sin(x * 0.31 + z * 0.23) * Math.cos(y * 0.9 + x * 0.05);
  if (y < 0.3) return out.copy(C.weed).lerp(C.wet, 0.3 * v);
  if (y < 2.3) return out.copy(C.wet).lerp(C.weed, 0.25 + 0.35 * v);
  if (y < 3.3) return out.copy(C.black).lerp(C.wet, 0.4 * v);
  // Slate beds: bands across the face, lighter and darker.
  const band = 0.5 + 0.5 * Math.sin(y * 1.9 + x * 0.04 - z * 0.03);
  out.copy(C.rock).lerp(C.pale, Math.max(0, band - 0.55) * 1.6).lerp(C.wet, Math.max(0, 0.35 - band) * 0.8);
  const w = Math.sin(x * 0.77 + y * 0.4) * Math.cos(z * 0.69 - y * 0.3);
  if (w > 0.45) out.lerp(C.lichen, (w - 0.45) * 0.7);
  if (w < -0.65) out.lerp(C.rust, (-0.65 - w) * 1.0);
  // Grass and heath on the ledges and the top.
  if (up > 0.62 && y > top - 2.5) out.lerp(C.green, 0.7);
  else if (up > 0.75) out.lerp(C.green, 0.45);
  return out;
}

export interface CoastRockOptions {
  /** Ground (m ODN) as the picture draws it. */
  ground(e: number, n: number): number;
  /** The terrain's material and its picture's coordinates at (e, n), for the cliff tops; else they are drawn as rock. */
  topMaterial?: THREE.Material;
  uvAt?(e: number, n: number): [number, number];
}

/** One section's outline across the shore: [x inland, y m ODN] from under the water to buried in the hillside. */
function profile(s: CoastSection, dist: number, ground: (e: number, n: number) => number): { face: [number, number][]; top: [number, number][] } {
  const L = ROCK_FOOT_ODN;
  // The face's height rises and falls along the shore (headlands and coves, every few tens of metres), with a
  // little break-up from section to section; a gully here and there cuts it lower.
  const big = 0.5 + 0.5 * along(dist * 0.35, 7);
  const gully = hash(s.seed, 2) < 0.08 ? 0.6 : 1;
  const F = s.face * (0.7 + 0.55 * big) * (0.92 + 0.16 * (0.5 + 0.5 * along(dist * 1.1, 5))) * gully;
  // Buttresses stand out and gullies are set back (the whole face), and each level is broken up a little more.
  const A = Math.min(2.4, Math.max(0.3, 0.16 * F));
  const butt = Math.min(3, 0.22 * F + 0.4) * along(dist * 0.8, 3) + (gully < 1 ? 1.2 : 0);
  const j = (k: number) => A * (0.5 * along(dist * 1.3, k) + 0.5 * (hash(s.seed, k + 10) - 0.5) * 2);
  const ys = [-2.6, L + 0.05 * F - 0.5, L + 0.3 * F, L + 0.55 * F, L + 0.8 * F, L + F];
  const xs = [-3.4, -2.1, -1.4, -0.8, -0.2, 0.6];
  const face = xs.map((x, k) => [x + (k === 0 ? 0 : j(k) + butt * Math.min(1, k / 2)), ys[k]!] as [number, number]);
  // The top: back to where the hillside reaches it, then down into the ground.
  const at = (x: number) => ground(s.e + s.ue * x, s.n + s.un * x);
  const x5 = face[5]![0];
  const shelf = Math.max(x5 + 1, s.shelf);
  const topY = face[5]![1];
  const mid = x5 + (shelf - x5) * 0.5;
  const top: [number, number][] = [
    face[5]!,
    [mid, Math.max(at(mid) + 0.15, topY - 0.25 + 0.4 * hash(s.seed, 30))],
    [shelf + 1, Math.min(topY, at(shelf + 1)) - 0.25],
    [shelf + 3, at(shelf + 3) - 3],
  ];
  return { face, top };
}

/** A section's local point (x inland, y up) as a world point (e = x, n = -z). */
function world(s: CoastSection, [x, y]: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(s.e + s.ue * x, y, -(s.n + s.un * x));
}

/** A jagged boulder: a squashed, dented icosahedron, half bedded in the ground. */
function boulderTriangles(b: Boulder, pos: number[], col: number[]): void {
  const g = new THREE.IcosahedronGeometry(b.size / 2, 0).toNonIndexed();
  const p = g.getAttribute('position');
  const sx = 0.8 + 0.5 * hash(b.seed, 1);
  const sy = 0.5 + 0.35 * hash(b.seed, 2);
  const sz = 0.8 + 0.5 * hash(b.seed, 3);
  const rot = hash(b.seed, 4) * Math.PI * 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  // Dent each corner the same wherever it appears (by its rounded position), so the faces stay closed.
  const dent = (x: number, y: number, z: number) => 0.78 + 0.4 * hash(b.seed + Math.round(x * 50) * 7 + Math.round(y * 50) * 13, Math.round(z * 50));
  const cy = b.base + b.size * sy * 0.18;
  const vs: THREE.Vector3[] = [];
  for (let k = 0; k < p.count; k++) {
    const d = dent(p.getX(k), p.getY(k), p.getZ(k));
    const x = p.getX(k) * sx * d;
    const y = p.getY(k) * sy * d;
    const z = p.getZ(k) * sz * d;
    vs.push(new THREE.Vector3(b.e + x * cr - z * sr, cy + y, -(b.n + x * sr + z * cr)));
  }
  const tmp = new THREE.Color();
  for (let k = 0; k < vs.length; k += 3) {
    const a = vs[k]!;
    const bb = vs[k + 1]!;
    const c = vs[k + 2]!;
    const nrm = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const m = a.clone().add(bb).add(c).multiplyScalar(1 / 3);
    rockColour(tmp, m.x, m.y, m.z, Math.max(0, nrm.y), Infinity);
    for (const v of [a, bb, c]) {
      pos.push(v.x, v.y, v.z);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  g.dispose();
}

/** Tiles (m) the coast is cut into, so each piece is culled when out of view. */
const TILE = 600;

/** The rocky coast as meshes in a group, in tiles. */
export function buildCoastRocks(rocks: CoastRocks, o: CoastRockOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'coast-rocks';
  interface Tile {
    pos: number[];
    col: number[];
    top: number[];
    topUv: number[];
  }
  const tiles = new Map<string, Tile>();
  const tile = (e: number, n: number): Tile => {
    const k = `${Math.floor(e / TILE)},${Math.floor(n / TILE)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { pos: [], col: [], top: [], topUv: [] }));
    return t;
  };
  const tmp = new THREE.Color();
  for (const run of rocks.runs) {
    let dist = 0;
    const profs = run.map((s, i) => {
      if (i > 0) dist += Math.hypot(s.e - run[i - 1]!.e, s.n - run[i - 1]!.n);
      return profile(s, dist, o.ground);
    });
    for (let i = 0; i + 1 < run.length; i++) {
      const s0 = run[i]!;
      const s1 = run[i + 1]!;
      const t = tile(s0.e, s0.n);
      const seaward = new THREE.Vector3(-(s0.ue + s1.ue) / 2, 0, (s0.un + s1.un) / 2);
      const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: number[], want: THREE.Vector3): boolean => {
        // a, b on this section, c, d on the next; wound so the face looks the way `want` points.
        const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        const flip = nrm.dot(want) < 0;
        const tri = flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
        for (const v of tri) out.push(v.x, v.y, v.z);
        return flip;
      };
      // The face: rock, coloured per quad.
      const f0 = profs[i]!.face.map((p) => world(s0, p));
      const f1 = profs[i + 1]!.face.map((p) => world(s1, p));
      for (let k = 0; k + 1 < f0.length; k++) {
        const a = f0[k]!;
        const b = f0[k + 1]!;
        const c = f1[k]!;
        const d = f1[k + 1]!;
        const out = new THREE.Vector3().subVectors(b, a).add(new THREE.Vector3().subVectors(d, c)).cross(new THREE.Vector3().subVectors(c, a));
        const want = out.dot(seaward) >= 0 ? out : out.negate();
        // Upward share of the quad (for the ledges' grass).
        const up = Math.abs(want.normalize().y);
        quad(a, b, c, d, t.pos, seaward.clone().add(new THREE.Vector3(0, 0.0001, 0)));
        const m = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
        rockColour(tmp, m.x, m.y, m.z, up, ROCK_FOOT_ODN + Math.max(s0.face, s1.face));
        for (let q = 0; q < 6; q++) t.col.push(tmp.r, tmp.g, tmp.b);
      }
      // The top, back to the hillside: the ground's picture where there is one.
      const t0 = profs[i]!.top.map((p) => world(s0, p));
      const t1 = profs[i + 1]!.top.map((p) => world(s1, p));
      for (let k = 0; k + 1 < t0.length; k++) {
        const target = o.topMaterial ? t.top : t.pos;
        const before = target.length;
        quad(t0[k]!, t0[k + 1]!, t1[k]!, t1[k + 1]!, target, new THREE.Vector3(0, 1, 0));
        if (o.topMaterial && o.uvAt) {
          for (let q = before; q < target.length; q += 3) t.topUv.push(...o.uvAt(target[q]!, -target[q + 2]!));
        } else {
          const m = t0[k]!.clone().add(t1[k + 1]!).multiplyScalar(0.5);
          rockColour(tmp, m.x, m.y, m.z, 1, Infinity);
          for (let q = 0; q < 6; q++) t.col.push(tmp.r, tmp.g, tmp.b);
        }
      }
    }
  }
  for (const b of rocks.boulders) {
    const t = tile(b.e, b.n);
    boulderTriangles(b, t.pos, t.col);
  }
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true });
  for (const [k, t] of tiles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, rockMat);
    mesh.name = `coast-rocks-${k}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    if (o.topMaterial && t.top.length) {
      const raw = new THREE.BufferGeometry();
      raw.setAttribute('position', new THREE.Float32BufferAttribute(t.top, 3));
      raw.setAttribute('uv', new THREE.Float32BufferAttribute(t.topUv, 2));
      // Shared corners merged, so the top shades smoothly as the ground does.
      const tg = mergeVertices(raw);
      raw.dispose();
      tg.computeVertexNormals();
      const top = new THREE.Mesh(tg, o.topMaterial);
      top.name = `coast-tops-${k}`;
      top.receiveShadow = true;
      group.add(top);
    }
  }
  return group;
}
