import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The Royal Dart Yacht Club, Kingswear, modelled as itself from photographs of its river front (the owner's,
 * October 2026) on OpenStreetMap's footprint, a cross on plan. Drawn as the photographs show it:
 *  - the west wing: red brick, its steep slate gable to the river with a canted first-floor bay window over a
 *    gabled porch on white posts, the navy "RDYC" sign between them and the club's name on the porch;
 *  - a round red-brick turret with a conical slate roof in the corner between the west wing and the south wing;
 *  - a white first-floor balcony on white posts along the west wing's sunny south side and round the turret,
 *    over a covered veranda;
 *  - the south wing in white render under slate, its gable to the south;
 *  - tall brick chimneys with pots; the flagstaff on the terrace in front of the turret; a white marquee and
 *    tables with parasols on the terrace;
 *  - a stone sea wall under the terrace, with a white rail along its top;
 *  - the club's main pontoon off the south-west corner, reached by a long gangway, with a rack of dinghies
 *    stored on edge, a stack of small dinghies and a safety RIB (src/render/pontoons.ts draws the pontoon).
 * Storey heights, the pitches, the window sizes and positions, and the line of the sea wall are read from the
 * photographs, not measured (E). The data's height for this footprint (8.1 m ODN at the top) is far below what
 * the photographs show (two storeys and a steep roof on a terrace at about +3.3 m ODN), so it is not used.
 */

/** The building's frame: x along the west wing (towards the east), y across it (towards the north). */
export const RDYC_FRAME = {
  /** The inner corner of the west and south wings (local e, n). */
  origin: [-3.2, -4.5] as [number, number],
  thetaDeg: 9.07,
  /** The terrace and ground floor (m ODN, E). */
  floorOdn: 3.3,
};

const TH = (RDYC_FRAME.thetaDeg * Math.PI) / 180;
const COS = Math.cos(TH);
const SIN = Math.sin(TH);

/** Frame (x, y) to local (e, n). */
export function rdycToEN(x: number, y: number): [number, number] {
  return [RDYC_FRAME.origin[0] + x * COS - y * SIN, RDYC_FRAME.origin[1] + x * SIN + y * COS];
}

/** Local (e, n) to frame (x, y). */
export function rdycFromEN(e: number, n: number): [number, number] {
  const de = e - RDYC_FRAME.origin[0];
  const dn = n - RDYC_FRAME.origin[1];
  return [de * COS + dn * SIN, -de * SIN + dn * COS];
}

/** The sea wall's face (local e, n), north to south: in front of the houses north of the club and the club itself (E). */
export const SEA_WALL: [number, number][] = [
  [-15.5, 36.0],
  [-19.2, 32.5],
  [-18.9, 20.0],
  [-19.6, 9.5],
  [-20.81, 1.8],
  [-19.47, -6.59],
  [-17.38, -10.81],
  [-13.63, -15.28],
  [-8.06, -18.44],
  [-1.74, -19.96],
];
/** South of the club the wall runs on in front of the white houses, lower and with no terrace behind it (E). */
export const SEA_WALL_SOUTH: [number, number][] = [
  [-1.74, -19.96],
  [1.5, -24.0],
  [3.4, -31.0],
  [4.0, -44.0],
  [4.4, -55.0],
];
export const SEA_WALL_SOUTH_TOP = 2.6;

/** The terrace (and the ground behind the wall to the north) at the club's floor level: the wall, then inland round the buildings. */
export const RDYC_PLATFORM: [number, number][] = [
  ...SEA_WALL,
  [-1.0, -15.0],
  [2.0, -14.2],
  [3.0, -2.0],
  [2.0, 10.0],
  [-6.0, 12.0],
  [-8.0, 34.0],
];

/** Where the gangway lands on the terrace, and the pontoon end it runs to (local e, n). */
export const RDYC_GANGWAY = { shore: [-17.1, -8.1] as [number, number], pontoon: [-35.9, -14.05] as [number, number] };

/** The flagstaff, on the terrace in front of the turret. */
export const RDYC_FLAGSTAFF = { frame: [-3.6, -3.6] as [number, number], height: 12 };

function inside(poly: readonly (readonly [number, number])[], e: number, n: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ei, ni] = poly[i]!;
    const [ej, nj] = poly[j]!;
    if (ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei) c = !c;
  }
  return c;
}

const PLAT_BOX = (() => {
  const es = RDYC_PLATFORM.map((p) => p[0]);
  const ns = RDYC_PLATFORM.map((p) => p[1]);
  return { e0: Math.min(...es), e1: Math.max(...es), n0: Math.min(...ns), n1: Math.max(...ns) };
})();

/** The terrace's level (m ODN) where (e, n) is on it, else undefined: the picture's ground there. */
export function rdycPlatformAt(e: number, n: number): number | undefined {
  if (e < PLAT_BOX.e0 || e > PLAT_BOX.e1 || n < PLAT_BOX.n0 || n > PLAT_BOX.n1) return undefined;
  return inside(RDYC_PLATFORM, e, n) ? RDYC_FRAME.floorOdn : undefined;
}

// ------------------------------------------------------------------ textures (browser only)

type Key = 'brick' | 'render' | 'slate' | 'trim' | 'glass' | 'stone' | 'coping' | 'paving' | 'lead' | 'pot' | 'canvas' | 'sign' | 'name' | 'steel' | 'navy';

/** Texture repeat (m) per material: u, v. */
const SCALE: Partial<Record<Key, [number, number]>> = {
  brick: [1.2, 0.6],
  slate: [1.0, 0.5],
  render: [2.4, 2.4],
  stone: [2.4, 1.2],
  paving: [1.8, 1.8],
  coping: [1.0, 1.0],
};

const texCache = new Map<string, THREE.Texture>();
function canvasTex(id: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const hit = texCache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(id, t);
  return t;
}

/** A seeded hash for the textures' variation (deterministic). */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Victorian red brick in stretcher bond with pale mortar: one repeat 1.2 m by 0.6 m (5 bricks, 8 courses). */
function brickTex() {
  return canvasTex('rdyc-brick', 256, 128, (g) => {
    g.fillStyle = '#a0968a';
    g.fillRect(0, 0, 256, 128);
    for (let r = 0; r < 8; r++) {
      const off = r % 2 ? 25.6 : 0;
      for (let k = -1; k < 6; k++) {
        const x = k * 51.2 + off;
        const v = hash(r * 13 + k * 7);
        const red = 112 + v * 34;
        g.fillStyle = `rgb(${red}, ${36 + v * 18}, ${26 + v * 10})`;
        g.fillRect(x + 1.5, r * 16 + 1.5, 48, 13);
      }
    }
  });
}

