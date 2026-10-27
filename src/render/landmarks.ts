import * as THREE from 'three';

/**
 * Landmarks drawn as themselves rather than as plain blocks. Each is matched to its OSM footprint by a point
 * inside it; its materials, windows, roof and additions (towers, battlements, a cupola, a flagstaff, a balcony)
 * follow what published descriptions say of it (docs/SOURCES.md L1–L8). Where a description says what is there
 * but not its size, the proportions are estimates (E): the footprints and heights are the data's.
 */

/** Window style, carried in the integer part of the wall attribute's w (src/render/dart.ts shader). */
export const WIN = { none: 0, sash: 1, tall: 2, slit: 3, brickAndStone: 4, glazed: 5, shopfront: 6 } as const;

export type Extra =
  /** A square tower on plan (w by d m, faces along `bearingDeg`), from `fromM` to `toM` (m ODN), with a top. */
  | { kind: 'tower'; at: [number, number]; w: number; d: number; bearingDeg: number; fromM: number; toM: number; top: 'battlements' | 'clock-cupola'; walls: number; dressing: number }
  /** A many-sided turret (radius m), from `fromM` to `toM` (m ODN), embattled. */
  | { kind: 'turret'; at: [number, number]; radius: number; sides: number; fromM: number; toM: number; walls: number }
  /** A flagstaff with a yard, foot at `fromM` (m ODN). */
  | { kind: 'flagstaff'; at: [number, number]; fromM: number; height: number }
  /** A first-floor balcony with a tented canopy on thin columns along the wall from a to b (outward to the right of a→b). */
  | { kind: 'veranda'; a: [number, number]; b: [number, number]; floorM: number; topM: number; depth: number; canopy: number }
  /** Balconies with glass fronts along a wall a→b at these floor levels (m ODN). */
  | { kind: 'balconies'; a: [number, number]; b: [number, number]; floorsM: number[]; depth: number };

export interface Look {
  /** sRGB colours. */
  walls: number;
  roof: number;
  win: number;
  /** Roof override: 'p' perimeter slopes round a flat top (large complex ranges), 'g' gable on the long axis, 'f' flat. */
  shape?: 'p' | 'g' | 'f';
  /** For 'p' and 'g': eaves below the data's top (m). */
  roofDrop?: number;
  parapet?: 'battlements' | 'corbelled-battlements' | 'cornice-balustrade';
}

export interface LandmarkSpec extends Look {
  id: string;
  /** A point inside the footprint (local e, n). */
  at: [number, number];
  /** Extras, given the footprint's base and top (m ODN) and its ring (counter-clockwise). */
  extras?: (base: number, top: number, ring: [number, number][]) => Extra[];
  source: string;
}

const BRICK = 0x9a4d3c;
const PORTLAND = 0xe6e0d0;
const SLATE = 0x3a3f46;
const RUBBLE = 0x5e5952;
const LEAD = 0x6f7d78;

