import * as THREE from 'three';

/**
 * The islets off the mouth of the Dart (src/sim/env/islets.ts): each outline raised into a craggy rock, steep at the
 * water and drawing in to a rounded top at its height, flat-shaded so the facets read as rock. The band the tide
 * covers is dark and weedy, above it grey rock with yellow lichen, and on the larger ones a little green on top and
 * the white of the birds (as the owner's photographs show the Mew Stone and the rocks off the cliffs). The shapes'
 * detail is illustrative (E); the outlines are OpenStreetMap's and the heights estimates. Drawn in the land-fixed
 * group (m ODN).
 */

/** How deep the rock goes below datum (m ODN): out of sight under the water at low tide. */
const BASE = -4;

const hash = (a: number, b: number) => {
  let h = (a * 73856093) ^ (b * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const C = {
  weed: new THREE.Color().setHex(0x2c2a1f, THREE.SRGBColorSpace),
  wet: new THREE.Color().setHex(0x3b3833, THREE.SRGBColorSpace),
  rock: new THREE.Color().setHex(0x847d73, THREE.SRGBColorSpace),
  pale: new THREE.Color().setHex(0xa09a8e, THREE.SRGBColorSpace),
  lichen: new THREE.Color().setHex(0x9c8c4c, THREE.SRGBColorSpace),
  green: new THREE.Color().setHex(0x5f6b3c, THREE.SRGBColorSpace),
  guano: new THREE.Color().setHex(0xd9d6cb, THREE.SRGBColorSpace),
};

/** Smooth noise round a ring (by angle about its middle) and up it: ridges and gullies that run down the rock. */
function ringNoise(seed: number): (theta: number, y: number) => number {
  const ph = Array.from({ length: 6 }, (_, i) => hash(seed, i + 1) * Math.PI * 2);
  return (theta, y) =>
    0.45 * Math.sin(2 * theta + ph[0]!) + 0.3 * Math.sin(3 * theta + ph[1]! + y * 0.05) + 0.25 * Math.sin(5 * theta + ph[2]! + y * 0.11) + 0.22 * Math.sin(9 * theta + ph[3]!) + 0.16 * Math.sin(15 * theta + ph[4]! + y * 0.3) + 0.1 * Math.sin(23 * theta + ph[5]! + y * 0.5);
}

/** Smooth 3-D noise in about [-1, 1] for colouring (sums of sines). */
function colourNoise(seed: number, x: number, y: number, z: number): number {
  const a = hash(seed, 91) * 6.28;
  return (Math.sin(x * 0.21 + a) * Math.cos(z * 0.17 - a) + Math.sin(y * 0.33 + x * 0.07 + a * 2) + 0.6 * Math.sin((x + z) * 0.53 + y * 0.4)) / 2.6;
}

/** One islet's rock as triangles (positions and colours), its outline `ring` (local e, n, counter-clockwise). */
export function isletGeometry(ring: readonly [number, number][], height: number, seed: number): THREE.BufferGeometry {
  const n = ring.length;
  const ce = ring.reduce((a, p) => a + p[0], 0) / n;
  const cn = ring.reduce((a, p) => a + p[1], 0) / n;
  // Area, for how much shape a rock gets.
  let area = 0;
  for (let k = 0; k < n; k++) {
    const [e0, n0] = ring[k]!;
    const [e1, n1] = ring[(k + 1) % n]!;
    area += (e0 * n1 - e1 * n0) / 2;
  }
  area = Math.abs(area);
  const big = area > 1500;
  const noise = ringNoise(seed);
  // Levels: share of the way up, and how far each ring has drawn in towards the middle: steep from the water, then a
  // shoulder and a broken top (the big one); a stack drawing in to a jagged head (the small ones).
  const levels: [number, number][] = big
    ? [[0, 1], [0.1, 1], [0.32, 0.97], [0.55, 0.9], [0.74, 0.78], [0.88, 0.6], [0.96, 0.38]]
    : [[0, 1], [0.2, 1], [0.5, 0.9], [0.78, 0.68], [0.93, 0.4]];
  // The top is not over the middle: offset it a little (E).
  const off = [(hash(seed, 7) - 0.5) * 0.3, (hash(seed, 8) - 0.5) * 0.3];
  const theta = ring.map(([e, nn]) => Math.atan2(nn - cn, e - ce));
  const rough = big ? 0.2 : 0.28;
  const rings: THREE.Vector3[][] = levels.map(([t, s], li) =>
    ring.map(([e, nn], k) => {
      const yNom = BASE + (height - BASE) * t;
      // Gullies and ridges (the same at every level), and some break-up from level to level.
      const nz = noise(theta[k]!, yNom);
      const j = li === 0 ? 1 : 1 + rough * nz * Math.min(1, t * 2.5) + (hash(seed * 31 + k, li) - 0.5) * 0.06;
      const sc = Math.max(0.05, s * j);
      const cx = ce + off[0]! * (1 - s) * Math.sqrt(area);
      const cz = cn + off[1]! * (1 - s) * Math.sqrt(area);
      const y = li === 0 ? BASE : yNom + (t > 0.5 ? nz * (height - BASE) * (big ? 0.1 : 0.06) : (hash(seed + k * 7, li * 13) - 0.5) * 0.4);
      return new THREE.Vector3(cx + (e - ce) * sc, y, -(cz + (nn - cn) * sc));
    }),
  );
  const last = levels[levels.length - 1]![1];
  const peak = new THREE.Vector3(ce + off[0]! * (1 - last) * Math.sqrt(area), height, -(cn + off[1]! * (1 - last) * Math.sqrt(area)));
  const pos: number[] = [];
  const col: number[] = [];
  const tmp = new THREE.Color();
  const colour = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Color => {
    const x = (a.x + b.x + c.x) / 3;
    const y = (a.y + b.y + c.y) / 3;
    const z = (a.z + b.z + c.z) / 3;
    // Upward-facing share of the face: for lichen, plants and the birds' lime, which settle on ledges and the top.
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const up = Math.max(0, nrm.y);
    if (y < 0.4) return C.weed;
    if (y < 2.4) return tmp.copy(C.wet).lerp(C.weed, 0.35 + 0.3 * colourNoise(seed, x, y, z));
    const v = 0.5 + 0.5 * colourNoise(seed, x, y, z);
    tmp.copy(C.wet).lerp(C.rock, 0.55 + 0.45 * v).lerp(C.pale, Math.max(0, v - 0.6));
    const high = (y - 2.4) / Math.max(1, height - 2.4);
    const w = colourNoise(seed + 5, x * 1.7, y * 1.3, z * 1.7);
    if (high > 0.35) tmp.lerp(C.lichen, Math.max(0, w) * 0.35 * high);
    if (big && high > 0.7 && up > 0.5) tmp.lerp(C.green, Math.min(0.75, 0.25 + Math.max(0, colourNoise(seed + 9, x, y, z)) * 0.7));
    if (big && high > 0.5 && up > 0.3 && w > 0.55) tmp.lerp(C.guano, 0.45);
    return tmp.clone();
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: THREE.Color = colour(a, b, c)) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) col.push(ca.r, ca.g, ca.b);
  };
  for (let li = 0; li + 1 < rings.length; li++) {
    const lo = rings[li]!;
    const hi = rings[li + 1]!;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      // Outward faces: the ring is counter-clockwise seen from above (in e, n); in three.js z = -n, so wind it so.
      // One colour for the quad (its two triangles alike), from its middle.
      const mid = lo[k]!.clone().add(lo[k1]!).add(hi[k]!).add(hi[k1]!).multiplyScalar(0.25);
      // (Below the tide's reach the colour depends only on where it is, so the quad's middle will do.)
      const cUse = mid.y < 2.4 ? colour(mid, mid, mid) : colour(lo[k]!, lo[k1]!, hi[k1]!);
      tri(lo[k]!, lo[k1]!, hi[k1]!, cUse);
      tri(lo[k]!, hi[k1]!, hi[k]!, cUse);
    }
  }
  const top = rings[rings.length - 1]!;
  for (let k = 0; k < n; k++) tri(top[k]!, top[(k + 1) % n]!, peak);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** All the islets as one mesh in the land-fixed group (m ODN). */
export function buildIslets(outlines: readonly { name: string; height: number; ring: [number, number][] }[]): THREE.Mesh {
  const geos = outlines.map((o, i) => isletGeometry(o.ring, o.height, i + 1));
  const pos: number[] = [];
  const col: number[] = [];
  for (const g of geos) {
    pos.push(...(g.getAttribute('position').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }));
  mesh.name = 'islets';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