/** Slates in courses, joints staggered: one repeat 1 m by 0.5 m (2 courses, 4 slates). */
function slateTex() {
  return canvasTex('rdyc-slate', 128, 64, (g) => {
    g.fillStyle = '#2a2e33';
    g.fillRect(0, 0, 128, 64);
    for (let r = 0; r < 2; r++) {
      for (let k = -1; k < 5; k++) {
        const v = hash(r * 31 + k * 3 + 5);
        const s = 50 + v * 20;
        g.fillStyle = `rgb(${s}, ${s + 4}, ${s + 9})`;
        g.fillRect(k * 32 + (r ? 16 : 0) + 1, r * 32 + 1, 30, 30);
      }
    }
  });
}

/** Painted render: off-white with a faint mottle. */
function renderTex() {
  return canvasTex('rdyc-render', 128, 128, (g) => {
    g.fillStyle = '#eeebe3';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${hash(i) > 0.5 ? '255,255,255' : '150,140,125'}, 0.06)`;
      g.fillRect(hash(i * 3) * 128, hash(i * 7) * 128, 3, 3);
    }
  });
}

/** Random rubble stone, as the sea wall in the photographs: grey and brown stones with dark joints, 2.4 by 1.2 m. */
export function stoneTex() {
  return canvasTex('rdyc-stone', 256, 128, (g) => {
    g.fillStyle = '#4a4540';
    g.fillRect(0, 0, 256, 128);
    let i = 0;
    for (let y = 0; y < 128; y += 14 + hash(y) * 8) {
      for (let x = -10; x < 256; ) {
        const w = 16 + hash(i++) * 26;
        const h = 11 + hash(i++) * 9;
        const v = hash(i++);
        const base = 120 + v * 50;
        g.fillStyle = `rgb(${base + 6}, ${base - 2}, ${base - 14})`;
        g.beginPath();
        g.ellipse(x + w / 2, y + h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
        g.fill();
        x += w;
      }
    }
  });
}

/** Stone flags on the terrace. */
function pavingTex() {
  return canvasTex('rdyc-paving', 128, 128, (g) => {
    g.fillStyle = '#8f8a80';
    g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const v = hash(r * 9 + k);
        const s = 176 + v * 24;
        g.fillStyle = `rgb(${s}, ${s - 4}, ${s - 12})`;
        g.fillRect(k * 42.7 + 1, r * 42.7 + 1, 40.7, 40.7);
      }
    }
  });
}

/** A sign board: text centred, in the club's navy and white. */
function signTex(id: string, text: string, fg: string, bg: string, w = 256, h = 64): THREE.Texture | undefined {
  return canvasTex(
    id,
    w,
    h,
    (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = `bold ${Math.round(h * 0.62)}px Georgia, 'Times New Roman', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2, w - 12);
    },
    false,
  );
}

let matCache: Record<Key, THREE.MeshStandardMaterial> | undefined;
function materials(): Record<Key, THREE.MeshStandardMaterial> {
  matCache ??= makeMaterials();
  return matCache;
}

function makeMaterials(): Record<Key, THREE.MeshStandardMaterial> {
  // A modest share of the sky's reflection (as the other buildings), so the brick reads red, not pink.
  const m = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.4, ...opts });
  const tex = (t: THREE.Texture | undefined, fallback: number, opts: THREE.MeshStandardMaterialParameters = {}) => (t ? m(0xffffff, { map: t, ...opts }) : m(fallback, opts));
  return {
    brick: tex(brickTex(), 0x9b4a37),
    render: tex(renderTex(), 0xeeebe3),
    slate: tex(slateTex(), 0x4b5158, { roughness: 0.7 }),
    trim: m(0xf4f4f0, { roughness: 0.6 }),
    glass: m(0x1f2a33, { roughness: 0.15, metalness: 0.6 }),
    stone: tex(stoneTex(), 0x7d766b, { roughness: 0.95 }),
    coping: m(0xb5afa3, { roughness: 0.9 }),
    paving: tex(pavingTex(), 0xb3ada1, { roughness: 0.9 }),
    lead: m(0x6a7175, { roughness: 0.6, metalness: 0.2 }),
    pot: m(0xa65a3a),
    canvas: m(0xf3f2ee, { roughness: 0.95, side: THREE.DoubleSide }),
    sign: tex(signTex('rdyc-sign', 'RDYC', '#ffffff', '#1d3557'), 0x1d3557, { roughness: 0.5 }),
    name: tex(signTex('rdyc-name', 'ROYAL DART YACHT CLUB', '#1d3557', '#f4f4f0', 512, 48), 0xf4f4f0, { roughness: 0.5 }),
    steel: m(0xa8adb2, { roughness: 0.45, metalness: 0.6 }),
    navy: m(0x1d3557, { roughness: 0.6 }),
  };
}

// ------------------------------------------------------------------ geometry

const G = RDYC_FRAME.floorOdn;

/** A frame point (x, y, height above the floor) in three.js space (x = e, y = up, z = -n). */
function P(x: number, y: number, h: number): THREE.Vector3 {
  const [e, n] = rdycToEN(x, y);
  return new THREE.Vector3(e, G + h, -n);
}

/** The frame's directions in three.js space. */
const FX = new THREE.Vector3(COS, 0, -SIN);
const FY = new THREE.Vector3(-SIN, 0, -COS);
const UP = new THREE.Vector3(0, 1, 0);
const YAW = new THREE.Quaternion().setFromAxisAngle(UP, TH);

class Builder {
  readonly parts = new Map<Key, THREE.BufferGeometry[]>();
  tris = 0;

  add(key: Key, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.computeVertexNormals();
    const list = this.parts.get(key) ?? [];
    list.push(g);
    this.parts.set(key, list);
    this.tris += g.getAttribute('position').count / 3;
  }