/** The bespoke landmarks (positions in the OSM footprints; see SOURCES.md for each description). */
export const LANDMARKS: LandmarkSpec[] = [
  {
    id: 'brnc',
    at: [-640, 1000],
    walls: BRICK,
    roof: SLATE,
    win: WIN.brickAndStone,
    shape: 'p',
    roofDrop: 3.5,
    parapet: 'cornice-balustrade',
    // The central entrance block's tower in the middle of the 150 m river front (azimuth 141°), set in 7 m.
    extras: (base, top) => [
      { kind: 'tower', at: [-639.4, 1002.1], w: 9, d: 9, bearingDeg: 50.7, fromM: base, toM: top + 9, top: 'clock-cupola', walls: BRICK, dressing: PORTLAND },
    ],
    source: 'Britannia Royal Naval College (Aston Webb, 1899–1905): Flemish-bond brick with Portland stone dressings, slate roofs, a central entrance block with a balustraded parapet and a central clock tower (Historic England list entry 1208626, via search; photographs). Tower and cupola proportions E.',
  },
  {
    id: 'dartmouth-castle',
    at: [529, -637],
    walls: RUBBLE,
    roof: RUBBLE,
    win: WIN.slit,
    shape: 'f',
    parapet: 'battlements',
    source: 'Dartmouth Castle gun tower (1481): stone artillery tower (Historic England photograph captions, via search). Battlement spacing E.',
  },
  {
    id: 'dartmouth-castle-battery',
    at: [544, -696],
    walls: RUBBLE,
    roof: RUBBLE,
    win: WIN.slit,
    shape: 'f',
    parapet: 'battlements',
    source: 'Dartmouth Castle, southern works (gun platforms): stone. Detail E.',
  },
  {
    id: 'st-petrox',
    at: [509, -648],
    walls: RUBBLE,
    roof: SLATE,
    win: WIN.tall,
    shape: 'g',
    roofDrop: 0,
    // Nave and chancel low; the data's top is the tower (two-stage west tower, embattled).
    extras: (base, top) => [{ kind: 'tower', at: [500, -645], w: 5, d: 5, bearingDeg: 75, fromM: base, toM: top, top: 'battlements', walls: RUBBLE, dressing: 0x8b857a }],
    source: 'St Petrox church (1641): two-stage west tower, round-arched windows (listed building description, via search). Tower position at the west end and its size E.',
  },
  {
    id: 'kingswear-castle',
    at: [965, -668],
    walls: 0x56524d,
    roof: 0x56524d,
    win: WIN.slit,
    shape: 'f',
    parapet: 'corbelled-battlements',
    // The octagonal stair turret on the north-west corner (the round part of the footprint).
    extras: (base, top) => [{ kind: 'turret', at: [956, -657], radius: 3, sides: 8, fromM: base, toM: top + 3, walls: 0x56524d }],
    source: 'Kingswear Castle (1491–1502): square on plan, corbelled embattled parapet, octagonal stair turret on the north-west corner; slate rubble with red sandstone dressings (Historic England list entry 1108543, via search). Turret height E.',
  },
  {
    id: 'rdyc',
    at: [2, 1],
    walls: 0xf1efe8,
    roof: SLATE,
    win: WIN.sash,
    parapet: 'cornice-balustrade',
    // On the river (west) front, 3 m out from the wall.
    extras: (base, _top, ring) => {
      const [a, b] = facing(ring, 225, 315);
      const [oe, on] = outward(a, b);
      return [{ kind: 'flagstaff', at: [(a[0] + b[0]) / 2 + oe * 3, (a[1] + b[1]) / 2 + on * 3], fromM: base + 0.5, height: 13 }];
    },
    source: 'Royal Dart Yacht Club clubhouse (purpose-built, 1881; club history). Painted walls and the flagstaff on the river front are from photographs; its size and the colours E.',
  },
  {
    id: 'royal-dart-hotel',
    at: [12, 54],
    walls: 0xe8dcc0,
    roof: SLATE,
    win: WIN.sash,
    // The river (west) front: "a wide splayed two-storey bay with cast-iron balcony with tented roof on thin iron columns".
    extras: (base, _top, ring) => {
      const [a, b] = facing(ring, 225, 315);
      return [{ kind: 'veranda', a, b, floorM: base + 3.4, topM: base + 7.2, depth: 2.2, canopy: 1.1 }];
    },
    source: 'Royal Dart Hotel, Kingswear (c. 1850, Italianate, Grade II): river front with a two-storey bay and a cast-iron balcony with a tented roof on thin iron columns (Historic England list entry 1146644, via search). Balcony length and depth E.',
  },
  {
    id: 'dart-marina-hotel',
    at: [-289, 1033],
    walls: 0xf4f4f0,
    roof: 0x585d63,
    win: WIN.glazed,
    shape: 'f',
    // On the river (east) front.
    extras: (base, top, ring) => {
      const [a, b] = facing(ring, 45, 135);
      return [{ kind: 'balconies', a, b, floorsM: [base + 3.2, base + 6.2].filter((y) => y < top - 1), depth: 1.6 }];
    },
    source: 'Dart Marina Hotel, Sandquay (Overture place 50.35719, -3.57733; its building is the nearest footprint): rooms with river views, some with balconies (venue listing, via search). White walls and balcony fronts E.',
  },
];

/** Noss on Dart Marina's buildings: modern timber-clad marina buildings (E: the redevelopment's materials are not described in the sources found). */
export const NOSS = { centre: [-230, 2100] as [number, number], radius: 110, look: { walls: 0x8a7a66, roof: 0x4a4f55, win: WIN.glazed, shape: 'f' } as Look };

/** Outward unit normal (e, n) of a counter-clockwise ring's edge a→b: the right of travel. */
export function outward(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
}

