import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BoatParams } from '../sim/boat/params';
import type { SquibTypeId } from '../sim/boat/squib';
import { CrewFigure, bodyFrame, type BodyFrame, type CrewPose } from './crew';
import { Burgee, BURGEE_STICK } from './burgee';
import { nonSlipTexture, sailTexture, transomTexture, woodTexture } from './squibTextures';

/**
 * Procedural Squib. Principal dimensions come from the class data (LOA, beam, draft, mast, boom, sail
 * areas); the hull lines, keel and rudder shapes, deck layout and fittings are ESTIMATED (no lines plan or
 * measured drawings are available, docs/MISSING_INFORMATION.md B2-B4) and drawn to look like a Squib, not
 * measured from one. The three types (data/boats/squib/variants.json) differ where their builds do: a raised
 * self-draining floor with transom outlets (Rondar) or a deeper cockpit with wooden floorboards and trim
 * (Hunter and Parker), and the new sail package's windows and draft stripes. Every boat flies the RDYC burgee
 * and carries RDYC on its transom.
 *
 * Model frame: x = starboard, y = up (0 = waterline), z = aft. Origin at the centre of gravity.
 */

export interface SailShapeInput {
  /** Sail angle (rad, > 0 = to port). */
  angle: number;
  /** 0 = flogging … 1 = drawing. */
  luff: number;
  /** +1 if the wind fills the sail from starboard (sail bellies to port), -1 otherwise. */
  side: number;
  /** Leech-first flow (by the lee): sail inverts. */
  inverted: boolean;
}

export interface SquibModelOptions {
  type?: SquibTypeId;
  /** Text on the transom. */
  transom?: string;
}

/** Draws nothing; marks each boat's deck outline in the stencil so the water is not drawn inside the hull. */
export const WATER_MASK_ORDER = 1;
const WATER_MASK_MATERIAL = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const BOW_Z = -2.95;
const MAST_Z = -0.55;
const GOOSENECK_Y = 1.3;
const HOUNDS_Y = 6.3;
const SPREADER_Y = 3.6;
/** Cockpit opening (z from … to) and half-width; the same estimate as the physics' cockpit (calibration). */
const COCKPIT_FROM = -0.2;
const COCKPIT_TO = 2.3;
const COCKPIT_HALF = 0.53;
const DECK_CAMBER = 0.035;
/** Where the helm and crew sit (z, m aft of the centre of gravity) and the toe straps (x, each side). */
const HELM_Z = 1.45;
const CREW_Z = 0.5;
const STRAP_X = 0.16;
/** The tiller extension (m) and its universal joint at the tiller's end, in the rudder's frame. */
const EXTENSION = 0.95;
const EXTENSION_PIVOT = new THREE.Vector3(0, 0.68, -1.03);
const STATIONS = 64;
const SECTION = 22;

// Hull colours (sRGB), as the hull's vertex colours and the transom texture.
const TOPSIDES = '#f5f5f2';
const SHEER_STRIPE = '#1f4e79';
const BOOT_TOP = '#1f4e79';
const ANTIFOULING = '#6b1d1d';
const BOOT: [number, number] = [0.025, 0.07];
const STRIPE_DROP: [number, number] = [0.095, 0.035];

/** Materials shared by every boat (the hull's is cloned per boat for its tint). */
const MAT = {
  hull: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25, side: THREE.DoubleSide }),
  deck: new THREE.MeshStandardMaterial({ color: 0xe4dfd2, roughness: 0.85, side: THREE.DoubleSide }),
  well: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8, side: THREE.DoubleSide }),
  greySole: new THREE.MeshStandardMaterial({ color: 0x8e9290, roughness: 0.9 }),
  keel: new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.7 }),
  rudder: new THREE.MeshPhysicalMaterial({ color: 0xf1efe8, roughness: 0.35, clearcoat: 0.6 }),
  spar: new THREE.MeshStandardMaterial({ color: 0xc3c7cc, metalness: 0.75, roughness: 0.32 }),
  darkSpar: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.4, roughness: 0.45 }),
  wire: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.25 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xd5d9dd, metalness: 0.9, roughness: 0.2 }),
  black: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }),
  rope: new THREE.MeshStandardMaterial({ color: 0x2f5f9a, roughness: 0.9 }),
  ropeRed: new THREE.MeshStandardMaterial({ color: 0xb5332b, roughness: 0.9 }),
  strap: new THREE.MeshStandardMaterial({ color: 0x2d4a6d, roughness: 0.9 }),
  rubbing: new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.55 }),
  varnish: new THREE.MeshPhysicalMaterial({ color: 0xc8a684, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 }),
  tiller: new THREE.MeshPhysicalMaterial({ color: 0xc8a684, roughness: 0.4, clearcoat: 1 }),
  water: new THREE.MeshPhysicalMaterial({ color: 0x3f7c86, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.72, depthWrite: false }),
};
let texturesApplied = false;
function applyTextures(): void {
  if (texturesApplied || typeof document === 'undefined') return;
  texturesApplied = true;
  const ns = nonSlipTexture();
  ns.repeat.set(6, 6);
  MAT.deck.bumpMap = ns;
  MAT.deck.bumpScale = 0.6;
  MAT.greySole.bumpMap = ns;
  MAT.greySole.bumpScale = 0.8;
  MAT.varnish.map = woodTexture();
  MAT.tiller.map = woodTexture();
  for (const m of [MAT.deck, MAT.greySole, MAT.varnish, MAT.tiller]) m.needsUpdate = true;
}