  /** A flat polygon (convex or not, in order), facing `out`. */
  poly(key: Key, pts: THREE.Vector3[], out: THREE.Vector3): void {
    if (pts.length < 3) return;
    // Triangulate in the plane: project onto two axes perpendicular to `out`.
    const n = out.clone().normalize();
    const a = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(a, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const flat = pts.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
    const tri = THREE.ShapeUtils.triangulateShape(flat, []);
    const pos: number[] = [];
    for (const t of tri) {
      const A = pts[t[0]!]!;
      let B = pts[t[1]!]!;
      let C = pts[t[2]!]!;
      const nn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (nn.dot(n) < 0) [B, C] = [C, B];
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.add(key, g);
  }

  quad(key: Key, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out?: THREE.Vector3): void {
    const n = out ?? new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    this.poly(key, [a, b, c, d], n);
  }

  /** A box in the frame: centred at (x, y), from h0 up, sx along x, sy along y, sz tall. */
  box(key: Key, x: number, y: number, h0: number, sx: number, sy: number, sz: number): void {
    this.add(key, new THREE.BoxGeometry(sx, sz, sy), new THREE.Matrix4().compose(P(x, y, h0 + sz / 2), YAW, new THREE.Vector3(1, 1, 1)));
  }

  /** A box along a frame segment (x0, y0)→(x1, y1), `w` wide, from h0 to h1. */
  beam(key: Key, x0: number, y0: number, x1: number, y1: number, w: number, h0: number, h1: number): void {
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) return;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, TH + a);
    this.add(key, new THREE.BoxGeometry(L, h1 - h0, w), new THREE.Matrix4().compose(P((x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2), q, new THREE.Vector3(1, 1, 1)));
  }

  /** A box along a segment in local (e, n), from heights y0 to y1 (m ODN). */
  beamEN(key: Key, a: [number, number], b: [number, number], w: number, y0: number, y1: number): void {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) return;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(b[1] - a[1], b[0] - a[0]));
    this.add(key, new THREE.BoxGeometry(L, y1 - y0, w), new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (y0 + y1) / 2, -(a[1] + b[1]) / 2), q, new THREE.Vector3(1, 1, 1)));
  }

  /**
   * A sign board on a wall: from frame a (the viewer's left) to b (their right), heights h0 to h1, the text
   * texture spread once across it (its own UVs; facing the viewer, the left of a→b).
   */
  sign(key: Key, a: [number, number], b: [number, number], h0: number, h1: number): void {
    const v = [P(a[0], a[1], h0), P(b[0], b[1], h0), P(b[0], b[1], h1), P(a[0], a[1], h1)];
    const pos = [v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!].flatMap((p) => [p.x, p.y, p.z]);
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const list = this.parts.get(key) ?? [];
    list.push(g);
    this.parts.set(key, list);
    this.tris += 2;
  }

  /** A wall from frame (x0, y0) to (x1, y1), heights h0 to h1, facing `out` (frame direction). */
  wall(key: Key, x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, outX: number, outY: number): void {
    const out = FX.clone().multiplyScalar(outX).add(FY.clone().multiplyScalar(outY));
    this.quad(key, P(x0, y0, h0), P(x1, y1, h0), P(x1, y1, h1), P(x0, y0, h1), out);
  }

  /** Merge into meshes with UVs projected in the building's frame (metres / the material's repeat). */
  build(mats: Record<Key, THREE.MeshStandardMaterial>, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.parts) {
      const g = mergeGeometries(list);
      if (!g) continue;
      if (key === 'sign' || key === 'name') {
        const mesh = new THREE.Mesh(g, mats[key]);
        mesh.name = `${name}-${key}`;
        group.add(mesh);
        continue;
      }
      const [su, sv] = SCALE[key] ?? [1, 1];
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const uv = new Float32Array(pos.count * 2);
      const tri = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        // One projection per triangle, from its normal in the frame.
        tri.set(0, 0, 0);
        for (let k = 0; k < 3; k++) tri.add(new THREE.Vector3(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k)));
        const nx = tri.dot(FX);
        const ny = tri.dot(FY);
        const nz = tri.y;
        for (let k = 0; k < 3; k++) {
          const e = pos.getX(i + k);
          const n = -pos.getZ(i + k);
          const [fx, fy] = rdycFromEN(e, n);
          const h = pos.getY(i + k);
          let u: number;
          let v: number;
          if (Math.abs(nz) >= Math.max(Math.abs(nx), Math.abs(ny))) {
            u = fx;
            v = fy;
          } else if (Math.abs(nx) > Math.abs(ny)) {
            u = fy;
            v = h;
          } else {
            u = fx;
            v = h;
          }
          uv[(i + k) * 2] = u / su;
          uv[(i + k) * 2 + 1] = v / sv;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(g, mats[key]);
      mesh.name = `${name}-${key}`;
      mesh.castShadow = key !== 'glass' && key !== 'paving';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** Roof slopes: tan of the pitch. */
const PITCH = { main: Math.tan((50 * Math.PI) / 180), wing: Math.tan((48 * Math.PI) / 180), low: Math.tan((42 * Math.PI) / 180), porch: Math.tan((35 * Math.PI) / 180) };

/**
 * A pitched roof over the frame rectangle x0..x1, y0..y1 with its ridge along `axis`; each end a gable or a hip.
 * Eaves at `eaves`, `o` m of overhang; gable ends get their triangle of wall (`wallKey`) and white bargeboards.
 */
function roof(b: Builder, r: { x0: number; x1: number; y0: number; y1: number; axis: 'x' | 'y'; eaves: number; slope: number; lo: 'gable' | 'hip' | 'none'; hi: 'gable' | 'hip' | 'none'; wallKey: Key; o?: number; key?: Key }): void {
  const o = r.o ?? 0.35;
  const key = r.key ?? 'slate';
  // Work in (a, c): a along the ridge, c across it; map back to (x, y).
  const ax = r.axis === 'x';
  const a0 = ax ? r.x0 : r.y0;
  const a1 = ax ? r.x1 : r.y1;
  const c0 = ax ? r.y0 : r.x0;
  const c1 = ax ? r.y1 : r.x1;
  const half = (c1 - c0) / 2;
  const cm = (c0 + c1) / 2;
  const ridge = r.eaves + half * r.slope;
  const e2 = r.eaves - o * r.slope;
  const pt = (a: number, c: number, h: number) => (ax ? P(a, c, h) : P(c, a, h));
  const dir = (a: number, c: number) => (ax ? FX.clone().multiplyScalar(a).add(FY.clone().multiplyScalar(c)) : FX.clone().multiplyScalar(c).add(FY.clone().multiplyScalar(a)));
  const ra0 = r.lo === 'hip' ? a0 + half : a0;
  const ra1 = r.hi === 'hip' ? a1 - half : a1;
  const ea0 = r.lo === 'gable' ? a0 - o : r.lo === 'hip' ? a0 - o : a0;
  const ea1 = r.hi === 'gable' ? a1 + o : r.hi === 'hip' ? a1 + o : a1;
  const ga0 = r.lo === 'gable' ? a0 - o : ra0;
  const ga1 = r.hi === 'gable' ? a1 + o : ra1;
  // The two long slopes.
  for (const s of [-1, 1]) {
    const ce = s < 0 ? c0 - o : c1 + o;
    const out = dir(0, s).add(UP.clone().multiplyScalar(1 / r.slope)).normalize();
    b.poly(key, [pt(ea0, ce, e2), pt(ea1, ce, e2), pt(ga1, cm, ridge), pt(ga0, cm, ridge)], out);
    // Fascia board along the eaves.
    const f0 = pt(ea0, ce, e2);
    const f1 = pt(ea1, ce, e2);
    b.quad('trim', f0, f1, f1.clone().add(new THREE.Vector3(0, -0.22, 0)), f0.clone().add(new THREE.Vector3(0, -0.22, 0)), dir(0, s));
  }
  // The ends.
  for (const [end, aE, aR, sgn] of [[r.lo, a0, ra0, -1], [r.hi, a1, ra1, 1]] as const) {
    if (end === 'hip') {
      const ae = aE + sgn * o;
      const out = dir(sgn, 0).add(UP.clone().multiplyScalar(1 / r.slope)).normalize();
      b.poly(key, [pt(ae, c0 - o, e2), pt(ae, c1 + o, e2), pt(aR, cm, ridge)], out);
    } else if (end === 'gable') {
      // The gable's triangle of wall, then the bargeboards along the verges.
      b.poly(r.wallKey, [pt(aE, c0, r.eaves), pt(aE, c1, r.eaves), pt(aE, cm, ridge)], dir(sgn, 0));
      const ae = aE + sgn * o;
      for (const cc of [c0 - o, c1 + o]) {
        const p0 = pt(ae, cc, e2);
        const p1 = pt(ae, cm, ridge + 0.05);
        const dn = new THREE.Vector3(0, -0.28, 0);
        b.quad('trim', p0, p1, p1.clone().add(dn), p0.clone().add(dn), dir(sgn, 0));
      }
      // A finial at the apex.
      b.add('trim', new THREE.CylinderGeometry(0.05, 0.08, 0.9, 6), new THREE.Matrix4().makeTranslation(pt(ae, cm, ridge + 0.4).x, pt(ae, cm, ridge + 0.4).y, pt(ae, cm, ridge + 0.4).z));
    }
  }
  // Ridge tiles.
  if (ga1 > ga0) {
    const p0 = pt(ga0, cm, ridge);
    const p1 = pt(ga1, cm, ridge);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), p1.clone().sub(p0).normalize());
    b.add('lead', new THREE.BoxGeometry(len, 0.14, 0.22), new THREE.Matrix4().compose(mid.add(new THREE.Vector3(0, 0.04, 0)), q, new THREE.Vector3(1, 1, 1)));
  }
}