/** The longest edge of a counter-clockwise ring whose outward normal points between two bearings (deg). */
export function facing(ring: readonly [number, number][], fromDeg: number, toDeg: number): [[number, number], [number, number]] {
  let best: [[number, number], [number, number]] = [ring[0]!, ring[1]!];
  let bestLen = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const [oe, on] = outward(a, b);
    const az = ((Math.atan2(oe, on) * 180) / Math.PI + 360) % 360;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (az >= fromDeg && az <= toDeg && len > bestLen) {
      best = [a, b];
      bestLen = len;
    }
  }
  return best;
}

/** Is (e, n) inside the ring? */
export function insideRing(ring: readonly (readonly [number, number])[], e: number, n: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > n !== yj > n && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The landmark whose footprint this is, if any. */
export function landmarkFor(ring: readonly (readonly [number, number])[]): LandmarkSpec | undefined {
  return LANDMARKS.find((l) => insideRing(ring, l.at[0], l.at[1]));
}

/** Bearing (deg, clockwise from north) of a footprint's long axis (principal axis of its vertices). */
export function longAxisDeg(ring: readonly (readonly [number, number])[]): number {
  const n = ring.length;
  const ce = ring.reduce((a, p) => a + p[0], 0) / n;
  const cn = ring.reduce((a, p) => a + p[1], 0) / n;
  let see = 0;
  let snn = 0;
  let sen = 0;
  for (const [e, nn] of ring) {
    see += (e - ce) ** 2;
    snn += (nn - cn) ** 2;
    sen += (e - ce) * (nn - cn);
  }
  // Angle of the principal axis from east, then as a bearing from north.
  const th = 0.5 * Math.atan2(2 * sen, see - snn);
  return ((90 - (th * 180) / Math.PI) % 180 + 180) % 180;
}

/**
 * A ring without its near-straight corners (turns under `minTurnDeg`) and its very short jogs (edges under
 * `minLen` m), for roofs: the walls keep the full footprint.
 */
export function simplifyRing(ring: readonly (readonly [number, number])[], minLen = 1.5, minTurnDeg = 10): [number, number][] {
  let pts = ring.map((p) => [p[0], p[1]] as [number, number]);
  for (let pass = 0; pass < 4; pass++) {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = out.length ? out[out.length - 1]! : pts[(i + pts.length - 1) % pts.length]!;
      const p1 = pts[i]!;
      const p2 = pts[(i + 1) % pts.length]!;
      const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) * (180 / Math.PI);
      const short = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < minLen;
      if (turn < minTurnDeg || (short && pts.length - (i - out.length) > 4)) continue;
      out.push(p1);
    }
    if (out.length < 3 || out.length === pts.length) break;
    pts = out;
  }
  return pts;
}

/** The ring moved in by `dist[i]` at each corner (along its bisector), and where the result folds. */
function insetTrial(ring: readonly (readonly [number, number])[], dist: readonly number[]): { pts: [number, number][]; bad: Set<number>; area: number } {
  const n = ring.length;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i + n - 1) % n]!;
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % n]!;
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    // Inward normals of the two edges (left of travel for a counter-clockwise ring).
    const n1 = [-(p1[1] - p0[1]) / l1, (p1[0] - p0[0]) / l1];
    const n2 = [-(p2[1] - p1[1]) / l2, (p2[0] - p1[0]) / l2];
    let bx = n1[0]! + n2[0]!;
    let by = n1[1]! + n2[1]!;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const k = dist[i]! / Math.max(0.35, bx * n1[0]! + by * n1[1]!);
    pts.push([p1[0] + bx * k, p1[1] + by * k]);
  }
  const bad = new Set<number>();
  // An edge reversed or shrunk to under a fifth of its length (inset past a notch's middle).
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dot = (pts[j]![0] - pts[i]![0]) * (ring[j]![0] - ring[i]![0]) + (pts[j]![1] - pts[i]![1]) * (ring[j]![1] - ring[i]![1]);
    const len2 = (ring[j]![0] - ring[i]![0]) ** 2 + (ring[j]![1] - ring[i]![1]) ** 2;
    if (dot < 0.2 * len2) bad.add(i).add(j);
  }
  // Two non-adjacent edges crossing.
  const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!;
      const e = pts[(j + 1) % n]!;
      if (cross(a, b, c) * cross(a, b, e) < 0 && cross(c, e, a) * cross(c, e, b) < 0) {
        bad.add(i).add((i + 1) % n).add(j).add((j + 1) % n);
      }
    }
  }
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i]![0] * pts[(i + 1) % n]![1] - pts[(i + 1) % n]![0] * pts[i]![1];
  return { pts, bad, area };
}