function linear(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

/** A cylinder between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 6): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg, 1), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** NACA four-digit symmetric thickness at chord fraction x (thickness ratio t). */
function nacaHalf(x: number, t: number): number {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/**
 * A foil lofted between spanwise stations (root to tip): each station has a leading-edge z, height y and
 * chord; sections are NACA 00xx. Closed at the tip.
 */
function foil(stations: { z: number; y: number; chord: number }[], thickness: number, mat: THREE.Material): THREE.Mesh {
  const K = 14;
  const xs = Array.from({ length: K + 1 }, (_, i) => (1 - Math.cos((Math.PI * i) / K)) / 2);
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = 2 * K;
  for (const s of stations) {
    for (let i = 0; i < ring; i++) {
      const top = i <= K;
      const x = top ? xs[i]! : xs[2 * K - i]!;
      const half = nacaHalf(x, thickness) * s.chord;
      pos.push(top ? half : -half, s.y, s.z + x * s.chord);
    }
  }
  for (let j = 0; j < stations.length - 1; j++) {
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      idx.push(a, a + ring, b, b, a + ring, b + ring);
    }
  }
  const tip = stations.length - 1;
  const centre = pos.length / 3;
  const ts = stations[tip]!;
  pos.push(0, ts.y - 0.01, ts.z + ts.chord * 0.35);
  for (let i = 0; i < ring; i++) idx.push(tip * ring + i, centre, tip * ring + ((i + 1) % ring));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

interface StaticParts {
  group: THREE.Group;
  mastTopY: number;
}

const staticCache = new Map<string, StaticParts>();

export class SquibModel {
  readonly group = new THREE.Group();
  readonly type: SquibTypeId;
  private readonly boom = new THREE.Group();
  private readonly rudder = new THREE.Group();
  private readonly extension = new THREE.Group();
  private readonly crew: CrewFigure[] = [];
  private readonly mainGeo: THREE.BufferGeometry;
  private readonly jibGeo: THREE.BufferGeometry;
  private readonly sheets: { geo: THREE.BufferGeometry; pts: number }[] = [];
  private readonly telltales: THREE.Mesh[] = [];
  private readonly burgee = new Burgee();
  private readonly water: THREE.Mesh;
  private readonly p: BoatParams;
  private readonly mastTopY: number;
  private readonly sternZ: number;
  private readonly soleY: number;
  /** The crew's lateral position at the last frame, its smoothed rate and how much they are crossing. */
  private readonly crewState = { y: NaN, t: NaN, rate: 0, moving: 0, side: 1 };
  readonly anchors: { mainCE: THREE.Vector3; jibCE: THREE.Vector3; keel: THREE.Vector3; rudder: THREE.Vector3; bow: THREE.Vector3; masthead: THREE.Vector3 };

  private static readonly MAIN_U = 14;
  private static readonly MAIN_V = 24;
  private static readonly JIB_U = 12;
  private static readonly JIB_V = 20;

  constructor(p: BoatParams, opts: SquibModelOptions = {}) {
    applyTextures();
    this.p = p;
    this.type = opts.type ?? 'rondar';
    this.sternZ = BOW_Z + p.loa;
    this.soleY = this.classic ? sheerAt(0.7) - 0.36 : sheerAt(0.7) - 0.22;
    this.group.name = 'squib';

    const key = `${this.type}:${opts.transom ?? 'RDYC'}:${p.loa}:${p.beam}:${p.draft}:${p.mastLength}:${p.main.foot}`;
    let parts = staticCache.get(key);
    if (!parts) staticCache.set(key, (parts = this.buildStatic(opts.transom ?? 'RDYC')));
    this.group.add(parts.group.clone());
    this.mastTopY = parts.mastTopY;

    this.buildRudder();
    this.group.add(this.rudder);
    this.buildBoom();
    this.group.add(this.boom);

    const pkg = this.type === 'new-sails' ? 'new' : 'standard';
    const sailMat = (kind: 'main' | 'jib') =>
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, side: THREE.DoubleSide, map: typeof document === 'undefined' ? null : sailTexture({ kind, package: pkg }) });
    this.mainGeo = this.gridGeometry(SquibModel.MAIN_U, SquibModel.MAIN_V);
    this.jibGeo = this.gridGeometry(SquibModel.JIB_U, SquibModel.JIB_V);
    const main = new THREE.Mesh(this.mainGeo, sailMat('main'));
    main.castShadow = true;
    main.name = 'mainsail';
    const jib = new THREE.Mesh(this.jibGeo, sailMat('jib'));
    jib.castShadow = true;
    jib.name = 'jib';
    this.group.add(main, jib);

    // Sheets as thin lines that move: the jib sheet from the clew through the leeward fairlead to the crew's
    // hand; the mainsheet tackle from the boom to the traveller car, and its tail to the helm's hand.
    for (const [count, colour] of [[3, 0x2f5f9a], [7, 0x8a8f96]] as const) {
      const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: count }, () => new THREE.Vector3()));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour }));
      line.frustumCulled = false;
      this.sheets.push({ geo, pts: count });
      this.group.add(line);
    }
    // Jib luff telltales (streaming wool), windward and leeward at three heights.
    const ttGeo = new THREE.PlaneGeometry(0.16, 0.012);
    ttGeo.translate(0.08, 0, 0);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(ttGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd32f2f : 0x2e7d32, side: THREE.DoubleSide }));
      t.name = 'telltale';
      this.telltales.push(t);
      this.group.add(t);
    }

    this.burgee.group.position.set(0, this.mastTopY + 0.02, MAST_Z);
    this.group.add(this.burgee.group);

    // Water shipped into the cockpit: a level, translucent surface on the floor (shown when there is some).
    const wGeo = new THREE.PlaneGeometry(1, 1);
    wGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wGeo, MAT.water);
    this.water.name = 'cockpit-water';
    this.water.visible = false;
    this.water.renderOrder = WATER_MASK_ORDER + 2;
    this.group.add(this.water);

    for (const role of ['helm', 'crew'] as const) {
      const c = new CrewFigure(role);
      this.crew.push(c);
      this.group.add(c.group);
    }

    this.anchors = {
      mainCE: new THREE.Vector3(),
      jibCE: new THREE.Vector3(),
      keel: new THREE.Vector3(0, -p.clrDepth, -p.lateral.x),
      rudder: new THREE.Vector3(0, -0.3, -p.rudder.x),
      bow: new THREE.Vector3(0, 0.3, BOW_Z),
      masthead: new THREE.Vector3(0, this.mastTopY + 0.4, MAST_Z),
    };
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name !== 'cockpit-water' && o.name !== 'telltale') o.castShadow = true;
    });
    // Added after the shadow pass setup: the mask draws nothing and must cast no shadow.
    this.group.add(this.buildWaterMask());
  }

  private get classic(): boolean {
    return this.type === 'classic';
  }

  // ------------------------------------------------------------------ hull

  /** Half-breadth at the sheer, depth of the canoe body, and sheer height along t = 0 (bow) … 1 (stern). */
  private hullStation(t: number): { b: number; d: number; h: number } {
    const B = this.p.beam / 2;
    const f = t < 0.55 ? Math.pow(Math.sin((Math.PI / 2) * (t / 0.55)), 0.75) : 1 - 0.36 * Math.pow((t - 0.55) / 0.45, 2);
    const b = Math.max(0.004, B * f);
    const d = 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.8))), 0.8) + 0.02;
    return { b, d: t > 0.97 ? Math.max(0.02, d) : d, h: sheerAt(t) };
  }

  /** A point of the hull section at station t, angle th (0 = keel line … π/2 = sheer), side ±1. */
  private sectionPoint(t: number, th: number, side: number, out: THREE.Vector3): THREE.Vector3 {
    const { b, d, h } = this.hullStation(t);
    // Round bilge with a little flare towards the sheer.
    const x = side * b * Math.pow(Math.sin(th), 0.62);
    const y = -d * Math.cos(th) + h * Math.pow(1 - Math.cos(th), 0.92);
    return out.set(x, y, BOW_Z + t * this.p.loa);
  }

  private buildStatic(transomText: string): StaticParts {
    const g = new THREE.Group();
    const mastTopY = sheerAt(0.4) + this.p.mastLength;
    g.add(this.buildHull(), this.buildTransom(transomText), this.buildDeck(), this.buildCockpit(), this.buildKeel());
    for (const m of this.buildRig(mastTopY)) g.add(m);
    for (const m of this.buildFittings()) g.add(m);
    return { group: mergeByMaterial(g), mastTopY };
  }

  private buildHull(): THREE.Mesh {
    const N = STATIONS;
    const M = SECTION;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const white = linear(TOPSIDES);
    const stripe = linear(SHEER_STRIPE);
    const boot = linear(BOOT_TOP);
    const anti = linear(ANTIFOULING);
    const colorFor = (y: number, h: number) =>
      y < BOOT[0] ? anti : y < BOOT[1] ? boot : y > h - STRIPE_DROP[0] && y < h - STRIPE_DROP[1] ? stripe : white;
    const v = new THREE.Vector3();
    // Extra section rows at the colour boundaries keep the stripes crisp.
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j <= M; j++) {
          this.sectionPoint(t, (j / M) * (Math.PI / 2), side, v);
          pos.push(v.x, v.y, v.z);
          const { h } = this.hullStation(t);
          const c = colorFor(v.y, h);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const rowLen = (M + 1) * 2;
    for (let i = 0; i < N; i++) {
      for (let s = 0; s < 2; s++) {
        for (let j = 0; j < M; j++) {
          const a = i * rowLen + s * (M + 1) + j;
          const b = a + rowLen;
          if (s === 1) idx.push(a, b, a + 1, b, b + 1, a + 1);
          else idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, MAT.hull);
    mesh.name = 'hull';
    return mesh;
  }

  /**
   * The flat transom, textured with the hull's bands and the lettering: the whole stern section closed from
   * the keel up each side to the sheer and across under the cambered deck edge, as a fan about its centre.
   */
  private buildTransom(text: string): THREE.Mesh {
    const M = SECTION;
    const { b, d, h } = this.hullStation(1);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    const top = h;
    const bottom = -d;
    const z = this.sternZ + 0.002;
    const push = (x: number, y: number) => {
      pos.push(x, y, z);
      // Seen from astern, starboard (x > 0) is on the right.
      uv.push(0.5 + x / (2 * b), (y - bottom) / (top - bottom));
    };
    push(0, (top + bottom) / 2);
    // Outline: port side keel → sheer, across the deck edge (with the deck's camber) to starboard, starboard
    // sheer → keel. Every consecutive pair makes a triangle with the centre, so the outline is closed.
    for (let j = 0; j <= M; j++) {
      this.sectionPoint(1, (j / M) * (Math.PI / 2), -1, v);
      push(v.x, v.y);
    }
    const ACROSS = 12;
    for (let k = 1; k < ACROSS; k++) {
      const x = -b + (2 * b * k) / ACROSS;
      push(x, deckHeight(x, b, h));
    }
    for (let j = M; j >= 0; j--) {
      this.sectionPoint(1, (j / M) * (Math.PI / 2), 1, v);
      push(v.x, v.y);
    }
    const n = pos.length / 3;
    for (let k = 1; k < n - 1; k++) idx.push(0, k, k + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const map =
      typeof document === 'undefined'
        ? null
        : transomTexture({ top, bottom, stripe: [h - STRIPE_DROP[0], h - STRIPE_DROP[1]], boot: BOOT, colours: { topsides: TOPSIDES, stripe: SHEER_STRIPE, boot: BOOT_TOP, bottom: ANTIFOULING } }, text);
    const material = new THREE.MeshPhysicalMaterial({ map, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
    material.userData.role = 'transom';
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'hull-transom';
    return mesh;
  }

  private buildDeck(): THREE.Group {
    const g = new THREE.Group();
    const N = STATIONS;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    // Two side strips from the sheer inwards; they meet on the centreline except over the cockpit opening.
    // The opening's ends get two rows at the same station (closed, then open), so its edges are square.
    const rows: { z: number; open: boolean }[] = [];
    for (let i = 0; i <= N; i++) {
      const z = BOW_Z + (i / N) * this.p.loa;
      rows.push({ z, open: z > COCKPIT_FROM && z < COCKPIT_TO });
    }
    rows.push({ z: COCKPIT_FROM, open: false }, { z: COCKPIT_FROM, open: true }, { z: COCKPIT_TO, open: true }, { z: COCKPIT_TO, open: false });
    rows.sort((a, b) => a.z - b.z || (a.z === COCKPIT_FROM ? Number(a.open) - Number(b.open) : Number(b.open) - Number(a.open)));
    const COLS = 6;
    rows.forEach(({ z, open }, i) => {
      const { b, h } = this.hullStation((z - BOW_Z) / this.p.loa);
      const inner = open ? Math.min(COCKPIT_HALF, b * 0.8) : 0;
      for (let side = -1; side <= 1; side += 2) {
        for (let c = 0; c <= COLS; c++) {
          const x = side * (b - (b - inner) * (c / COLS));
          const y = deckHeight(x, b, h);
          pos.push(x, y, z);
          uv.push(x, z);
        }
      }
      if (i < rows.length - 1) {
        const rl = 2 * (COLS + 1);
        for (let side = 0; side < 2; side++) {
          for (let c = 0; c < COLS; c++) {
            const a = i * rl + side * (COLS + 1) + c;
            const n = a + rl;
            if (side === 0) idx.push(a, n, a + 1, a + 1, n, n + 1);
            else idx.push(a, a + 1, n, a + 1, n + 1, n);
          }
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const deck = new THREE.Mesh(geo, MAT.deck);
    deck.name = 'deck';
    g.add(deck);

    // Rubbing strake along the sheer, each side (black rubber; varnished wood on the older boats).
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = 0.01 + (0.99 * i) / 40;
        const { b, h } = this.hullStation(t);
        pts.push(new THREE.Vector3(side * (b + 0.006), h - 0.012, BOW_Z + t * this.p.loa));
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.018, 6, false), this.classic ? MAT.varnish : MAT.rubbing));
    }
    // Low foredeck rise forward of the mast (estimated), with a rounded edge.
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.75, 4, 12), MAT.deck);
    fore.rotation.x = Math.PI / 2;
    fore.scale.set(1.05, 1, 0.16);
    fore.position.set(0, sheerAt(0.3) + 0.04, -1.25);
    g.add(fore);
    return g;
  }

  /**
   * The cockpit well: sides, end bulkheads and floor, closed so it is a watertight tub. Rondar: a raised,
   * moulded, non-slip self-draining floor with outlets through the transom. Hunter and Parker: a deeper well
   * with slatted wooden floorboards and a varnished thwart and coaming trim (the trim details are
   * illustrative).
   */
  private buildCockpit(): THREE.Group {
    const g = new THREE.Group();
    const deckY = sheerAt(0.7);
    const len = COCKPIT_TO - COCKPIT_FROM;
    const midZ = (COCKPIT_TO + COCKPIT_FROM) / 2;
    const depth = deckY - this.soleY;
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.03, depth + 0.02, len), MAT.well);
      wall.position.set(side * COCKPIT_HALF, this.soleY + depth / 2, midZ);
      g.add(wall);
      // Coaming lip along the opening.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, len + 0.04), this.classic ? MAT.varnish : MAT.deck);
      lip.position.set(side * (COCKPIT_HALF + 0.01), deckY + 0.03, midZ);
      g.add(lip);
    }
    const tAt = (z: number) => (z - BOW_Z) / this.p.loa;
    for (const z of [COCKPIT_FROM, COCKPIT_TO]) {
      const top = sheerAt(tAt(z)) + DECK_CAMBER * 0.6;
      const h = top - this.soleY;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(2 * COCKPIT_HALF + 0.04, h, 0.03), MAT.well);
      wall.position.set(0, top - h / 2, z);
      g.add(wall);
    }
    if (this.classic) {
      const tub = new THREE.Mesh(new THREE.BoxGeometry(2 * COCKPIT_HALF, 0.02, len), MAT.well);
      tub.position.set(0, this.soleY - 0.01, midZ);
      g.add(tub);
      // Slatted floorboards.
      for (let i = -3; i <= 3; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, len - 0.25), MAT.varnish);
        slat.position.set(i * 0.135, this.soleY + 0.03, midZ);
        g.add(slat);
      }
      for (const z of [COCKPIT_FROM + 0.4, midZ, COCKPIT_TO - 0.4]) {
        const bearer = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.03, 0.06), MAT.varnish);
        bearer.position.set(0, this.soleY + 0.005, z);
        g.add(bearer);
      }
      const thwart = new THREE.Mesh(new THREE.BoxGeometry(2 * COCKPIT_HALF, 0.04, 0.24), MAT.varnish);
      thwart.position.set(0, deckY - 0.13, 0.35);
      g.add(thwart);
    } else {
      const sole = new THREE.Mesh(new THREE.BoxGeometry(2 * COCKPIT_HALF, 0.04, len), MAT.greySole);
      sole.position.set(0, this.soleY, midZ);
      g.add(sole);
      // Moulded console under the mainsheet in place of a thwart.
      const console = new THREE.Mesh(new THREE.BoxGeometry(0.5, deckY - this.soleY - 0.12, 0.3), MAT.well);
      console.position.set(0, this.soleY + (deckY - this.soleY - 0.12) / 2, 0.35);
      g.add(console);
      // Transom outlets for the self-draining floor.
      for (const side of [-1, 1]) {
        const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), MAT.black);
        outlet.rotation.x = Math.PI / 2;
        outlet.position.set(side * 0.22, Math.max(0.12, this.soleY + 0.03), this.sternZ + 0.004);
        g.add(outlet);
      }
    }
    // Toe straps for the hiking crew, near the middle of the floor (feet from the windward deck reach them).
    for (const x of [-STRAP_X, STRAP_X]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 1.7), MAT.strap);
      strap.position.set(x, this.soleY + (this.classic ? 0.05 : 0.03), 1.05);
      g.add(strap);
    }
    return g;
  }

  /**
   * The hull is an open shell sitting in the water, so the sea surface would be drawn wherever it is nearer
   * the camera than the hull's inside: in the cockpit, and over the leeward deck when heeled. This invisible
   * cap over the deck outline marks the boat in the stencil buffer, and the water is not drawn there
   * (src/render/water.ts). It is drawn after the opaque scene and before the water (renderOrder), tests depth
   * against the deck and hull so it marks only what is seen inside the boat, and writes no colour or depth.
   */
  private buildWaterMask(): THREE.Mesh {
    const N = 44;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = BOW_Z + t * this.p.loa;
      const { b, h } = this.hullStation(t);
      pos.push(-b, h - 0.012, z, b, h - 0.012, z);
      if (i < N) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mask = new THREE.Mesh(geo, WATER_MASK_MATERIAL);
    mask.name = 'water-mask';
    mask.renderOrder = WATER_MASK_ORDER;
    mask.castShadow = false;
    mask.receiveShadow = false;
    return mask;
  }

  /** Cast-iron fin keel: tapered planform with a swept trailing edge, NACA 0010 sections (estimated). */
  private buildKeel(): THREE.Mesh {
    const root = -0.27;
    const tip = -this.p.draft;
    const stations: { z: number; y: number; chord: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      const chord = 1.05 - 0.42 * f;
      stations.push({ z: -0.55 + 0.22 * f, y: root + (tip - root) * f, chord });
    }
    // A short fillet into the canoe body.
    stations.unshift({ z: -0.62, y: root + 0.06, chord: 1.2 });
    const mesh = foil(stations, 0.1, MAT.keel);
    mesh.name = 'keel';
    return mesh;
  }

  /** Transom-hung rudder: foil blade, stock, pintles and gudgeons, tiller and extension (estimated). */
  private buildRudder(): void {
    const z = -this.p.rudder.x;
    const stations = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ z: 0.0 + 0.02 * f, y: 0.3 - 1.05 * f, chord: f < 0.9 ? 0.32 - 0.04 * f : 0.28 - 0.5 * (f - 0.9) }));
    const blade = foil(stations, 0.09, MAT.rudder);
    blade.name = 'rudder-blade';
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.2), MAT.darkSpar);
    head.position.set(0, 0.46, 0.08);
    for (const y of [0.05, 0.38]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), MAT.steel);
      pin.position.set(0, y, -0.005);
      this.rudder.add(pin);
    }
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 1.1, 10), MAT.tiller);
    tiller.rotation.x = Math.PI / 2 + 0.12;
    tiller.position.set(0, 0.62, -0.5);
    // Tiller extension (hiking stick) on a universal joint at the tiller's end.
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.95, 8), this.classic ? MAT.tiller : MAT.darkSpar);
    ext.position.y = 0.475;
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), MAT.black);
    grip.position.y = 0.95;
    this.extension.add(ext, grip);
    this.extension.position.set(0, 0.68, -1.03);
    this.rudder.add(blade, head, tiller, this.extension);
    this.rudder.position.set(0, 0, z);
    this.rudder.name = 'rudder';
  }

  /** Spars, standing rigging and the burgee stick's base (static). */
  private buildRig(mastTopY: number): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const deckY = sheerAt(0.4) + DECK_CAMBER;
    const mastLen = mastTopY - deckY;
    // Tapered, slightly oval mast section with the sail track aft.
    const mastGeo = new THREE.CylinderGeometry(0.028, 0.048, mastLen, 14, 6);
    mastGeo.scale(0.82, 1, 1);
    const mast = new THREE.Mesh(mastGeo, MAT.spar);
    mast.position.set(0, deckY + mastLen / 2, MAST_Z);
    mast.name = 'mast';
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.012, mastLen - 0.4, 0.014), MAT.darkSpar);
    track.position.set(0, deckY + mastLen / 2, MAST_Z + 0.042);
    const crane = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.12), MAT.darkSpar);
    crane.position.set(0, mastTopY - 0.02, MAST_Z + 0.02);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 14), MAT.darkSpar);
    collar.position.set(0, deckY + 0.02, MAST_Z);
    out.push(mast, track, crane, collar);
    // Spreaders, swept back (estimate), and the standing rigging as wires with bottlescrews at the chainplates.
    const sweep = 0.12;
    const tips = [-1, 1].map((s) => new THREE.Vector3(s * 0.4, SPREADER_Y, MAST_Z + sweep));
    for (const tipP of tips) out.push(rod(new THREE.Vector3(0, SPREADER_Y, MAST_Z), tipP, 0.011, MAT.spar, 6));
    const hounds = new THREE.Vector3(0, HOUNDS_Y, MAST_Z);
    const cap = new THREE.Vector3(0, mastTopY - 0.15, MAST_Z);
    const stem = new THREE.Vector3(0, sheerAt(0) + 0.03, BOW_Z + 0.1);
    out.push(rod(stem, hounds, 0.004, MAT.wire, 5));
    for (const s of [-1, 1]) {
      const plate = new THREE.Vector3(s * (this.hullStation(0.42).b - 0.04), sheerAt(0.42) + 0.02, MAST_Z + 0.15);
      out.push(rod(plate, hounds, 0.0035, MAT.wire, 5));
      out.push(rod(plate, tips[(s + 1) / 2]!, 0.0035, MAT.wire, 5));
      out.push(rod(tips[(s + 1) / 2]!, cap, 0.0035, MAT.wire, 5));
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), MAT.steel);
      screw.position.copy(plate).add(hounds.clone().sub(plate).normalize().multiplyScalar(0.07));
      screw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hounds.clone().sub(plate).normalize());
      out.push(screw);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10), MAT.darkSpar);
    drum.position.copy(stem).add(new THREE.Vector3(0, 0.04, 0.04));
    out.push(drum);
    return out;
  }

  /** Deck fittings: jib tracks and fairleads, cleats, mainsheet traveller, bow fitting (estimated layout). */
  private buildFittings(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const t = (z: number) => (z - BOW_Z) / this.p.loa;
    for (const s of [-1, 1]) {
      const zc = MAST_Z + 0.9;
      const y = sheerAt(t(zc)) + DECK_CAMBER * 0.3;
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.5), MAT.darkSpar);
      track.position.set(s * 0.6, y + 0.006, zc);
      const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), MAT.black);
      lead.rotation.z = Math.PI / 2;
      lead.position.set(s * 0.6, y + 0.03, zc);
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.09), MAT.black);
      cleat.position.set(s * (COCKPIT_HALF + 0.07), sheerAt(t(0.4)) + 0.04, 0.4);
      out.push(track, lead, cleat);
    }
    // Mainsheet traveller across the console or thwart.
    const ty = sheerAt(0.7) - (this.classic ? 0.1 : 0.09);
    const trav = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.03), MAT.darkSpar);
    trav.position.set(0, ty, 0.35);
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.05), MAT.black);
    car.position.set(0, ty + 0.025, 0.35);
    // Bow fitting and fairlead.
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.2), MAT.steel);
    bow.position.set(0, sheerAt(0.02) + 0.02, BOW_Z + 0.18);
    out.push(trav, car, bow);
    return out;
  }

  private buildBoom(): void {
    const boomLen = this.p.main.foot;
    const geo = new THREE.CylinderGeometry(0.034, 0.034, boomLen, 10);
    geo.scale(0.75, 1, 1);
    const boomMesh = new THREE.Mesh(geo, MAT.spar);
    boomMesh.rotation.x = Math.PI / 2;
    boomMesh.position.set(0, 0, boomLen / 2);
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.08), MAT.darkSpar);
    end.position.set(0, -0.005, boomLen);
    const goose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), MAT.darkSpar);
    // Kicker (boom vang) from the boom to the foot of the mast.
    const kick = rod(new THREE.Vector3(0, -0.02, 0.75), new THREE.Vector3(0, -(GOOSENECK_Y - sheerAt(0.4) - 0.08), 0.06), 0.012, MAT.darkSpar, 6);
    this.boom.add(boomMesh, end, goose, kick);
    this.boom.position.set(0, GOOSENECK_Y, MAST_Z);
    this.boom.name = 'boom';
  }

  private gridGeometry(nu: number, nv: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3));
    const uv: number[] = [];
    for (let v = 0; v <= nv; v++) for (let u = 0; u <= nu; u++) uv.push(u / nu, v / nv);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        const a = v * (nu + 1) + u;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    geo.setIndex(idx);
    return geo;
  }

  // --------------------------------------------------------------- update

  /**
   * Shape a sail between its luff curve and leech curve: chord rotated to the sail angle (plus twist
   * aloft), camber bellied away from the wind, and a travelling flutter when luffing. `flatFoot` flattens
   * the lower third (the new package's flatter base).
   */
  private shapeSail(
    geo: THREE.BufferGeometry,
    nu: number,
    nv: number,
    luffAt: (v: number) => THREE.Vector3,
    chordAt: (v: number) => number,
    s: SailShapeInput,
    twistDeg: number,
    time: number,
    ce: THREE.Vector3,
    flatFoot: number,
  ): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const flog = 1 - s.luff;
    let k = 0;
    ce.set(0, 0, 0);
    let wsum = 0;
    for (let v = 0; v <= nv; v++) {
      const fv = v / nv;
      const luff = luffAt(fv);
      const chord = chordAt(fv);
      const ang = s.angle + Math.sign(s.angle || 1) * (twistDeg * Math.PI / 180) * fv * s.luff;
      const cx = -Math.sin(ang);
      const cz = Math.cos(ang);
      const belly = (s.inverted ? -1 : 1) * s.side;
      const nx = -cz * belly;
      const nz = cx * belly;
      const camber = (0.11 * s.luff + 0.03) * (1 - 0.3 * fv) * (1 - flatFoot * (1 - smoothstep(0, 0.35, fv)));
      for (let u = 0; u <= nu; u++) {
        const fu = u / nu;
        // Draft forward of mid-chord (max depth near 40%).
        const shape = 4 * fu * (1 - fu) * (1 + 0.35 * (1 - 2 * fu) * (1 - fu));
        const depth = chord * camber * shape;
        const wave = flog * chord * 0.06 * Math.sin(fu * 9 - time * 14 + fv * 5) * (0.3 + fu);
        const off = depth + wave;
        const x = luff.x + cx * chord * fu + nx * off;
        const y = luff.y;
        const z = luff.z + cz * chord * fu + nz * off;
        pos.setXYZ(k++, x, y, z);
        if (u === Math.round(nu * 0.4)) {
          const w = chord;
          ce.x += x * w;
          ce.y += y * w;
          ce.z += z * w;
          wsum += w;
        }
      }
    }
    ce.divideScalar(wsum || 1);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  /** Tint the hull (the vertex colours and transom texture are multiplied by this colour): fleet boats. */
  setHullColour(hex: number): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.name === 'hull' || o.name === 'hull-transom')) {
        const m = (o.material as THREE.MeshPhysicalMaterial).clone();
        m.color.setHex(hex);
        o.material = m;
      }
    });
  }

  update(params: {
    main: SailShapeInput;
    jib: SailShapeInput;
    rudder: number;
    crewY: number;
    time: number;
    hideHelm?: boolean;
    /** Apparent wind in the boat's frame (burgee, telltales): angle (rad, > 0 from starboard), speed (m/s). */
    awa?: number;
    aws?: number;
    /** Heel (rad, > 0 to starboard) and water in the cockpit (kg): the water's surface stays level. */
    heel?: number;
    water?: number;
  }): void {
    const { main, jib, time } = params;
    const awa = params.awa ?? 0;
    const aws = params.aws ?? 4;
    const footMain = this.p.main.foot;
    const headMainY = this.mastTopY - 0.1;
    const flat = this.type === 'new-sails' ? 0.35 : 0;
    this.boom.rotation.y = -main.angle;
    this.shapeSail(
      this.mainGeo,
      SquibModel.MAIN_U,
      SquibModel.MAIN_V,
      (v) => new THREE.Vector3(0, GOOSENECK_Y + 0.05 + v * (headMainY - GOOSENECK_Y - 0.05), MAST_Z + 0.05),
      (v) => Math.max(0.12, footMain * (1 - v) + 0.12 * v + 0.35 * Math.sin(Math.PI * v) * (1 - v)),
      main,
      9,
      time,
      this.anchors.mainCE,
      flat,
    );

    // Jib: luff along the forestay from tack to hounds.
    const tack = new THREE.Vector3(0, sheerAt(0) + 0.08, BOW_Z + 0.1);
    const head = new THREE.Vector3(0, HOUNDS_Y - 0.1, MAST_Z - 0.05);
    const footJib = this.p.jib.foot;
    this.shapeSail(
      this.jibGeo,
      SquibModel.JIB_U,
      SquibModel.JIB_V,
      (v) => tack.clone().lerp(head, v),
      (v) => Math.max(0.05, footJib * (1 - v) + 0.05 * v),
      jib,
      7,
      time,
      this.anchors.jibCE,
      flat,
    );
    const jp = this.jibGeo.getAttribute('position') as THREE.BufferAttribute;
    const clew = new THREE.Vector3(jp.getX(SquibModel.JIB_U), jp.getY(SquibModel.JIB_U), jp.getZ(SquibModel.JIB_U));
    const lead = new THREE.Vector3(Math.sign(clew.x || 1) * 0.6, sheerAt(0.45) + 0.04, MAST_Z + 0.9);
    this.rudder.rotation.y = params.rudder;
    const hands = this.poseCrew(params.crewY, params.rudder, time, params.hideHelm ?? false, lead);

    const js = this.sheets[0]!.geo.getAttribute('position') as THREE.BufferAttribute;
    js.setXYZ(0, clew.x, clew.y, clew.z);
    js.setXYZ(1, lead.x, lead.y, lead.z);
    js.setXYZ(2, hands.jib.x, hands.jib.y, hands.jib.z);
    js.needsUpdate = true;
    // Mainsheet: a tackle from the boom (about 60% along) to the traveller car, the tail to the helm's hand.
    const bp = new THREE.Vector3(0, -0.04, 0.6 * footMain).applyEuler(this.boom.rotation).add(this.boom.position);
    const car = new THREE.Vector3(0, sheerAt(0.7) - (this.classic ? 0.075 : 0.065), 0.35);
    const ms = this.sheets[1]!.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 5; i++) {
      const p = i % 2 === 0 ? bp : car;
      ms.setXYZ(i, p.x + (i - 2) * 0.015, p.y, p.z);
    }
    ms.setXYZ(5, car.x, car.y + 0.03, car.z);
    ms.setXYZ(6, hands.main.x, hands.main.y, hands.main.z);
    ms.needsUpdate = true;

    // Telltales stream along the jib's surface, with the flow (or flick about when it is luffing).
    const nvJ = SquibModel.JIB_V;
    const nuJ = SquibModel.JIB_U;
    for (let i = 0; i < this.telltales.length; i++) {
      const row = Math.round(nvJ * [0.25, 0.5, 0.75][Math.floor(i / 2)]!);
      const a = row * (nuJ + 1) + 1;
      const t = this.telltales[i]!;
      t.position.set(jp.getX(a), jp.getY(a), jp.getZ(a));
      const b = a + 1;
      const dir = new THREE.Vector3(jp.getX(b) - jp.getX(a), 0, jp.getZ(b) - jp.getZ(a));
      const yaw = Math.atan2(-dir.z, dir.x);
      const flick = (1 - jib.luff) * Math.sin(time * 9 + i * 1.7) * 0.8 + 0.08 * Math.sin(time * 6 + i);
      t.rotation.set(0, yaw + flick, 0);
      t.position.x += (i % 2 ? -1 : 1) * 0.01;
    }

    this.burgee.update(awa, aws, time);

    this.updateWater(params.water ?? 0, params.heel ?? 0);
  }

  /**
   * Pose the helm and crew from the physics' lateral position of their weight: sitting in at 0.15 m, sitting
   * out and leaning back over the water at 0.8 m (calibration, E). While that position is moving across (a
   * tack or gybe) they crouch on the floor and duck under the boom; near the middle and still, they sit low
   * in the cockpit. The helm's aft hand holds the tiller extension, which swings from the tiller's end to it;
   * the forward hand the mainsheet. The crew holds the leeward jib sheet and steadies with the other hand.
   * Both mostly watch the jib's luff, glancing up at the main and to windward. Returns where the sheets end.
   */
  private poseCrew(crewY: number, rudder: number, time: number, hideHelm: boolean, jibLead: THREE.Vector3): { jib: THREE.Vector3; main: THREE.Vector3 } {
    const st = this.crewState;
    const dt = Number.isFinite(st.t) ? Math.min(0.2, Math.max(0, time - st.t)) : 0;
    if (Number.isFinite(st.y) && dt > 0) st.rate += ((crewY - st.y) / dt - st.rate) * (1 - Math.exp(-dt / 0.15));
    st.y = crewY;
    st.t = time;
    if (Math.abs(crewY) > 0.04) st.side = crewY > 0 ? 1 : -1;
    const movingTo = smoothstep(0.15, 0.4, Math.abs(st.rate));
    st.moving += (movingTo - st.moving) * (dt > 0 ? 1 - Math.exp(-dt / 0.2) : 1);
    const s = st.side;
    const r = Math.abs(crewY);
    const mv = st.moving;
    const hike = smoothstep(0.3, 0.8, r);
    const onDeck = smoothstep(0.08, 0.22, r);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const sole = this.soleY + (this.classic ? 0.04 : 0.02);
    const jibLuff = V(0, 2.4, -2.1);
    const out = { jib: new THREE.Vector3(), main: new THREE.Vector3() };

    this.crew.forEach((c, i) => {
      const helm = i === 0;
      const z = helm ? HELM_Z : CREW_Z;
      const { b: edge, h } = this.hullStation((z - BOW_Z) / this.p.loa);
      // Sitting on the side deck: just outboard of the coaming, out to the edge as they hike.
      const xd = COCKPIT_HALF + 0.14 + (edge - COCKPIT_HALF - 0.24) * hike;
      const deck = V(s * xd, deckHeight(xd, edge, h) + 0.1, z);
      const low = V(s * (COCKPIT_HALF - 0.2), sole + 0.12, z);
      const crouch = V(Math.max(-0.35, Math.min(0.35, crewY * 0.75)), sole + 0.3, z - 0.05);
      const hip = low.clone().lerp(deck, onDeck).lerp(crouch, mv);
      // Inboard and forward (the helm more forward); straight forward while crossing.
      const ang = helm ? 0.9 : 0.55;
      const facing = V(-s * Math.cos(ang), 0, -Math.sin(ang)).lerp(V(0, 0, -1), mv).normalize();
      const sway = 0.025 * Math.sin(time * 1.1 + i * 2.1) + 0.015 * Math.sin(time * 2.3 + i);
      const back = (0.32 + (0.06 + 0.62 * hike - 0.32) * onDeck) * (1 - mv) - 1.0 * mv + sway;
      const fr: BodyFrame = bodyFrame(hip, facing, back);

      // Feet: on the floor below the knees sitting in; under the toe strap hiking; under the hips crouching.
      const footDeck = V(s * (COCKPIT_HALF - 0.16 + (STRAP_X - COCKPIT_HALF + 0.16) * hike), sole + 0.075, z - 0.1 - 0.15 * hike);
      const footLow = V(hip.x + facing.x * 0.7, sole + 0.075, hip.z + facing.z * 0.7);
      const footCrouch = V(hip.x, sole + 0.075, hip.z + 0.05);
      const foot = footLow.lerp(footDeck, onDeck).lerp(footCrouch, mv);
      const across = V(fr.right.x, 0, fr.right.z).normalize();
      const feet: [THREE.Vector3, THREE.Vector3] = [foot.clone().addScaledVector(across, -0.12), foot.clone().addScaledVector(across, 0.12)];

      // Which hand is aft (nearer the stern) depends on the side.
      const aft = fr.shoulders[0]!.z > fr.shoulders[1]!.z ? 0 : 1;
      const fwd = 1 - aft;
      const hands: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
      let look: THREE.Vector3;
      const glance = smoothstep(0.55, 0.9, Math.sin(time * (helm ? 0.83 : 0.61) + (helm ? 0.4 : 2.2)));
      if (helm) {
        // The extension swings from its joint at the tiller's end towards the hand's natural place in front.
        const pivot = EXTENSION_PIVOT.clone().applyAxisAngle(Y_AXIS, rudder).add(this.rudder.position);
        // When that end would be out of reach, the extension is raised (more upright) until it is in reach.
        const shoulder = fr.shoulders[aft]!;
        const natural = shoulder.clone().addScaledVector(fr.front, 0.28).addScaledVector(Y_AXIS, -0.34).sub(pivot);
        const dir = new THREE.Vector3();
        let best = Infinity;
        for (let k = 0; k <= 12; k++) {
          const d = natural.clone().addScaledVector(Y_AXIS, k * 0.15).normalize();
          const reach = pivot.clone().addScaledVector(d, EXTENSION).distanceTo(shoulder);
          if (reach < best) {
            best = reach;
            dir.copy(d);
          }
          if (reach < 0.53) break;
        }
        hands[aft]!.copy(pivot).addScaledVector(dir, EXTENSION);
        this.extension.quaternion.setFromUnitVectors(Y_AXIS, dir.applyAxisAngle(Y_AXIS, -rudder));
        // The mainsheet tail, held in front of the body towards the middle of the boat.
        hands[fwd]!.copy(fr.shoulders[fwd]!).addScaledVector(fr.front, 0.3).addScaledVector(Y_AXIS, -0.3).addScaledVector(across, -s * 0.08);
        out.main.copy(hands[fwd]!);
        look = jibLuff.clone().lerp(V(s * 10, 3, -18), glance);
      } else {
        // The leeward jib sheet, reached across towards its cleat; the other hand on the deck edge or a knee.
        const cleat = V(-s * (COCKPIT_HALF + 0.07), sheerAt(0.5) + 0.04, 0.4);
        const sh = fr.shoulders[fwd]!;
        hands[fwd]!.copy(sh).addScaledVector(cleat.clone().sub(sh).normalize(), 0.42).addScaledVector(Y_AXIS, -0.06);
        out.jib.copy(hands[fwd]!);
        const rail = V(s * (edge - 0.04), deckHeight(edge - 0.04, edge, h) + 0.03, z + 0.25);
        const knee = hip.clone().addScaledVector(facing, 0.35).addScaledVector(Y_AXIS, 0.02);
        hands[aft]!.copy(knee).lerp(rail, hike).lerp(V(hip.x, sole + 0.1, hip.z - 0.35), mv);
        look = V(-s * 0.2, 2.0, -1.6).lerp(V(0, 5, 1.5), glance);
      }
      const pose: CrewPose = { hip, facing, back, feet, hands, look };
      c.pose(pose);
      c.group.visible = !(helm && hideHelm);
    });
    if (out.jib.lengthSq() === 0) out.jib.copy(jibLead);
    return out;
  }

  /**
   * Shipped water as a level surface (heel counter-rotated) over the cockpit floor: a slab while it covers
   * the floor, a wedge against the low side once the boat heels (as in the physics, src/sim/boat/cockpit.ts).
   */
  private updateWater(kg: number, heel: number): void {
    if (kg < 1) {
      this.water.visible = false;
      return;
    }
    const b = 2 * COCKPIT_HALF - 0.06;
    const L = COCKPIT_TO - COCKPIT_FROM - 0.06;
    const h0 = kg / 1025 / (b * L);
    const t = Math.tan(Math.min(1.2, Math.abs(heel)));
    const s = heel >= 0 ? 1 : -1;
    let x0 = -b / 2;
    let c = this.soleY + 0.02 + h0;
    if (t * b > 2 * h0) {
      const w = Math.min(b, Math.sqrt((2 * h0 * b) / Math.max(t, 1e-6)));
      x0 = b / 2 - w;
      c = this.soleY + 0.02 - x0 * t;
    }
    const x1 = b / 2;
    const xm = (x0 + x1) / 2;
    this.water.visible = true;
    this.water.position.set(s * xm, c + xm * t, (COCKPIT_TO + COCKPIT_FROM) / 2);
    this.water.rotation.set(0, 0, s * Math.atan(t));
    this.water.scale.set((x1 - x0) / Math.cos(Math.atan(t)), 1, L);
  }
}