/** A sash window or glazed door on a wall face: frame (x, y) of its centre, the wall's outward normal, width and heights. */
function windowAt(b: Builder, x: number, y: number, outX: number, outY: number, w: number, h0: number, h1: number, bars: 'sash' | 'door' | 'none' = 'sash'): void {
  const t = { x: -outY, y: outX }; // along the wall
  const off = 0.04;
  const cx = x + outX * off;
  const cy = y + outY * off;
  const out = FX.clone().multiplyScalar(outX).add(FY.clone().multiplyScalar(outY));
  const corner = (s: number, h: number, d = 0) => P(cx + t.x * s + outX * d, cy + t.y * s + outY * d, h);
  b.quad('glass', corner(-w / 2, h0), corner(w / 2, h0), corner(w / 2, h1), corner(-w / 2, h1), out);
  // White frame: four bars proud of the glass.
  const fw = 0.09;
  const bar = (s0: number, s1: number, hh0: number, hh1: number) => {
    const p0 = corner(s0, hh0, 0.03);
    const p1 = corner(s1, hh0, 0.03);
    const p2 = corner(s1, hh1, 0.03);
    const p3 = corner(s0, hh1, 0.03);
    b.quad('trim', p0, p1, p2, p3, out);
  };
  bar(-w / 2 - fw, w / 2 + fw, h0 - fw, h0);
  bar(-w / 2 - fw, w / 2 + fw, h1, h1 + fw);
  bar(-w / 2 - fw, -w / 2, h0, h1);
  bar(w / 2, w / 2 + fw, h0, h1);
  if (bars === 'sash') {
    const hm = (h0 + h1) / 2;
    bar(-w / 2, w / 2, hm - 0.035, hm + 0.035);
    bar(-0.025, 0.025, h0, h1);
  } else if (bars === 'door') {
    bar(-0.035, 0.035, h0, h1);
    bar(-w / 2, w / 2, h1 - 0.5, h1 - 0.44);
  }
  // A sill.
  if (bars !== 'door') {
    const s0 = corner(-w / 2 - 0.12, h0 - fw - 0.08, 0.12);
    const s1 = corner(w / 2 + 0.12, h0 - fw - 0.08, 0.12);
    b.quad('coping', s0, s1, s1.clone().add(new THREE.Vector3(0, 0.08, 0)), s0.clone().add(new THREE.Vector3(0, 0.08, 0)), out);
  }
}