/**
 * The ring moved inwards by d (m), each vertex along its corner's bisector; undefined when the result folds
 * over itself (a part of the footprint narrower than 2d). The ring must be counter-clockwise.
 */
export function insetRing(ring: readonly (readonly [number, number])[], d: number): [number, number][] | undefined {
  const t = insetTrial(ring, ring.map(() => d));
  return t.bad.size || t.area <= 0 ? undefined : t.pts;
}

/**
 * As insetRing, but where the inset would fold (a notch narrower than twice the inset) it is reduced at the
 * corners concerned, as often as needed: the roof is steeper there, like a hip. Undefined if it still folds.
 */
export function insetRingAdaptive(ring: readonly (readonly [number, number])[], d: number): [number, number][] | undefined {
  const dist = ring.map(() => d);
  for (let pass = 0; pass < 16; pass++) {
    const t = insetTrial(ring, dist);
    if (!t.bad.size) return t.area > 0 ? t.pts : undefined;
    for (const i of t.bad) dist[i] = dist[i]! * 0.6;
  }
  return undefined;
}

// ------------------------------------------------------------------ geometry

/** Accumulates coloured, flat-shaded geometry in Three.js space (x = e, y = up, z = -n). */
export class Kit {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  private rgb(hex: number): [number, number, number] {
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
    return [c.r * 0.72, c.g * 0.72, c.b * 0.72];
  }

  /** Add a geometry (local space) transformed by m, in one colour. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number): void {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const nn = g.getAttribute('normal');
    const c = this.rgb(hex);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      this.col.push(...c);
    }
  }

  /** A box w (across) × h × l (along), its base centre at (e, y, n), its length along bearing (deg). */
  box(e: number, y: number, n: number, w: number, h: number, l: number, bearingDeg: number, hex: number): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(e, y + h / 2, -n),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-bearingDeg * Math.PI) / 180),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(new THREE.BoxGeometry(w, h, l), m, hex);
  }

  mesh(name: string): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.4 }));
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}

/** Battlements along each edge of a ring at height `top`: a parapet wall and merlons (sizes E). */
export function battlements(kit: Kit, ring: readonly (readonly [number, number])[], top: number, hex: number, corbelled = false): void {
  const out = corbelled ? 0.3 : 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.8) continue;
    const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    // Outward offset (right of a→b for a counter-clockwise ring) for the corbelled parapet.
    const ox = ((b[1] - a[1]) / len) * (out - 0.25);
    const oy = (-(b[0] - a[0]) / len) * (out - 0.25);
    const me = (a[0] + b[0]) / 2 + ox;
    const mn = (a[1] + b[1]) / 2 + oy;
    if (corbelled) kit.box(me, top - 0.45, mn, 0.7, 0.45, len + 0.6, brg, hex);
    kit.box(me, top, mn, 0.5, 0.9, len + 0.5, brg, hex);
    const count = Math.max(1, Math.floor(len / 1.6));
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count;
      kit.box(a[0] + (b[0] - a[0]) * f + ox, top + 0.9, a[1] + (b[1] - a[1]) * f + oy, 0.5, 0.65, 0.8, brg, hex);
    }
  }
}

/** A stone cornice and a balustrade (rail on balusters) along each edge at the eaves (sizes E). */
export function corniceBalustrade(kit: Kit, ring: readonly (readonly [number, number])[], eaves: number, hex: number): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.8) continue;
    const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    const me = (a[0] + b[0]) / 2;
    const mn = (a[1] + b[1]) / 2;
    kit.box(me, eaves - 0.45, mn, 0.7, 0.45, len + 0.5, brg, hex);
    kit.box(me, eaves + 0.75, mn, 0.32, 0.12, len, brg, hex);
    const count = Math.floor(len / 0.5);
    for (let k = 1; k < count; k++) {
      const f = k / count;
      kit.box(a[0] + (b[0] - a[0]) * f, eaves, a[1] + (b[1] - a[1]) * f, 0.16, 0.75, 0.16, brg, hex);
    }
  }
}

