import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A kit for modelling vessels: lofted hulls (round bilge or hard chine, flare, raked stem and transom, sheer,
 * boot top and stripes), decks with bulwarks, superstructures lofted from rounded plans with raked fronts,
 * tumblehome and framed window bands, tubular rails, fendering, masts with lights and radar, outboards, cars and
 * passengers. Parts are collected per material and merged, so a vessel is a handful of draw calls. Painted
 * parts carry vertex colours. Model frame: x = starboard, y = up (0 = waterline), z = aft (bow towards -z).
 */

// ------------------------------------------------------------------ materials

let glassTex: THREE.Texture | undefined;
/** Window glass: dark, reflective, with lighter frames every repeat (u along the band, v up it). */
function glassTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  if (!glassTex) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#5a6b78');
    grad.addColorStop(0.5, '#26343f');
    grad.addColorStop(1, '#1a242c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#d9dcd8';
    g.fillRect(0, 0, 6, 64);
    g.fillRect(122, 0, 6, 64);
    g.fillRect(0, 0, 128, 4);
    g.fillRect(0, 60, 128, 4);
    glassTex = new THREE.CanvasTexture(c);
    glassTex.colorSpace = THREE.SRGBColorSpace;
    glassTex.wrapS = THREE.RepeatWrapping;
    glassTex.anisotropy = 4;
  }
  return glassTex;
}

export const VMAT = {
  paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04 }),
  gloss: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.18 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.55 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xd4d9de, roughness: 0.25, metalness: 0.9 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }),
  canvas: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }),
};
let glassApplied = false;
function applyGlass(): void {
  if (glassApplied) return;
  glassApplied = true;
  VMAT.glass.map = glassTexture();
  VMAT.glass.needsUpdate = true;
}

// ------------------------------------------------------------------ kit

const COLOUR = new THREE.Color();

/** Parts collected per material, merged at the end into one mesh per material. */
export class Kit {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Add a part (its transform baked in); painted materials take `colour` as vertex colour unless it has one. */
  add(geo: THREE.BufferGeometry, material: THREE.Material, colour?: number, m?: THREE.Matrix4): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const coloured = material === VMAT.paint || material === VMAT.gloss || material === VMAT.canvas;
    if (coloured && !g.getAttribute('color')) {
      COLOUR.setHex(colour ?? 0xffffff, THREE.SRGBColorSpace);
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.set([COLOUR.r, COLOUR.g, COLOUR.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (material !== VMAT.glass && g.getAttribute('uv')) {
      g = g.clone();
      g.deleteAttribute('uv');
    }
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return this;
  }

  /** A box centred at (x, y, z), optionally turned about y. */
  box(w: number, h: number, l: number, material: THREE.Material, colour: number | undefined, x: number, y: number, z: number, yaw = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, l), material, colour, place(x, y, z, yaw));
  }