/** A brick chimney stack with a stone cap and pots, at frame (x, y), from `h0` to `top`. */
function chimney(b: Builder, x: number, y: number, h0: number, top: number, sx = 1.1, sy = 0.65): void {
  b.box('brick', x, y, h0, sx, sy, top - h0);
  b.box('coping', x, y, top, sx + 0.16, sy + 0.16, 0.14);
  for (const k of [-1, 1]) {
    const p = P(x + (k * sx) / 4, y, top + 0.14 + 0.28);
    b.add('pot', new THREE.CylinderGeometry(0.11, 0.14, 0.56, 8), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
  }
}

export interface RdycClub {
  /** Fixed to the land: the clubhouse, terrace, sea wall and rail. */
  group: THREE.Group;
  /** 0 by day … 1 at night: the club's windows glow (it is open in the evening). */
  setNight(x: number): void;
  /** The flagstaff's foot (local e, n), its foot height (m ODN) and its height (m): the ensign flies from it. */
  flagstaff: { at: [number, number]; fromM: number; height: number };
  triangles: number;
}

/** The clubhouse, terrace and sea wall (src/render/dart.ts adds them in place of the plain footprint). */
export function buildRdycClub(): RdycClub {
  const b = new Builder();
  const EAVES = 6.6;
  const LOW = 6.0;

  // ---- west wing and the central block: red brick, x -12.1..9, y 0..9.6, gable to the river (west), hip east.
  b.wall('brick', -12.1, 0, -12.1, 9.6, 0, EAVES, -1, 0);
  b.wall('brick', -12.1, 0, 0, 0, 0, EAVES, 0, -1);
  b.wall('brick', -12.1, 9.6, 6, 9.6, 0, EAVES, 0, 1);
  roof(b, { x0: -12.1, x1: 9, y0: 0, y1: 9.6, axis: 'x', eaves: EAVES, slope: PITCH.main, lo: 'gable', hi: 'hip', wallKey: 'brick' });
  // ---- the south wing: white render, x 0..9, y -10.2..2.3, gable to the south; its ridge runs into the main roof.
  b.wall('render', 0, -10.2, 0, 0, 0, EAVES, -1, 0);
  b.wall('render', 0, -10.2, 9, -10.2, 0, EAVES, 0, -1);
  b.wall('render', 9, -10.2, 9, 2.3, 0, EAVES, 1, 0);
  roof(b, { x0: 0, x1: 9, y0: -10.2, y1: 4.2, axis: 'y', eaves: EAVES, slope: PITCH.wing, lo: 'gable', hi: 'none', wallKey: 'render' });
  // ---- the east wing (x 9..18, y 2.3..9.7) and the north wing (x 6..12.5, y 9.6..16.5): lower, hipped, brick.
  b.wall('brick', 9, 2.3, 18, 2.3, 0, LOW, 0, -1);
  b.wall('brick', 18, 2.3, 18, 9.7, 0, LOW, 1, 0);
  b.wall('brick', 12.5, 9.7, 18, 9.7, 0, LOW, 0, 1);
  roof(b, { x0: 9, x1: 18, y0: 2.3, y1: 9.7, axis: 'x', eaves: LOW, slope: PITCH.low, lo: 'hip', hi: 'hip', wallKey: 'brick' });
  b.wall('brick', 6, 9.6, 6, 16.5, 0, LOW, -1, 0);
  b.wall('brick', 6, 16.5, 12.5, 16.5, 0, LOW, 0, 1);
  b.wall('brick', 12.5, 9.7, 12.5, 16.5, 0, LOW, 1, 0);
  roof(b, { x0: 6, x1: 12.5, y0: 9.6, y1: 16.5, axis: 'y', eaves: LOW, slope: PITCH.low, lo: 'hip', hi: 'hip', wallKey: 'brick' });
  // A white string course at first-floor level and a plinth, on the brick.
  for (const [x0, y0, x1, y1, ox, oy] of [[-12.1, 0, -12.1, 9.6, -1, 0], [-12.1, 0, 0, 0, 0, -1], [-12.1, 9.6, 6, 9.6, 0, 1]] as const) {
    b.wall('trim', x0 + ox * 0.03, y0 + oy * 0.03, x1 + ox * 0.03, y1 + oy * 0.03, 3.4, 3.55, ox, oy);
    b.wall('coping', x0 + ox * 0.04, y0 + oy * 0.04, x1 + ox * 0.04, y1 + oy * 0.04, 0, 0.45, ox, oy);
  }

  // ---- the turret, in the corner: red brick to above the eaves, a white cornice, a conical slate roof and finial.
  const tc = P(-0.9, -0.9, 0);
  const tr = 1.9;
  const top = 9.2;
  b.add('brick', new THREE.CylinderGeometry(tr, tr, top, 16, 1, true), new THREE.Matrix4().makeTranslation(tc.x, G + top / 2, tc.z));
  b.add('trim', new THREE.CylinderGeometry(tr + 0.14, tr + 0.14, 0.28, 16), new THREE.Matrix4().makeTranslation(tc.x, G + top - 0.1, tc.z));
  b.add('trim', new THREE.CylinderGeometry(tr + 0.06, tr + 0.06, 0.18, 16), new THREE.Matrix4().makeTranslation(tc.x, G + 3.45, tc.z));
  b.add('slate', new THREE.ConeGeometry(tr + 0.3, 4.8, 16, 1, true), new THREE.Matrix4().makeTranslation(tc.x, G + top + 2.4, tc.z));
  b.add('lead', new THREE.CylinderGeometry(0.03, 0.09, 1.2, 6), new THREE.Matrix4().makeTranslation(tc.x, G + top + 5.2, tc.z));
  b.add('lead', new THREE.SphereGeometry(0.12, 8, 6), new THREE.Matrix4().makeTranslation(tc.x, G + top + 5.0, tc.z));
  // Its windows, looking west, south-west and south: tall and narrow, white-framed, on each floor.
  for (const deg of [180, 225, 270]) {
    const a = (deg * Math.PI) / 180;
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    for (const [h0, h1] of [[0.9, 2.5], [4.2, 5.8], [7.3, 8.5]] as const) windowAt(b, -0.9 + ox * (tr - 0.02), -0.9 + oy * (tr - 0.02), ox, oy, 0.6, h0, h1, 'none');
  }

  // ---- the gable end on the river: a canted bay window at first floor, the RDYC sign below it, a gabled porch.
  // Ground floor windows either side of the porch, first floor either side of the bay; an attic window above.
  for (const y of [1.2, 8.4]) {
    windowAt(b, -12.1, y, -1, 0, 1.2, 0.9, 2.6);
    windowAt(b, -12.1, y, -1, 0, 1.0, 4.3, 5.8);
  }
  windowAt(b, -12.1, 4.8, -1, 0, 0.9, 8.1, 9.3);
  // The bay: front 2.0 m wide at x -12.95, sides canted back to the wall at y 3.2 and 6.4; 4.6 to 6.9 m.
  {
    const bx = -12.95;
    const h0 = 4.6;
    const h1 = 6.9;
    const front: [number, number][] = [[bx, 3.8], [bx, 5.8]];
    const back: [number, number][] = [[-12.1, 3.2], [-12.1, 6.4]];
    const face = (p: [number, number], q: [number, number], hh0: number, hh1: number, key: Key) => {
      const ox = -(q[1] - p[1]);
      const oy = q[0] - p[0];
      const l = Math.hypot(ox, oy) || 1;
      b.wall(key, p[0], p[1], q[0], q[1], hh0, hh1, ox / l, oy / l);
    };
    // Glass, then mullions, sill and head in white; the apron below in navy with the club's initials.
    face(back[0]!, front[0]!, h0, h1, 'glass');
    face(front[0]!, front[1]!, h0, h1, 'glass');
    face(front[1]!, back[1]!, h0, h1, 'glass');
    face(back[0]!, front[0]!, 4.15, h0, 'trim');
    face(front[1]!, back[1]!, 4.15, h0, 'trim');
    b.sign('sign', [bx - 0.02, 5.8], [bx - 0.02, 3.8], 4.15, h0);
    for (const [p, q] of [[back[0]!, front[0]!], [front[0]!, front[1]!], [front[1]!, back[1]!]] as const) {
      const n = 3;
      for (let k = 0; k <= n; k++) {
        const x = p[0] + ((q[0] - p[0]) * k) / n;
        const y = p[1] + ((q[1] - p[1]) * k) / n;
        b.box('trim', x - 0.03, y, h0, 0.1, 0.1, h1 - h0);
      }
      b.beam('trim', p[0] - 0.04, p[1], q[0] - 0.04, q[1], 0.16, h0 - 0.08, h0);
      b.beam('trim', p[0] - 0.04, p[1], q[0] - 0.04, q[1], 0.16, h1, h1 + 0.12);
      b.beam('trim', p[0] - 0.04, p[1], q[0] - 0.04, q[1], 0.08, (h0 + h1) / 2 + 0.25, (h0 + h1) / 2 + 0.31);
    }
    // A lead-covered top.
    b.poly('lead', [P(-12.1, 3.1, h1 + 0.3), P(bx - 0.12, 3.75, h1 + 0.12), P(bx - 0.12, 5.85, h1 + 0.12), P(-12.1, 6.5, h1 + 0.3)], UP);
  }
  // The porch: x -14.7..-12.1, y 2.6..7.0; white posts, a slate roof gabled to the river, the club's name on its beam.
  {
    const x0 = -14.7;
    const pe = 2.6;
    for (const y of [2.7, 4.8, 6.9]) b.box('trim', x0 + 0.1, y, 0, 0.18, 0.18, pe);
    b.box('trim', -12.35, 2.7, 0, 0.18, 0.18, pe);
    b.box('trim', -12.35, 6.9, 0, 0.18, 0.18, pe);
    roof(b, { x0: x0, x1: -12.1, y0: 2.6, y1: 7.0, axis: 'x', eaves: pe, slope: PITCH.porch, lo: 'gable', hi: 'none', wallKey: 'trim', o: 0.25 });
    b.beam('trim', x0, 2.6, x0, 7.0, 0.16, pe - 0.42, pe);
    b.sign('name', [x0 - 0.1, 7.0], [x0 - 0.1, 2.6], pe - 0.4, pe - 0.02);
    // Steps and a door.
    b.box('coping', x0 + 0.9, 4.8, 0, 2.2, 3.4, 0.12);
    windowAt(b, -12.1, 4.8, -1, 0, 1.3, 0.12, 2.35, 'door');
  }

  // ---- windows round the rest.
  for (const x of [-10.6, -7.8, -5.0]) {
    windowAt(b, x, 0, 0, -1, 1.5, 0.05, 2.6, 'door');
    windowAt(b, x, 0, 0, -1, 1.1, 4.2, 5.9);
  }
  for (const x of [-10, -6.5, -3, 0.5, 4]) {
    windowAt(b, x, 9.6, 0, 1, 1.1, 0.9, 2.5);
    windowAt(b, x, 9.6, 0, 1, 1.1, 4.2, 5.8);
  }
  for (const y of [-4.6, -7.6]) {
    windowAt(b, 0, y, -1, 0, 1.6, 0.4, 2.7, 'door');
    windowAt(b, 0, y, -1, 0, 1.1, 4.2, 5.9);
  }
  for (const x of [2.2, 6.8]) {
    windowAt(b, x, -10.2, 0, -1, 1.2, 0.9, 2.6);
    windowAt(b, x, -10.2, 0, -1, 1.1, 4.2, 5.8);
  }
  windowAt(b, 4.5, -10.2, 0, -1, 0.8, 8.0, 9.0);
  for (const y of [-7, -3]) {
    windowAt(b, 9, y, 1, 0, 1.1, 0.9, 2.5);
    windowAt(b, 9, y, 1, 0, 1.1, 4.2, 5.6);
  }
  for (const x of [11, 15]) windowAt(b, x, 9.7, 0, 1, 1.0, 1.0, 2.4);
  for (const y of [4.5, 7.5]) windowAt(b, 18, y, 1, 0, 1.0, 1.0, 2.4);
  for (const x of [11.5, 15.5]) windowAt(b, x, 2.3, 0, -1, 1.0, 1.0, 2.4);
  for (const y of [12.5, 15]) windowAt(b, 6, y, -1, 0, 1.0, 1.0, 2.4);
  for (const x of [8, 10.5]) windowAt(b, x, 16.5, 0, 1, 1.0, 1.0, 2.4);

  // ---- the balcony: first floor, along the west wing's south side and round the turret down the south wing's west face.
  {
    const hb = 3.45;
    const slab: [number, number][] = [[-12.1, 0], [-12.1, -2.6], [-2.6, -2.6], [-2.6, -10.2], [0, -10.2], [0, 0]];
    b.poly('trim', slab.map(([x, y]) => P(x, y, hb + 0.18)), UP);
    b.poly('trim', slab.map(([x, y]) => P(x, y, hb)), UP.clone().negate());
    const edge: [number, number][] = [[-12.1, 0], [-12.1, -2.6], [-2.6, -2.6], [-2.6, -10.2], [0, -10.2]];
    for (let i = 0; i < edge.length - 1; i++) {
      const [x0, y0] = edge[i]!;
      const [x1, y1] = edge[i + 1]!;
      const L = Math.hypot(x1 - x0, y1 - y0);
      b.beam('trim', x0, y0, x1, y1, 0.12, hb, hb + 0.18);
      // Balustrade: top and bottom rails and turned balusters every 0.17 m.
      b.beam('trim', x0, y0, x1, y1, 0.12, hb + 1.0, hb + 1.1);
      b.beam('trim', x0, y0, x1, y1, 0.08, hb + 0.24, hb + 0.3);
      const n = Math.max(2, Math.round(L / 0.17));
      for (let k = 0; k <= n; k++) b.box('trim', x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, hb + 0.3, 0.05, 0.05, 0.7);
      // Posts down to the terrace every 2.4 m (or so), and newels on the balcony.
      const m = Math.max(1, Math.round(L / 2.4));
      for (let k = 0; k <= m; k++) {
        const x = x0 + ((x1 - x0) * k) / m;
        const y = y0 + ((y1 - y0) * k) / m;
        b.box('trim', x, y, 0, 0.18, 0.18, hb);
        b.box('trim', x, y, hb, 0.13, 0.13, 1.18);
      }
    }
  }

  // ---- chimneys.
  chimney(b, -8, 7.6, 8, 13.8);
  chimney(b, 1.5, 5.4, 9, 14.0);
  chimney(b, 7.4, -6.0, 7, 12.6);
  chimney(b, 17.0, 6.0, 5, 10.6, 0.65, 1.1);

  // ---- the terrace: paved at floor level from the sea wall to the buildings, a white rail along the wall top.
  const terraceY = G;
  const plat = RDYC_PLATFORM.map(([e, n]) => new THREE.Vector3(e, terraceY + 0.01, -n));
  b.poly('paving', plat, UP);
  // Its inland edges, where the ground behind is lower (the north end): a face down to below the ground.
  for (let i = SEA_WALL.length - 1; i < RDYC_PLATFORM.length; i++) {
    const a = RDYC_PLATFORM[i]!;
    const c = RDYC_PLATFORM[(i + 1) % RDYC_PLATFORM.length]!;
    const out = new THREE.Vector3(c[1] - a[1], 0, c[0] - a[0]);
    b.quad('stone', new THREE.Vector3(a[0], -1, -a[1]), new THREE.Vector3(c[0], -1, -c[1]), new THREE.Vector3(c[0], terraceY, -c[1]), new THREE.Vector3(a[0], terraceY, -a[1]), out);
  }
  // The sea wall: rubble stone from below the bed to a granite coping, the club's stretch and on south.
  const seaWall = (pts: [number, number][], topM: number, foot = -4.5) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const c = pts[i + 1]!;
      // Seaward (west) is the right of north-to-south travel: (dn, -de) in (e, n).
      const out = new THREE.Vector3(c[1] - a[1], 0, c[0] - a[0]);
      b.quad('stone', new THREE.Vector3(a[0], foot, -a[1]), new THREE.Vector3(c[0], foot, -c[1]), new THREE.Vector3(c[0], topM, -c[1]), new THREE.Vector3(a[0], topM, -a[1]), out);
      b.beamEN('coping', a, c, 0.55, topM - 0.05, topM + 0.18);
    }
  };
  seaWall(SEA_WALL, terraceY);
  seaWall(SEA_WALL_SOUTH, SEA_WALL_SOUTH_TOP);
  // White rail along the club's stretch of wall (posts and two rails), open where the gangway lands.
  {
    const gw = RDYC_GANGWAY;
    const gap = (e: number, n: number) => {
      // Distance from the gangway's line, near its shore end.
      const ue = gw.pontoon[0] - gw.shore[0];
      const un = gw.pontoon[1] - gw.shore[1];
      const L = Math.hypot(ue, un);
      const t = ((e - gw.shore[0]) * ue + (n - gw.shore[1]) * un) / (L * L);
      const pe = gw.shore[0] + ue * t;
      const pn = gw.shore[1] + un * t;
      return t > -0.2 && t < 0.3 && Math.hypot(e - pe, n - pn) < 1.0;
    };
    for (let i = 2; i < SEA_WALL.length - 1; i++) {
      const a = SEA_WALL[i]!;
      const c = SEA_WALL[i + 1]!;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const steps = Math.max(1, Math.round(L / 1.8));
      // Inset 0.25 m from the face, onto the coping.
      const ie = ((c[1] - a[1]) / L) * -0.25;
      const inn = (-(c[0] - a[0]) / L) * -0.25;
      for (let k = 0; k < steps; k++) {
        const p: [number, number] = [a[0] + ((c[0] - a[0]) * k) / steps + ie, a[1] + ((c[1] - a[1]) * k) / steps + inn];
        const q: [number, number] = [a[0] + ((c[0] - a[0]) * (k + 1)) / steps + ie, a[1] + ((c[1] - a[1]) * (k + 1)) / steps + inn];
        if (gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) continue;
        b.beamEN('trim', p, q, 0.06, terraceY + 0.95, terraceY + 1.03);
        b.beamEN('trim', p, q, 0.04, terraceY + 0.5, terraceY + 0.55);
        b.add('trim', new THREE.BoxGeometry(0.07, 1.03, 0.07), new THREE.Matrix4().makeTranslation(p[0], terraceY + 0.515, -p[1]));
      }
    }
  }
  // Tables with parasols on the open terrace and under the veranda; a white marquee in front of the south wing.
  const table = (x: number, y: number, parasol: number | null) => {
    const p = P(x, y, 0);
    b.add('trim', new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10), new THREE.Matrix4().makeTranslation(p.x, G + 0.74, p.z));
    b.add('steel', new THREE.CylinderGeometry(0.03, 0.03, 0.74, 5), new THREE.Matrix4().makeTranslation(p.x, G + 0.37, p.z));
    for (const [dx, dy] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]] as const) b.box('navy', x + dx, y + dy, 0, 0.42, 0.42, 0.46);
    if (parasol !== null) {
      b.add('steel', new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5), new THREE.Matrix4().makeTranslation(p.x, G + 1.15, p.z));
      b.add(parasol ? 'navy' : 'canvas', new THREE.ConeGeometry(1.3, 0.45, 8, 1, true), new THREE.Matrix4().makeTranslation(p.x, G + 2.25, p.z));
    }
  };
  table(-12.4, -4.6, 1);
  table(-11.0, -7.4, 0);
  table(-9.0, -1.3, null);
  table(-5.8, -1.3, null);
  {
    // Marquee: x -8.6..-3.4, y -9.6..-4.4; eaves 2.5, ridge 3.6 along x; canvas sides on the south and east.
    const [x0, x1, y0, y1] = [-8.6, -3.4, -9.6, -4.4];
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]] as const) b.box('steel', x, y, 0, 0.08, 0.08, 2.5);
    roof(b, { x0, x1, y0, y1, axis: 'x', eaves: 2.5, slope: 1.1 / 2.6, lo: 'gable', hi: 'gable', wallKey: 'canvas', key: 'canvas', o: 0.1 });
    b.wall('canvas', x0, y0, x1, y0, 0.05, 2.5, 0, -1);
    b.wall('canvas', x1, y0, x1, y1, 0.05, 2.5, 1, 0);
    // A scalloped valance on the open sides.
    b.wall('canvas', x0, y1, x1, y1, 2.2, 2.5, 0, 1);
    b.wall('canvas', x0, y0, x0, y1, 2.2, 2.5, -1, 0);
  }
  // The flagstaff (the ensign is added by dart.ts): white, with a yard and a gaff.
  const [fx, fy] = RDYC_FLAGSTAFF.frame;
  const fh = RDYC_FLAGSTAFF.height;
  const fp = P(fx, fy, 0);
  b.add('trim', new THREE.CylinderGeometry(0.07, 0.14, fh, 8), new THREE.Matrix4().makeTranslation(fp.x, G + fh / 2, fp.z));
  b.add('trim', new THREE.CylinderGeometry(0.18, 0.24, 0.5, 8), new THREE.Matrix4().makeTranslation(fp.x, G + 0.25, fp.z));
  b.box('trim', fx, fy, fh * 0.66, 0.1, 4.2, 0.1);
  b.add('trim', new THREE.SphereGeometry(0.16, 8, 6), new THREE.Matrix4().makeTranslation(fp.x, G + fh + 0.1, fp.z));

  const mats = materials();
  const group = b.build(mats, 'rdyc-club');
  const [fe, fn] = rdycToEN(fx, fy);
  const glass = mats.glass;
  glass.emissive.setHex(0xffb766);
  glass.emissiveIntensity = 0;
  return {
    group,
    setNight: (x: number) => {
      glass.emissiveIntensity = 0.9 * x;
    },
    flagstaff: { at: [fe, fn], fromM: G, height: fh },
    triangles: b.tris,
  };
}