/**
 * The fixed parts of a boat as one mesh per material (dozens of parts become about fifteen draw calls, which
 * matters with a fleet). Each part's transform is baked into its geometry; the hull keeps its name (tinting).
 */
function mergeByMaterial(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    const list = byMat.get(o.material as THREE.Material) ?? [];
    list.push(geo);
    byMat.set(o.material as THREE.Material, list);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    // Keep only the attributes every part has (some have uv or colour, some not).
    const names = Object.keys(geos[0]!.attributes).filter((n) => geos.every((g) => g.getAttribute(n)));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat === MAT.hull ? 'hull' : mat.userData.role === 'transom' ? 'hull-transom' : 'static';
    out.add(mesh);
  }
  return out;
}

/** Deck surface height at x across a station of half-breadth b and sheer h: cambered, highest on the centreline. */
function deckHeight(x: number, b: number, h: number): number {
  return h + 0.004 + DECK_CAMBER * (1 - (x / Math.max(b, 1e-3)) ** 2) * Math.min(1, b / 0.6);
}

/** Sheer line (deck edge height above the waterline): estimated, rising slightly to the transom. */
function sheerAt(t: number): number {
  return 0.74 - 0.2 * Math.sin((Math.PI / 2) * Math.min(t / 0.8, 1)) + 0.05 * Math.max(0, (t - 0.8) / 0.2);
}

export { BURGEE_STICK };