  /** A cylinder between two points. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, material: THREE.Material, colour?: number, seg = 8): this {
    const len = a.distanceTo(b);
    if (len < 1e-6) return this;
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1), material, colour, m);
  }

  /** A tube along a polyline (rails, rubbing strakes, fender lines). */
  tube(points: THREE.Vector3[], r: number, material: THREE.Material, colour?: number, closed = false): this {
    if (points.length < 2) return this;
    const path = new THREE.CurvePath<THREE.Vector3>();
    const pts = closed ? [...points, points[0]!] : points;
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1]!, pts[i]!));
    return this.add(new THREE.TubeGeometry(path, Math.max(2, pts.length * 2), r, 6, false), material, colour);
  }

  build(name: string): THREE.Group {
    const out = new THREE.Group();
    out.name = name;
    for (const [mat, geos] of this.parts) {
      const names = Object.keys(geos[0]!.attributes).filter((n) => geos.every((g) => g.getAttribute(n)));
      const clean = geos.map((g) => {
        const extra = Object.keys(g.attributes).filter((n) => !names.includes(n));
        if (!extra.length) return g;
        const c = g.clone();
        for (const n of extra) c.deleteAttribute(n);
        return c;
      });
      const merged = mergeGeometries(clean, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}-${mat === VMAT.glass ? 'glass' : mat === VMAT.paint || mat === VMAT.gloss ? 'body' : 'fittings'}`;
      out.add(mesh);
    }
    if (this.parts.has(VMAT.glass)) applyGlass();
    return out;
  }
}

export function place(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ hull

export interface HullSpec {
  length: number;
  beam: number;
  /** Waterline to sheer amidships, and waterline to the bottom of the hull (m). */
  freeboard: number;
  draft: number;
  /** Extra sheer height at the bow and the stern (m). */
  sheerBow?: number;
  sheerStern?: number;
  /** How far the stem's top is ahead of its foot (m). */
  stemRake?: number;
  /** Share of the length over which the bow narrows; stern half-breadth as a share of the beam's. */
  entry?: number;
  transom?: number;
  /** How far the transom's foot is aft of its top (m; > 0 the usual rake). */
  transomRake?: number;
  /** Bottom angle (rad) amidships; a hard chine (planing hull) or round bilge. */
  deadrise?: number;
  chine?: boolean;
  /** Extra half-breadth at the sheer over the waterline's, as a share. */
  flare?: number;
  /** How much the keel line rises towards the stern (share of the draft): an immersed transom keeps it 0. */
  sternRise?: number;
  /** Bulwark above the deck (m); the deck is that far below the sheer. */
  bulwark?: number;
  camber?: number;
  colours: { bottom: number; boot: number; topsides: number; stripe?: number; deck: number; bulwarkInside?: number };
  /** Boot top height above the waterline, and the stripe (from, to) below the sheer (m). */
  bootTop?: number;
  stripe?: [number, number];
  /** A barge or pontoon: square sections, flat bottom, raked ends ("spoon" ends) at both ends. */
  pontoon?: boolean;
}

export interface Hull {
  /** Sheer height and deck height at z, and the deck's half-breadth there. */
  sheer(z: number): number;
  deck(z: number): number;
  half(z: number): number;
  /** Points along the sheer, one side (+1 starboard). */
  sheerLine(side: number, inset?: number, from?: number, to?: number): THREE.Vector3[];
  length: number;
}

const STATIONS = 40;
const SECTION = 18;

/** Loft a hull (shell, transom, deck, bulwarks) into the kit; returns its measurements for placing parts. */
export function hull(kit: Kit, s: HullSpec, material: THREE.Material = VMAT.paint): Hull {
  const L = s.length;
  const B = s.beam / 2;
  const entry = s.entry ?? 0.38;
  const tr = s.transom ?? 0.8;
  const flare = s.flare ?? 0.08;
  const bulwark = s.bulwark ?? 0;
  const camber = s.camber ?? Math.min(0.15, s.beam * 0.02);
  const boot = s.bootTop ?? 0.12;
  const half = (t: number) => {
    if (s.pontoon) return B * (t < 0.04 ? 0.92 + 2 * t : t > 0.96 ? 0.92 + 2 * (1 - t) : 1);
    const fwd = t < entry ? Math.pow(Math.sin((Math.PI / 2) * (t / entry)), 0.62) : 1;
    const aft = t > 0.62 ? 1 - (1 - tr) * Math.pow((t - 0.62) / 0.38, 1.7) : 1;
    return Math.max(0.002, B * fwd * aft);
  };
  const sheer = (t: number) =>
    s.freeboard + (s.sheerBow ?? 0) * Math.pow(Math.max(0, 1 - t / 0.55), 2) + (s.sheerStern ?? 0) * Math.pow(Math.max(0, (t - 0.55) / 0.45), 2);
  const keel = (t: number) => {
    if (s.pontoon) return s.draft * (0.25 + 0.75 * smooth(0, 0.12, t) * smooth(1, 0.88, t));
    const fwd = 0.12 + 0.88 * smooth(0, entry * 0.95, t);
    return s.draft * fwd * (1 - (s.sternRise ?? 0) * smooth(0.7, 1, t));
  };
  const zOf = (t: number, frac: number) => {
    let z = -L / 2 + t * L;
    if (s.pontoon) {
      // Spoon ends: the bottom is shorter than the deck at both ends.
      const r = (1 - frac) * Math.min(3, L * 0.08);
      if (t < 0.12) z += r * Math.pow(1 - t / 0.12, 2);
      if (t > 0.88) z -= r * Math.pow((t - 0.88) / 0.12, 2);
      return z;
    }
    if (t < 0.4) z += (s.stemRake ?? 0) * (1 - frac) * Math.pow(1 - t / 0.4, 2);
    if (t > 0.88) z += (s.transomRake ?? 0) * (0.5 - frac) * smooth(0.88, 1, t);
    return z;
  };
  /** Section point at station t, s = 0 (keel) … 1 (sheer), side ±1. */
  const point = (t: number, u: number, side: number, out: THREE.Vector3) => {
    const bD = half(t);
    const bW = bD / (1 + flare);
    const k = keel(t);
    const h = sheer(t);
    let x: number;
    let y: number;
    if (s.pontoon) {
      // Flat bottom, a small radius at the bilge, plumb sides.
      const bottomW = bW * 0.94;
      if (u < 0.35) {
        x = bottomW * (u / 0.35);
        y = -k;
      } else if (u < 0.5) {
        const a = ((u - 0.35) / 0.15) * (Math.PI / 2);
        x = bottomW + (bD - bottomW) * Math.sin(a);
        y = -k + (bD - bottomW) * (1 - Math.cos(a));
      } else {
        x = bD;
        y = -k + (bD - bottomW) + ((u - 0.5) / 0.5) * (h + k - (bD - bottomW));
      }
    } else if (s.chine) {
      // Hard chine: a straight vee bottom (steeper forward), flared topsides above the chine.
      const dr = (s.deadrise ?? 0.3) + (0.75 - (s.deadrise ?? 0.3)) * (1 - smooth(0, entry, t));
      const bc = bW * 0.96;
      const yc = Math.min(-0.02, -k + bc * Math.tan(dr));
      if (u < 0.5) {
        const f = u / 0.5;
        x = bc * f;
        y = -k + (yc + k) * f;
      } else {
        const f = (u - 0.5) / 0.5;
        x = bc + (bD - bc) * Math.pow(f, 0.8);
        y = yc + (h - yc) * f;
      }
    } else {
      // Round bilge, a little hollow at the garboard, flaring to the sheer.
      const th = u * (Math.PI / 2);
      const b = bW + (bD - bW) * Math.pow(u, 2);
      x = b * Math.pow(Math.sin(th), 0.55 + 0.3 * (s.deadrise ?? 0.2));
      y = -k * Math.cos(th) + h * Math.pow(1 - Math.cos(th), 0.9);
    }
    return out.set(side * x, y, zOf(t, Math.min(1, Math.max(0, (y + k) / (h + k)))));
  };
  const colourAt = (y: number, h: number): number => {
    if (y < 0) return s.colours.bottom;
    if (y < boot) return s.colours.boot;
    if (s.stripe && y > h - s.stripe[0] && y < h - s.stripe[1]) return s.colours.stripe ?? s.colours.boot;
    return s.colours.topsides;
  };

  // Shell: each side keel to sheer, stations bow to stern.
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const push = (p: THREE.Vector3, hex: number) => {
    pos.push(p.x, p.y, p.z);
    COLOUR.setHex(hex, THREE.SRGBColorSpace);
    col.push(COLOUR.r, COLOUR.g, COLOUR.b);
    return pos.length / 3 - 1;
  };
  const N = STATIONS;
  const M = SECTION;
  for (let side = -1; side <= 1; side += 2) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const h = sheer(t);
      for (let j = 0; j <= M; j++) {
        point(t, j / M, side, v);
        push(v, colourAt(v.y, h));
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = base + i * (M + 1) + j;
        const b = a + M + 1;
        // Outward faces (counter-clockwise seen from outside).
        if (side > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  // Transom: the stern section closed up each side and across under the deck edge.
  {
    const t = 1;
    const h = sheer(t);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j <= M; j++) ring.push(point(t, j / M, -1, new THREE.Vector3()));
    const bD = half(t);
    for (let k = 1; k < 8; k++) {
      const x = -bD + (2 * bD * k) / 8;
      ring.push(new THREE.Vector3(x, h + camber * 0.5 * (1 - (x / bD) ** 2), zOf(t, 1)));
    }
    for (let j = M; j >= 0; j--) ring.push(point(t, j / M, 1, new THREE.Vector3()));
    const c = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(ring.length);
    const ci = push(c, colourAt(c.y, h));
    const ids = ring.map((p) => push(p, colourAt(p.y, h)));
    for (let k = 0; k < ids.length - 1; k++) idx.push(ci, ids[k + 1]!, ids[k]!);
    if (s.pontoon) {
      // Bow end too (both ends are alike).
      const ring2: THREE.Vector3[] = [];
      for (let j = 0; j <= M; j++) ring2.push(point(0, j / M, -1, new THREE.Vector3()));
      for (let j = M; j >= 0; j--) ring2.push(point(0, j / M, 1, new THREE.Vector3()));
      const c2 = ring2.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(ring2.length);
      const c2i = push(c2, colourAt(c2.y, sheer(0)));
      const ids2 = ring2.map((p) => push(p, colourAt(p.y, sheer(0))));
      for (let k = 0; k < ids2.length - 1; k++) idx.push(c2i, ids2[k]!, ids2[k + 1]!);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  kit.add(shell, material);

  // Deck: across from sheer to sheer (below it by the bulwark), cambered.
  const dp: number[] = [];
  const di: number[] = [];
  const C = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bD = half(t) - (bulwark > 0 ? 0.06 : 0);
    const y0 = sheer(t) - bulwark;
    for (let c = 0; c <= C; c++) {
      const x = -bD + (2 * bD * c) / C;
      dp.push(x, y0 + camber * (1 - (x / Math.max(bD, 1e-3)) ** 2), zOf(t, 1 - bulwark / Math.max(0.3, sheer(t) + keel(t))));
    }
    if (i < N) for (let c = 0; c < C; c++) {
      const a = i * (C + 1) + c;
      di.push(a, a + C + 1, a + 1, a + 1, a + C + 1, a + C + 2);
    }
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deck.setIndex(di);
  deck.computeVertexNormals();
  kit.add(deck, VMAT.paint, s.colours.deck);
  // Bulwarks: the inside face, and a capping rail along the top.
  if (bulwark > 0) {
    for (const side of [-1, 1]) {
      const bp: number[] = [];
      const bi: number[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const bD = half(t) - 0.06;
        const h = sheer(t);
        const z = zOf(t, 1);
        bp.push(side * bD, h, z, side * bD, h - bulwark, z);
        // Facing inboard.
        if (i < N) {
          if (side > 0) bi.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
          else bi.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      g.setIndex(bi);
      g.computeVertexNormals();
      kit.add(g, VMAT.paint, s.colours.bulwarkInside ?? s.colours.topsides);
    }
  }
  const tOf = (z: number) => Math.min(1, Math.max(0, (z + L / 2) / L));
  return {
    length: L,
    sheer: (z) => sheer(tOf(z)),
    deck: (z) => sheer(tOf(z)) - bulwark + camber,
    half: (z) => half(tOf(z)),
    sheerLine: (side, inset = 0, from = 0, to = 1) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = from + ((to - from) * i) / 24;
        pts.push(new THREE.Vector3(side * Math.max(0, half(t) - inset), sheer(t), zOf(t, 1)));
      }
      return pts;
    },
  };
}

// ------------------------------------------------------------------ superstructure

export interface CabinSpec {
  /** Centre (x, z) of the plan, and the height of its base. */
  x?: number;
  z: number;
  y: number;
  length: number;
  width: number;
  height: number;
  /** Corner radii in plan: front and back (front up to width / 2 for a rounded front). */
  rFront?: number;
  rBack?: number;
  /** Inset of the top's front (raked windscreen) and sides (tumblehome) (m). */
  rake?: number;
  tumble?: number;
  colour: number;
  /** Window band as shares of the height (bottom, top), and a deeper band at the front (windscreen). */
  windows?: [number, number];
  front?: [number, number];
  /** Windows only on the sides and front (not the back), or none at the back and sides (a console). */
  noBackWindows?: boolean;
  /** Roof overhang (m), thickness and colour. */
  roof?: { overhang: number; thickness: number; colour?: number };
  material?: THREE.Material;
}

function roundedPlan(w: number, l: number, rf: number, rb: number, n = 6): THREE.Vector2[] {
  // Counter-clockwise seen from above (x right, z down the page = aft): front at -z.
  const hw = w / 2;
  const hl = l / 2;
  rf = Math.min(rf, hw, hl);
  rb = Math.min(rb, hw, hl);
  const pts: THREE.Vector2[] = [];
  const arc = (cx: number, cz: number, r: number, a0: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cz + r * Math.sin(a)));
    }
  };
  arc(hw - rb, hl - rb, rb, 0); // aft starboard
  arc(-hw + rb, hl - rb, rb, Math.PI / 2); // aft port
  arc(-hw + rf, -hl + rf, rf, Math.PI); // fore port
  arc(hw - rf, -hl + rf, rf, (3 * Math.PI) / 2); // fore starboard
  return pts;
}

/** A superstructure: walls lofted from a rounded plan to a raked, inset top, a framed window band, a roof. */
export function cabin(kit: Kit, s: CabinSpec): void {
  const P = roundedPlan(s.width, s.length, s.rFront ?? 0.3, s.rBack ?? 0.2);
  const cx = s.x ?? 0;
  const zMin = -s.length / 2;
  const rake = s.rake ?? 0;
  const tumble = s.tumble ?? 0;
  const top = (p: THREE.Vector2, f: number) => {
    // At height share f: sides drawn in by the tumblehome, the front drawn aft by the rake.
    const sx = (s.width / 2 - tumble * f) / (s.width / 2);
    const fwd = 1 - (p.y - zMin) / s.length;
    return new THREE.Vector3(cx + p.x * sx, s.y + s.height * f, s.z + p.y + rake * f * Math.pow(fwd, 1.5));
  };
  const n = P.length;
  const normals = P.map((p, i) => {
    const a = P[(i - 1 + n) % n]!;
    const b = P[(i + 1) % n]!;
    return new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
  });
  const win = s.windows ?? [0.45, 0.85];
  const band = (i: number): [number, number] | undefined => {
    const nz = normals[i]!.y;
    if (s.noBackWindows && nz > 0.5) return undefined;
    return nz < -0.6 && s.front ? s.front : win;
  };
  const paint = s.material ?? VMAT.paint;
  // Walls in three bands (below, window, above) per outline segment; the window band is glass.
  const wallPos: number[] = [];
  const glassPos: number[] = [];
  const glassUv: number[] = [];
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % n]!;
    const seg = a.distanceTo(b);
    const ba = band(i);
    const bb = band((i + 1) % n);
    const fa = ba ?? [1, 1];
    const fb = bb ?? [1, 1];
    const quad = (out: number[], f0a: number, f1a: number, f0b: number, f1b: number, outset = 0) => {
      const na = normals[i]!;
      const nb = normals[(i + 1) % n]!;
      const A0 = top(a, f0a).add(new THREE.Vector3(na.x * outset, 0, na.y * outset));
      const A1 = top(a, f1a).add(new THREE.Vector3(na.x * outset, 0, na.y * outset));
      const B0 = top(b, f0b).add(new THREE.Vector3(nb.x * outset, 0, nb.y * outset));
      const B1 = top(b, f1b).add(new THREE.Vector3(nb.x * outset, 0, nb.y * outset));
      // Facing out of the plan.
      out.push(...A0.toArray(), ...B1.toArray(), ...B0.toArray(), ...A0.toArray(), ...A1.toArray(), ...B1.toArray());
    };
    quad(wallPos, 0, fa[0], 0, fb[0]);
    quad(wallPos, fa[1], 1, fb[1], 1);
    if (ba && bb) {
      quad(glassPos, fa[0], fa[1], fb[0], fb[1], 0.004);
      const u0 = arc / 1.1;
      const u1 = (arc + seg) / 1.1;
      glassUv.push(u0, 0, u1, 1, u1, 0, u0, 0, u0, 1, u1, 1);
    } else quad(wallPos, fa[0], fa[1], fb[0], fb[1]);
    arc += seg;
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  walls.computeVertexNormals();
  kit.add(walls, paint, s.colour);
  if (glassPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(glassUv, 2));
    g.computeVertexNormals();
    kit.add(g, VMAT.glass);
  }
  // Roof: the top outline (with an overhang and thickness).
  const roof = s.roof ?? { overhang: 0.08, thickness: 0.08 };
  const outline = P.map((p, i) => {
    const t = top(p, 1);
    return new THREE.Vector2(t.x + normals[i]!.x * roof.overhang, t.z + normals[i]!.y * roof.overhang);
  });
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y)));
  const slab = new THREE.ExtrudeGeometry(shape, { depth: roof.thickness, bevelEnabled: false });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, s.y + s.height, 0);
  kit.add(slab, paint, roof.colour ?? s.colour);
}

// ------------------------------------------------------------------ fittings

/** Guard rail: a top rail and a mid rail (tubes) on stanchions along a run of points at deck level. */
export function rail(kit: Kit, pts: THREE.Vector3[], height: number, opts: { spacing?: number; mid?: boolean; material?: THREE.Material; colour?: number; r?: number } = {}): void {
  const m = opts.material ?? VMAT.steel;
  const up = (p: THREE.Vector3, h: number) => p.clone().add(new THREE.Vector3(0, h, 0));
  kit.tube(pts.map((p) => up(p, height)), opts.r ?? 0.022, m, opts.colour);
  if (opts.mid !== false) kit.tube(pts.map((p) => up(p, height * 0.5)), (opts.r ?? 0.022) * 0.55, m, opts.colour);
  const spacing = opts.spacing ?? 1.4;
  let acc = spacing;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += pts[i]!.distanceTo(pts[i - 1]!);
    if (acc >= spacing || i === pts.length - 1) {
      kit.rod(pts[i]!, up(pts[i]!, height), (opts.r ?? 0.022) * 0.85, m, opts.colour, 6);
      acc = 0;
    }
  }
}

/** A lifebuoy, orange with white bands, facing outboard (side ±1) on a wall at (x, y, z). */
export function lifebuoy(kit: Kit, x: number, y: number, z: number, side: number): void {
  const g = new THREE.TorusGeometry(0.3, 0.075, 8, 20);
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  const o = new THREE.Color().setHex(0xe8541c, THREE.SRGBColorSpace);
  const w = new THREE.Color().setHex(0xf2f2ee, THREE.SRGBColorSpace);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const band = Math.abs(Math.sin(2 * a)) > 0.9 ? w : o;
    c.set([band.r, band.g, band.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  kit.add(g, VMAT.paint, undefined, place(x, y, z, side * (Math.PI / 2)));
}

const LIGHTS = new Map<number, THREE.MeshStandardMaterial>();
const LIGHT_GEO = new THREE.SphereGeometry(0.1, 8, 6);
/** Every vessel's lights on (at dusk) or off. */
export function setLightsOn(on: boolean): void {
  for (const m of LIGHTS.values()) m.emissiveIntensity = on ? 3 : 0;
}

/** Navigation and signal lights on a mast (lit at dusk by setLightsOn). */
export function navLights(group: THREE.Group, o: { length: number; beam: number; mastY: number; mastZ?: number; sideY?: number; ram?: boolean }): void {
  const lights = new THREE.Group();
  lights.name = 'lights';
  const add = (hex: number, x: number, y: number, z: number) => {
    let m = LIGHTS.get(hex);
    if (!m) LIGHTS.set(hex, (m = new THREE.MeshStandardMaterial({ color: 0x151515, emissive: hex, emissiveIntensity: 0 })));
    const l = new THREE.Mesh(LIGHT_GEO, m);
    l.position.set(x, y, z);
    lights.add(l);
  };
  const mz = o.mastZ ?? -o.length * 0.1;
  const sy = o.sideY ?? o.mastY * 0.55;
  add(0xff2020, -o.beam / 2 + 0.15, sy, mz + 0.4);
  add(0x20ff40, o.beam / 2 - 0.15, sy, mz + 0.4);
  add(0xffffff, 0, o.mastY, mz);
  add(0xffffff, 0, sy * 0.8, o.length / 2 - 0.15);
  // Restricted in her ability to manoeuvre: red, white, red all-round lights in a vertical line.
  if (o.ram) for (const [i, hex] of [0xff2020, 0xffffff, 0xff2020].entries()) add(hex, 0, o.mastY + 0.5 + i * 0.5, mz);
  group.add(lights);
}

/** A mast with a cross-tree, VHF aerial and (optionally) a radar scanner. */
export function mast(kit: Kit, x: number, y: number, z: number, h: number, opts: { radar?: boolean; colour?: number } = {}): void {
  kit.rod(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + h, z), 0.05, VMAT.paint, opts.colour ?? 0xe9e9e4, 8);
  kit.box(0.9, 0.06, 0.08, VMAT.paint, opts.colour ?? 0xe9e9e4, x, y + h * 0.7, z);
  kit.rod(new THREE.Vector3(x + 0.35, y + h * 0.7, z), new THREE.Vector3(x + 0.35, y + h * 0.7 + 1.4, z), 0.012, VMAT.paint, 0xf2f2ee, 4);
  if (opts.radar) {
    kit.box(1.2, 0.12, 0.18, VMAT.paint, 0xf2f2ee, x, y + h * 0.55, z - 0.05);
    kit.box(0.25, 0.25, 0.25, VMAT.paint, 0x2b2e33, x, y + h * 0.55 - 0.18, z);
  }
}

/** A heavy rubber D-fender along a line (tugs, work boats). */
export function fenderLine(kit: Kit, pts: THREE.Vector3[], r = 0.14): void {
  kit.tube(pts, r, VMAT.rubber);
}

/** An outboard engine (cowling, leg, cavitation plate) hung on a transom at (x, y, z), facing forward. */
export function outboard(kit: Kit, x: number, y: number, z: number, colour = 0x1d1f22): void {
  const cowl = new THREE.CapsuleGeometry(0.22, 0.35, 4, 10);
  cowl.scale(0.9, 1, 1.25);
  kit.add(cowl, VMAT.gloss, colour, place(x, y + 0.45, z + 0.35));
  kit.box(0.14, 0.75, 0.22, VMAT.paint, colour, x, y - 0.15, z + 0.3);
  kit.box(0.42, 0.03, 0.4, VMAT.paint, colour, x, y - 0.42, z + 0.3);
  kit.add(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), VMAT.paint, 0x2b2e33, place(x, y - 0.55, z + 0.3, 0, Math.PI / 2));
}

// ------------------------------------------------------------------ cars and people

const CAR_COLOURS = [0xd9dadb, 0x1c1d1f, 0x8a8f96, 0x2a4f8a, 0x9b1c1c, 0xf2f2f2, 0x3b5d3b, 0x5a5f66, 0x6d2a2a, 0xb6b9bd];

/** A car on a deck at (x, y, z) heading along -z: a body from its side profile, glasshouse, wheels, lights. */
export function car(kit: Kit, x: number, y: number, z: number, seed: number): void {
  const type = seed % 4; // hatchback, saloon, SUV, van
  const len = [4.1, 4.7, 4.6, 5.0][type]!;
  const w = [1.75, 1.8, 1.88, 1.95][type]!;
  const roofH = [1.45, 1.42, 1.68, 1.95][type]!;
  const colour = CAR_COLOURS[(seed * 7) % CAR_COLOURS.length]!;
  // Side profile (z along the car from the front, y up): bonnet, screen, roof, back.
  const L = len;
  const prof: [number, number][] =
    type === 3
      ? [[0, 0.32], [0, 0.75], [0.25, 1.0], [0.75, roofH], [L, roofH], [L, 0.32]]
      : type === 1
        ? [[0, 0.32], [0, 0.72], [0.95, 0.85], [1.75, roofH], [3.4, roofH], [4.2, 0.98], [L, 0.92], [L, 0.32]]
        : type === 2
          ? [[0, 0.38], [0, 0.85], [0.9, 1.0], [1.55, roofH], [L - 0.15, roofH], [L, 1.1], [L, 0.38]]
          : [[0, 0.32], [0, 0.72], [0.85, 0.85], [1.55, roofH], [L - 0.35, roofH], [L, 0.95], [L, 0.32]];
  const shape = new THREE.Shape(prof.map(([pz, py]) => new THREE.Vector2(pz, py)));
  const bodyG = new THREE.ExtrudeGeometry(shape, { depth: w - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
  // Extruded along +z in shape space: turn so the profile's z runs along the car (-z forward) and depth across.
  // The profile's length runs aft from the front (-z), the extrusion across the car.
  const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x + (w - 0.12) / 2, y, z - L / 2));
  kit.add(bodyG, VMAT.gloss, colour, m);
  // Glasshouse: a darker band set into the upper body.
  const gy = type === 3 ? 1.05 : 0.95;
  kit.box(w + 0.01, (roofH - gy) * 0.75, (type === 3 ? 1.2 : L * 0.5), VMAT.glass, undefined, x, y + gy + (roofH - gy) * 0.4, z - L / 2 + (type === 3 ? 0.9 : L * 0.5));
  // Wheels, lights.
  for (const sx of [-1, 1]) {
    for (const wz of [0.8, L - 0.85]) {
      kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14), VMAT.rubber, undefined, place(x + sx * (w / 2 - 0.08), y + 0.33, z - L / 2 + wz, 0, 0, Math.PI / 2));
    }
    kit.box(0.28, 0.1, 0.05, VMAT.paint, 0xf5f2e6, x + sx * (w / 2 - 0.3), y + 0.7, z - L / 2 - 0.05);
    kit.box(0.24, 0.12, 0.05, VMAT.paint, 0xa0141a, x + sx * (w / 2 - 0.3), y + 0.85, z + L / 2 + 0.05);
  }
}