/**
 * Gear on the club's pontoon (floating: heights above the water): a rack of dinghies stored on edge, a three-tier
 * stack of small dinghies with the club's sign on its end, a safety RIB alongside, and guide piles. `head` is the
 * pontoon's outline (local e, n). The rack's size and the boats are from the photographs (E).
 */
export function buildRdycPontoonGear(head: [number, number][], deck: number): { floating: THREE.Group; fixed: THREE.Group } {
  const floating = new THREE.Group();
  floating.name = 'rdyc-pontoon-gear';
  const fixed = new THREE.Group();
  fixed.name = 'rdyc-pontoon-piles';
  if (head.length < 4) return { floating, fixed };
  // The head's long axis: from the middle of its north end to the middle of its south end.
  const ns = [...head].sort((a, b) => b[1] - a[1]);
  const north: [number, number] = [(ns[0]![0] + ns[1]![0]) / 2, (ns[0]![1] + ns[1]![1]) / 2];
  const south: [number, number] = [(ns[ns.length - 1]![0] + ns[ns.length - 2]![0]) / 2, (ns[ns.length - 1]![1] + ns[ns.length - 2]![1]) / 2];
  const L = Math.hypot(south[0] - north[0], south[1] - north[1]);
  const ue = (south[0] - north[0]) / L;
  const un = (south[1] - north[1]) / L;
  // Across: towards the shore (east), the right of north-to-south travel... the left; pick the one pointing east.
  let ce = -un;
  let cn = ue;
  if (ce < 0) {
    ce = -ce;
    cn = -cn;
  }
  const at = (s: number, c: number): THREE.Vector3 => new THREE.Vector3(north[0] + ue * s + ce * c, deck, -(north[1] + un * s + cn * c));
  // rotation.y = φ turns three.js +x to (cos φ, sin φ) in (e, n).
  const yaw = Math.atan2(un, ue);
  const acrossYaw = Math.atan2(cn, ce);
  const mats = materials();
  const hullGrey = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.5 });
  const hullWhite = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.45 });
  // A small dinghy: a flattened ellipsoid, 2.9 m long, 1.3 m wide, 0.4 m deep (E).
  const hull = new THREE.SphereGeometry(1, 12, 8);
  hull.scale(1.45, 0.2, 0.65);
  // The rack of dinghies on edge, along the shore side: 14 hulls 0.6 m apart, mostly grey and white (E).
  const rackN = 14;
  const onEdge = new THREE.InstancedMesh(hull, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), rackN);
  const hullColours = [0x7d868d, 0x9aa3aa, 0xd9dcde, 0x6f7a84, 0xb7bec3, 0x2f5f8a, 0x9aa3aa, 0xc23b32];
  for (let k = 0; k < rackN; k++) onEdge.setColorAt(k, new THREE.Color(hullColours[(k * 5) % hullColours.length]!));
  onEdge.name = 'rdyc-dinghies-on-edge';
  const q = new THREE.Quaternion();
  for (let k = 0; k < rackN; k++) {
    const p = at(7 + k * 0.6, 1.1);
    p.y += 0.72;
    // Length across the pontoon, the hull's beam vertical: rolled on edge, then turned across.
    q.setFromEuler(new THREE.Euler(Math.PI / 2, acrossYaw, 0, 'YXZ'));
    onEdge.setMatrixAt(k, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  }
  onEdge.castShadow = true;
  floating.add(onEdge);
  // The rack's frame: two galvanised rails along it.
  const railGeo = new THREE.BoxGeometry(rackN * 0.6 + 0.6, 0.06, 0.06);
  for (const c of [0.2, 2.0]) {
    const r = new THREE.Mesh(railGeo, mats.steel);
    r.position.copy(at(7 + (rackN * 0.6) / 2 - 0.3, c)).add(new THREE.Vector3(0, 0.12, 0));
    r.rotation.y = yaw;
    floating.add(r);
  }
  // A three-tier stack of white dinghies, upside down, on a frame; the club's sign on its end.
  const stackN = 9;
  const stack = new THREE.InstancedMesh(hull, hullWhite, stackN);
  stack.name = 'rdyc-dinghy-stack';
  for (let k = 0; k < stackN; k++) {
    const tier = Math.floor(k / 3);
    const col = k % 3;
    const p = at(17.8 + col * 1.4, 1.6);
    p.y += 0.45 + tier * 0.62;
    q.setFromEuler(new THREE.Euler(Math.PI, acrossYaw, 0, 'YXZ'));
    stack.setMatrixAt(k, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  }
  stack.castShadow = true;
  floating.add(stack);
  for (const s of [16.9, 21.5]) {
    for (const c of [0.4, 2.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), mats.steel);
      post.position.copy(at(s, c)).add(new THREE.Vector3(0, 1.05, 0));
      floating.add(post);
    }
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), mats.sign);
  // Facing the river (west, -across): a plane's +z normal turned by φ points (sin φ, -cos φ) in (e, n).
  sign.position.copy(at(19.2, -0.05)).add(new THREE.Vector3(0, 1.75, 0));
  sign.rotation.y = Math.atan2(-ce, cn);
  sign.name = 'rdyc-pontoon-sign';
  floating.add(sign);
  // The safety RIB alongside the outer (west) side: orange tubes, a grey hull and a console.
  const rib = new THREE.Group();
  rib.name = 'rdyc-rib';
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xe0662a, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 4.2, 4, 10).rotateZ(Math.PI / 2), tubeMat);
    tube.position.set(0, 0.05, s * 0.85);
    rib.add(tube);
  }
  const ribHull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 1.6), hullGrey);
  ribHull.position.y = -0.1;
  rib.add(ribHull);
  const ribConsole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.7), hullWhite);
  ribConsole.position.set(0.2, 0.35, 0);
  rib.add(ribConsole);
  rib.position.copy(at(12, -4.5));
  rib.position.y = 0.1;
  rib.rotation.y = yaw;
  floating.add(rib);
  // Guide piles at the head's corners, just outside it (fixed to the bed; they stand through the tide).
  const pileGeo = new THREE.CylinderGeometry(0.18, 0.18, 14, 10);
  for (const [s, c] of [[2, -3.8], [L - 2, -3.8], [2, 3.8], [L - 2, 3.8]] as const) {
    const p = at(s, c);
    const pile = new THREE.Mesh(pileGeo, mats.steel);
    pile.position.set(p.x, -2.5, p.z);
    pile.castShadow = true;
    fixed.add(pile);
  }
  return { floating, fixed };
}