function ringAround(c: [number, number], w: number, d: number, bearingDeg: number): [number, number][] {
  const t = (bearingDeg * Math.PI) / 180;
  const u = [Math.sin(t), Math.cos(t)];
  const v = [Math.cos(t), -Math.sin(t)];
  const pts: [number, number][] = [];
  for (const [su, sv] of [[-1, -1], [-1, 1], [1, 1], [1, -1]] as const) pts.push([c[0] + (u[0]! * su * d) / 2 + (v[0]! * sv * w) / 2, c[1] + (u[1]! * su * d) / 2 + (v[1]! * sv * w) / 2]);
  // Counter-clockwise in (e, n).
  let area = 0;
  for (let i = 0; i < 4; i++) area += pts[i]![0] * pts[(i + 1) % 4]![1] - pts[(i + 1) % 4]![0] * pts[i]![1];
  return area >= 0 ? pts : pts.reverse();
}

/** Build the extras of one landmark into the kit. */
export function buildExtra(kit: Kit, x: Extra): void {
  if (x.kind === 'tower') {
    const h = x.toM - x.fromM;
    if (x.top === 'battlements') {
      kit.box(x.at[0], x.fromM, x.at[1], x.w, h, x.d, x.bearingDeg, x.walls);
      // A string course between the two stages.
      kit.box(x.at[0], x.fromM + h * 0.55, x.at[1], x.w + 0.3, 0.35, x.d + 0.3, x.bearingDeg, x.dressing);
      battlements(kit, ringAround(x.at, x.w, x.d, x.bearingDeg), x.toM, x.walls);
      // Pinnacles at the corners.
      for (const p of ringAround(x.at, x.w - 0.4, x.d - 0.4, x.bearingDeg)) kit.box(p[0], x.toM + 0.9, p[1], 0.45, 1.6, 0.45, x.bearingDeg, x.dressing);
      return;
    }
    // Clock tower: brick shaft with stone quoins, a stone clock stage with a face on each side, an octagonal
    // lantern and a lead dome with a finial.
    const shaft = h * 0.68;
    kit.box(x.at[0], x.fromM, x.at[1], x.w, shaft, x.d, x.bearingDeg, x.walls);
    for (const p of ringAround(x.at, x.w - 0.5, x.d - 0.5, x.bearingDeg)) kit.box(p[0], x.fromM, p[1], 0.7, shaft, 0.7, x.bearingDeg, x.dressing);
    const stage = x.fromM + shaft;
    kit.box(x.at[0], stage - 0.4, x.at[1], x.w + 0.6, 0.5, x.d + 0.6, x.bearingDeg, x.dressing);
    kit.box(x.at[0], stage, x.at[1], x.w - 0.6, 4.2, x.d - 0.6, x.bearingDeg, x.dressing);
    const t = (x.bearingDeg * Math.PI) / 180;
    for (let k = 0; k < 4; k++) {
      const a = t + (k * Math.PI) / 2;
      const off = (k % 2 === 0 ? x.d : x.w) / 2 - 0.25;
      const ce = x.at[0] + Math.sin(a) * off;
      const cn = x.at[1] + Math.cos(a) * off;
      const face = new THREE.CircleGeometry(1.3, 24);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(ce, stage + 2.2, -cn), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI, 0)), new THREE.Vector3(1, 1, 1));
      kit.add(face, m, 0xf4f1e6);
      // The hands (at ten past ten): two thin bars.
      for (const [len, ang] of [[0.75, -0.9], [1.05, 0.55]] as const) {
        const hand = new THREE.PlaneGeometry(0.1, len).translate(0, len / 2, 0.02);
        const hm = new THREE.Matrix4().compose(new THREE.Vector3(ce, stage + 2.2, -cn), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI, ang)), new THREE.Vector3(1, 1, 1));
        kit.add(hand, hm, 0x202020);
      }
    }
    kit.box(x.at[0], stage + 4.2, x.at[1], x.w + 0.2, 0.45, x.d + 0.2, x.bearingDeg, x.dressing);
    const lantern = new THREE.CylinderGeometry(x.w * 0.32, x.w * 0.36, h * 0.12, 8);
    kit.add(lantern, new THREE.Matrix4().makeTranslation(x.at[0], stage + 4.65 + h * 0.06, -x.at[1]), x.dressing);
    const domeY = stage + 4.65 + h * 0.12;
    const dome = new THREE.SphereGeometry(x.w * 0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    kit.add(dome, new THREE.Matrix4().makeTranslation(x.at[0], domeY, -x.at[1]), LEAD);
    kit.add(new THREE.CylinderGeometry(0.08, 0.12, 2.6, 6), new THREE.Matrix4().makeTranslation(x.at[0], domeY + x.w * 0.36 + 1.2, -x.at[1]), 0x2a2a2a);
    return;
  }
  if (x.kind === 'turret') {
    const geo = new THREE.CylinderGeometry(x.radius, x.radius * 1.04, x.toM - x.fromM, x.sides);
    kit.add(geo, new THREE.Matrix4().makeTranslation(x.at[0], (x.fromM + x.toM) / 2, -x.at[1]), x.walls);
    const ring: [number, number][] = [];
    for (let k = 0; k < x.sides; k++) {
      const a = (k / x.sides) * Math.PI * 2;
      ring.push([x.at[0] + Math.cos(a) * x.radius, x.at[1] + Math.sin(a) * x.radius]);
    }
    battlements(kit, ring, x.toM, x.walls);
    return;
  }
  if (x.kind === 'flagstaff') {
    kit.add(new THREE.CylinderGeometry(0.07, 0.13, x.height, 8), new THREE.Matrix4().makeTranslation(x.at[0], x.fromM + x.height / 2, -x.at[1]), 0xf5f5f2);
    // Yard across, and a gaff aft, two-thirds up; a truck on top.
    kit.box(x.at[0], x.fromM + x.height * 0.66, x.at[1], 4.2, 0.1, 0.1, 0, 0xf5f5f2);
    kit.add(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6).rotateX(Math.PI / 2.6), new THREE.Matrix4().makeTranslation(x.at[0], x.fromM + x.height * 0.7, -(x.at[1] - 1.1)), 0xf5f5f2);
    kit.add(new THREE.SphereGeometry(0.16, 8, 6), new THREE.Matrix4().makeTranslation(x.at[0], x.fromM + x.height + 0.1, -x.at[1]), 0xe9e4d6);
    return;
  }
  const dx = x.b[0] - x.a[0];
  const dn = x.b[1] - x.a[1];
  const len = Math.hypot(dx, dn) || 1;
  const brg = (Math.atan2(dx, dn) * 180) / Math.PI;
  // Outward: the right of a→b.
  const oe = dn / len;
  const on = -dx / len;
  if (x.kind === 'veranda') {
    const ce = (x.a[0] + x.b[0]) / 2 + oe * (x.depth / 2);
    const cn = (x.a[1] + x.b[1]) / 2 + on * (x.depth / 2);
    kit.box(ce, x.floorM, cn, x.depth, 0.18, len, brg, 0x2d3236);
    // Cast-iron railing, thin columns, and the tented canopy (a shallow ridge, striped by the colours).
    kit.box((x.a[0] + x.b[0]) / 2 + oe * x.depth, x.floorM + 0.18, (x.a[1] + x.b[1]) / 2 + on * x.depth, 0.06, 0.95, len, brg, 0x2d3236);
    const cols = Math.max(2, Math.round(len / 2.2) + 1);
    for (let k = 0; k < cols; k++) {
      const f = k / (cols - 1);
      kit.box(x.a[0] + dx * f + oe * x.depth, x.floorM, x.a[1] + dn * f + on * x.depth, 0.12, x.topM - x.floorM, 0.12, brg, 0x2d3236);
    }
    const stripes = Math.max(4, Math.round(len / 0.9));
    for (let k = 0; k < stripes; k++) {
      const f = (k + 0.5) / stripes;
      const pe = x.a[0] + dx * f + oe * (x.depth / 2);
      const pn = x.a[1] + dn * f + on * (x.depth / 2);
      const roof = new THREE.BoxGeometry(len / stripes, 0.08, x.depth + 0.5);
      const tilt = Math.atan2(x.canopy, x.depth);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(pe, x.topM + x.canopy / 2, -pn),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, (-brg * Math.PI) / 180 + Math.PI / 2, 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      kit.add(roof, m, k % 2 ? 0xe8e4da : 0x2f4f6e);
    }
    return;
  }
  for (const y of x.floorsM) {
    const ce = (x.a[0] + x.b[0]) / 2 + oe * (x.depth / 2);
    const cn = (x.a[1] + x.b[1]) / 2 + on * (x.depth / 2);
    kit.box(ce, y, cn, x.depth, 0.2, len - 1, brg, 0xe9e9e6);
    kit.box((x.a[0] + x.b[0]) / 2 + oe * x.depth, y + 0.2, (x.a[1] + x.b[1]) / 2 + on * x.depth, 0.04, 1.0, len - 1, brg, 0x8fb1bf);
  }
}
