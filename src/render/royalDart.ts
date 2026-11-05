import * as THREE from 'three';
import { Builder, Frame, renderTex, roof, signTex, slateTex, stoneTex, windowAt, type Key } from './rdyc';
import { insetRingAdaptive } from './landmarks';
import type { PontoonPier } from './pontoons';

/**
 * The Royal Dart, Kingswear (c. 1850, Italianate, Grade II; the Royal Dart Hotel, now apartments and the Royal
 * Dart Bars), modelled as itself from the owner's photographs (5 Nov 2026, SOURCES.md P8) on OpenStreetMap's
 * footprint, between the Lower Ferry's slipway (south) and the passenger ferry's gangway (north):
 *  - the main block: cream render, four storeys from the water, a low hipped zinc roof on deep eaves with paired
 *    brackets and a frieze, three sash windows across the top floor, rendered chimney stacks;
 *  - on its river front the wide splayed bay (Historic England: "a wide splayed two-storey bay with cast-iron
 *    balcony with tented roof on thin iron columns"): a solid ground floor on a granite plinth with a navy base,
 *    the ROYAL DART BARS sign on a navy fascia; above it a first-floor balcony and a second-floor balcony with a
 *    white cast-iron balustrade, French windows behind, thin white columns, and a grey tented canopy over them;
 *  - the rear range, lower, up the slope behind;
 *  - the north wing: white, its first floor of large windows over an open loggia on white columns where the
 *    passenger gangway lands, a slate roof and a small square lantern;
 *  - the passenger pier drawn as a white lattice-truss gangway from the loggia to a pontoon (passengerPierAsDrawn).
 * Storey heights, the bay's balcony depth, the canopy's profile, the window sizes and positions are read from the
 * photographs, not measured (E). The footprint and the top (16.1 m ODN) are the data's.
 */

/** The building's frame: x into the building from the river front (bearing about 102°), y along the front (north). */
export const ROYAL_DART_FRAME = { origin: [2.3, 48.5] as [number, number], thetaDeg: -11.8 };
const F = new Frame(ROYAL_DART_FRAME.origin, ROYAL_DART_FRAME.thetaDeg, 0);

/** Frame (x, y) to local (e, n), and back. */
export const royalDartToEN = (x: number, y: number): [number, number] => F.toEN(x, y);
export const royalDartFromEN = (e: number, n: number): [number, number] => F.fromEN(e, n);

/** Levels (m ODN, E: read from the photographs against the data's top). */
export const RD_LEVELS = {
  plinth: -2.5,
  /** The navy base band, then the render. */
  band: 1.0,
  ground: 2.0,
  /** The navy fascia (with the sign) under the first-floor balcony. */
  fascia: 4.5,
  first: 5.0,
  second: 8.2,
  /** The canopy's edge, and where it meets the wall. */
  canopy: 11.2,
  canopyTop: 12.55,
  eaves: 15.0,
  top: 16.1,
} as const;

/** The main block on plan (frame). */
export const RD_BLOCK = { x0: 0, x1: 12.5, y0: 0, y1: 11.2 };
/** The splayed bay on the river front (frame): from the wall in the south, round, to the wall in the north. */
export const RD_BAY: [number, number][] = [[0, 1.3], [-1.95, 3.2], [-1.95, 8.2], [0, 10.1]];
/** The balconies' depth inside the bay's outline (E). */
const BALCONY = 1.0;
/** The rear range behind the main block (frame), lower (E). */
const REAR = { x0: 12.5, x1: 22.5, y0: 1.3, y1: 13.9, eaves: 12.2 };

/** The north wing's levels (m ODN, E): the loggia's floor (the gangway lands on it), its first floor, the eaves. */
export const RD_WING = { loggia: 3.0, first: 5.6, eaves: 8.8, top: 10.2, loggiaDepth: 1.8 } as const;

/**
 * The passenger pier as OpenStreetMap maps it: a centreline (a fixed pier 3 m wide) from the wing's loggia out to
 * where the passenger ferries berth, and an outline of the same walkway ending in a landing stage 22 m long
 * along the river. Its shore end, the landing stage's centreline (south to north) and width, from the outline.
 */
export const KINGSWEAR_PASSENGER_PIER = {
  river: [-23.6, 80.0] as [number, number],
  shore: [5.75, 61.15] as [number, number],
  head: [[-27.85, 69.95], [-15.4, 88.4]] as [[number, number], [number, number]],
  headWidth: 4.2,
};

// ------------------------------------------------------------------ plan helpers

/**
 * An open polyline offset sideways by d (positive: to the left of travel), mitred at its corners. Its two ends
 * slide along the line x = wallX (the wall the bay stands out from).
 */
export function offsetPolyline(pts: readonly [number, number][], d: number, wallX: number): [number, number][] {
  const lines = pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const u: [number, number] = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const nrm: [number, number] = [-u[1], u[0]];
    return { p: [p[0] + nrm[0] * d, p[1] + nrm[1] * d] as [number, number], u };
  });
  const meet = (a: (typeof lines)[number], b: (typeof lines)[number]): [number, number] => {
    const den = a.u[0] * b.u[1] - a.u[1] * b.u[0];
    if (Math.abs(den) < 1e-9) return [b.p[0], b.p[1]];
    const t = ((b.p[0] - a.p[0]) * b.u[1] - (b.p[1] - a.p[1]) * b.u[0]) / den;
    return [a.p[0] + a.u[0] * t, a.p[1] + a.u[1] * t];
  };
  const onWall = (l: (typeof lines)[number]): [number, number] => {
    if (Math.abs(l.u[0]) < 1e-9) return [wallX, l.p[1]];
    const t = (wallX - l.p[0]) / l.u[0];
    return [wallX, l.p[1] + l.u[1] * t];
  };
  const out: [number, number][] = [onWall(lines[0]!)];
  for (let i = 1; i < lines.length; i++) out.push(meet(lines[i - 1]!, lines[i]!));
  out.push(onWall(lines[lines.length - 1]!));
  return out;
}

/** Signed area of a ring (positive: counter-clockwise). */
function area(ring: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The outward (left of travel for the bay, which runs south to north round its front) unit normal of p→q. */
const leftNormal = (p: readonly [number, number], q: readonly [number, number]): [number, number] => {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
};

// ------------------------------------------------------------------ materials

let matCache: Record<Key, THREE.MeshStandardMaterial> | undefined;
function materials(): Record<Key, THREE.MeshStandardMaterial> {
  if (matCache) return matCache;
  const m = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, envMapIntensity: 0.4, ...opts });
  const tex = (t: THREE.Texture | undefined, tint: number, fallback: number, opts: THREE.MeshStandardMaterialParameters = {}) => (t ? m(tint, { map: t, ...opts }) : m(fallback, opts));
  const trim = m(0xf6f5f0, { roughness: 0.6 });
  const render = tex(renderTex(), 0xf9edcf, 0xede2c4);
  matCache = {
    // Cream render, as all four photographs show it.
    render,
    brick: render,
    slate: tex(slateTex(), 0xffffff, 0x4b5158, { roughness: 0.7 }),
    trim,
    canvas: trim,
    glass: m(0x1f2a33, { roughness: 0.15, metalness: 0.6 }),
    // Granite blocks at the water (the stone texture, greyed).
    stone: tex(stoneTex(), 0xb4b3ae, 0x9d9a92, { roughness: 0.95 }),
    coping: m(0xb5afa3, { roughness: 0.9 }),
    paving: m(0x9d988e, { roughness: 0.9 }),
    // The zinc roof of the refurbishment and the grey tented canopy.
    lead: m(0x8a8884, { roughness: 0.6, metalness: 0.05, envMapIntensity: 0.15 }),
    pot: m(0xa65a3a),
    sign: tex(signTex('royal-dart-sign', 'ROYAL DART BARS', '#ffffff', '#1d2b45', 512, 64), 0xffffff, 0x1d2b45, { roughness: 0.5 }),
    name: tex(signTex('royal-dart-name', 'THE ROYAL DART', '#ffffff', '#1d2b45', 512, 64), 0xffffff, 0x1d2b45, { roughness: 0.5 }),
    steel: m(0x2c3036, { roughness: 0.6 }),
    navy: m(0x1d2b45, { roughness: 0.6 }),
  };
  return matCache;
}

// ------------------------------------------------------------------ the building

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** A wall along a frame polyline segment p→q, heights h0..h1, facing its left (outward for the bay's run). */
function wallLeft(b: Builder, key: Key, p: readonly [number, number], q: readonly [number, number], h0: number, h1: number, inset = 0): void {
  const [ox, oy] = leftNormal(p, q);
  b.wall(key, p[0] + ox * inset, p[1] + oy * inset, q[0] + ox * inset, q[1] + oy * inset, h0, h1, ox, oy);
}

/** A rail along a polyline: top and bottom rails and balusters (white cast iron, E). */
function railing(b: Builder, pts: readonly [number, number][], h0: number, h1: number, spacing: number, mid?: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    b.beam('trim', p[0], p[1], q[0], q[1], 0.07, h1 - 0.08, h1);
    b.beam('trim', p[0], p[1], q[0], q[1], 0.05, h0 + 0.04, h0 + 0.1);
    if (mid !== undefined) b.beam('trim', p[0], p[1], q[0], q[1], 0.04, mid - 0.03, mid + 0.03);
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.round(L / spacing));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      b.box('trim', p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, h0 + 0.1, 0.035, 0.035, h1 - h0 - 0.18);
    }
  }
}

/** A thin white column (cast iron) at frame (x, y), from h0 to h1. */
function column(b: Builder, x: number, y: number, h0: number, h1: number, r = 0.065): void {
  const p = F.P(x, y, (h0 + h1) / 2);
  b.add('trim', new THREE.CylinderGeometry(r, r * 1.15, h1 - h0, 8), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
}

/** A rendered chimney stack with a cap and two pots. */
function stack(b: Builder, x: number, y: number, h0: number, top: number, sx: number, sy: number): void {
  b.box('render', x, y, h0, sx, sy, top - h0);
  b.box('coping', x, y, top, sx + 0.16, sy + 0.16, 0.14);
  for (const k of [-1, 1]) {
    const along = sx >= sy;
    const p = F.P(x + (along ? (k * sx) / 4 : 0), y + (along ? 0 : (k * sy) / 4), top + 0.14 + 0.28);
    b.add('pot', new THREE.CylinderGeometry(0.11, 0.14, 0.56, 8), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
  }
}

/** The main block's walls, cornice, brackets, roof and stacks. */
function mainBlock(b: Builder): void {
  const L = RD_LEVELS;
  const { x0, x1, y0, y1 } = RD_BLOCK;
  // Walls: the front (behind the bay), the south side over the slipway, the north side, the back.
  b.wall('render', x0, y1, x0, y0, L.ground, L.eaves, -1, 0);
  b.wall('render', x0, y0, x1, y0, L.plinth, L.eaves, 0, -1);
  b.wall('render', x1, y1, x0, y1, L.plinth, L.eaves, 0, 1);
  b.wall('render', x1, y0, x1, y1, REAR.eaves, L.eaves, 1, 0);
  // The front's narrow returns either side of the bay stand on the plinth and the navy band.
  for (const [ya, yb] of [[y0, RD_BAY[0]![1]], [RD_BAY[3]![1], y1]] as const) {
    b.wall('stone', x0 - 0.04, yb, x0 - 0.04, ya, L.plinth, L.band, -1, 0);
    b.wall('navy', x0 - 0.02, yb, x0 - 0.02, ya, L.band, L.ground, -1, 0);
  }
  // The navy band and a granite course along the foot of the south side, by the slipway.
  b.wall('stone', x0, y0 - 0.04, x1, y0 - 0.04, L.plinth, L.band, 0, -1);
  b.wall('navy', x0, y0 - 0.02, x1, y0 - 0.02, L.band, L.ground, 0, -1);
  // Three sash windows across the top floor, above the canopy.
  for (const y of [2.3, 5.6, 8.9]) windowAt(b, x0, y, -1, 0, 1.05, 12.85, 14.45);
  // The south side: three bays of sashes on each floor (E).
  for (const x of [2.6, 6.4, 10.2]) {
    windowAt(b, x, y0, 0, -1, 1.0, 2.7, 4.3);
    windowAt(b, x, y0, 0, -1, 1.0, 5.6, 7.6);
    windowAt(b, x, y0, 0, -1, 1.0, 8.8, 10.8);
    windowAt(b, x, y0, 0, -1, 1.0, 12.6, 14.2);
  }
  // The north side above the wing's roof.
  for (const x of [2.4, 5.4, 8.4, 11.2]) windowAt(b, x, y1, 0, 1, 0.95, 12.6, 14.2);
  // The frieze under the eaves, a little proud of the walls, and paired brackets under the soffit (Italianate).
  const fr = 0.05;
  b.wall('trim', x0 - fr, y1, x0 - fr, y0, 14.45, L.eaves, -1, 0);
  b.wall('trim', x0, y0 - fr, x1, y0 - fr, 14.45, L.eaves, 0, -1);
  b.wall('trim', x1, y1 + fr, x0, y1 + fr, 14.45, L.eaves, 0, 1);
  b.wall('trim', x1 + fr, y0, x1 + fr, y1, 14.45, L.eaves, 1, 0);
  const o = 0.9;
  for (let y = 0.5; y < y1; y += 1.35) for (const dy of [-0.14, 0.14]) b.box('trim', x0 - o / 2, y + dy, 14.55, o - 0.05, 0.1, 0.32);
  for (let x = 0.6; x < x1; x += 1.35) {
    for (const dx of [-0.14, 0.14]) {
      b.box('trim', x + dx, y0 - o / 2, 14.55, 0.1, o - 0.05, 0.32);
      b.box('trim', x + dx, y1 + o / 2, 14.55, 0.1, o - 0.05, 0.32);
    }
  }
  // The low hipped roof (zinc) on deep eaves, and the soffit under them.
  const slope = (L.top - L.eaves) / ((y1 - y0) / 2);
  roof(b, { x0, x1, y0, y1, axis: 'x', eaves: L.eaves, slope, lo: 'hip', hi: 'hip', wallKey: 'render', o, key: 'lead' });
  const s = L.eaves - o * slope - 0.02;
  b.poly('trim', [F.P(x0 - o, y0 - o, s), F.P(x1 + o, y0 - o, s), F.P(x1 + o, y1 + o, s), F.P(x0 - o, y1 + o, s)], DOWN);
  // Rendered stacks at the back corners, as the photographs show one over the slipway side.
  stack(b, x1 - 1.0, 0.8, L.eaves - 0.6, 17.7, 1.4, 0.7);
  stack(b, x1 - 1.0, y1 - 0.8, L.eaves - 0.6, 17.5, 1.4, 0.7);
}

/** The splayed bay, its balconies, columns, balustrades, sign and tented canopy. */
function bay(b: Builder): void {
  const L = RD_LEVELS;
  const outer = RD_BAY;
  const inner = offsetPolyline(outer, -BALCONY, 0);
  // Ground floor: render on a navy band on the granite plinth, the navy fascia at the top.
  for (let i = 0; i < outer.length - 1; i++) {
    const p = outer[i]!;
    const q = outer[i + 1]!;
    wallLeft(b, 'stone', p, q, L.plinth, L.band, 0.04);
    wallLeft(b, 'navy', p, q, L.band, L.ground, 0.02);
    wallLeft(b, 'render', p, q, L.ground, L.fascia);
    wallLeft(b, 'navy', p, q, L.fascia, L.first + 0.05, 0.03);
  }
  // Its windows: a wide one in the front, one in each splay.
  windowAt(b, -1.95, 5.7, -1, 0, 2.6, 2.7, 4.15);
  for (const [p, q] of [[outer[0]!, outer[1]!], [outer[2]!, outer[3]!]] as const) {
    const [ox, oy] = leftNormal(p, q);
    windowAt(b, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, ox, oy, 0.8, 2.7, 4.15);
  }
  // The sign on the front's fascia, read from the river (the viewer's left is the north end).
  b.sign('sign', [-1.95 - 0.05, 7.6], [-1.95 - 0.05, 3.8], L.fascia + 0.04, L.first - 0.02);
  // The first-floor balcony is the ground floor's flat roof.
  b.poly('paving', outer.map(([x, y]) => F.P(x, y, L.first + 0.05)), UP);
  // The bay's upper walls (first and second floors) behind the balconies, with French windows.
  for (let i = 0; i < inner.length - 1; i++) wallLeft(b, 'render', inner[i]!, inner[i + 1]!, L.first, L.canopy + 0.2);
  for (const [h0, h1] of [[L.first + 0.15, L.first + 2.7], [L.second + 0.15, L.second + 2.7]] as const) {
    for (const y of [4.75, 6.65]) windowAt(b, inner[1]![0], y, -1, 0, 0.95, h0, h1, 'door');
    for (const [p, q] of [[inner[0]!, inner[1]!], [inner[2]!, inner[3]!]] as const) {
      const [ox, oy] = leftNormal(p, q);
      windowAt(b, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, ox, oy, 0.75, h0, h1, 'door');
    }
  }
  // The second-floor balcony: a slab between the outline and the upper walls, edged in white.
  const ring = [...outer, ...[...inner].reverse()];
  b.poly('paving', ring.map(([x, y]) => F.P(x, y, L.second)), UP);
  b.poly('trim', ring.map(([x, y]) => F.P(x, y, L.second - 0.18)), DOWN);
  for (let i = 0; i < outer.length - 1; i++) wallLeft(b, 'trim', outer[i]!, outer[i + 1]!, L.second - 0.2, L.second + 0.02, 0.03);
  // Balustrades: a plain rail on the first-floor balcony, the cast-iron one on the second (inset from the edge).
  const railLine = offsetPolyline(outer, -0.12, 0);
  railing(b, railLine, L.first + 0.05, L.first + 1.0, 0.24);
  railing(b, railLine, L.second, L.second + 1.0, 0.16, L.second + 0.45);
  // Thin columns at the balconies' outer edge, from the first floor to the canopy.
  const cols: [number, number][] = [];
  for (let i = 0; i < railLine.length - 1; i++) {
    const p = railLine[i]!;
    const q = railLine[i + 1]!;
    const n = i === 1 ? 3 : 2;
    for (let k = 0; k < n; k++) cols.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  cols.push(railLine[railLine.length - 1]!);
  for (const [x, y] of cols) column(b, x, y, L.first + 0.05, L.canopy);
  // The tented canopy: from just beyond the bay's outline up to the wall, steepening as it rises (bellcast).
  const edge = offsetPolyline(outer, 0.25, 0);
  const steps: [number, number][] = [[0, L.canopy], [0.7, L.canopy + 0.25], [1.4, L.canopy + 0.65], [2.18, L.canopyTop]];
  const rings = steps.map(([d, h]) => ({ pts: offsetPolyline(edge, -d, 0), h }));
  for (let r = 0; r < rings.length - 1; r++) {
    const lo = rings[r]!;
    const hi = rings[r + 1]!;
    for (let i = 0; i < lo.pts.length - 1; i++) {
      const [ox, oy] = leftNormal(lo.pts[i]!, lo.pts[i + 1]!);
      const out = F.dir(ox, oy).add(UP.clone().multiplyScalar(0.8)).normalize();
      b.poly('lead', [F.P(lo.pts[i]![0], lo.pts[i]![1], lo.h), F.P(lo.pts[i + 1]![0], lo.pts[i + 1]![1], lo.h), F.P(hi.pts[i + 1]![0], hi.pts[i + 1]![1], hi.h), F.P(hi.pts[i]![0], hi.pts[i]![1], hi.h)], out);
    }
  }
  // Its underside, and a white valance round its edge.
  b.poly('trim', edge.map(([x, y]) => F.P(x, y, L.canopy - 0.01)), DOWN);
  for (let i = 0; i < edge.length - 1; i++) wallLeft(b, 'trim', edge[i]!, edge[i + 1]!, L.canopy - 0.16, L.canopy + 0.02);
}

/** The rear range up the slope behind the main block (E: its height and windows). */
function rearRange(b: Builder): void {
  const { x0, x1, y0, y1, eaves } = REAR;
  b.wall('render', x0, y0, x1, y0, 0, eaves, 0, -1);
  b.wall('render', x1, y0, x1, y1, 0, eaves, 1, 0);
  b.wall('render', x1, y1, x0, y1, 0, eaves, 0, 1);
  roof(b, { x0, x1, y0, y1, axis: 'x', eaves, slope: 0.3, lo: 'none', hi: 'hip', wallKey: 'render', key: 'slate' });
  for (const x of [14.6, 17.1, 19.6]) {
    windowAt(b, x, y0, 0, -1, 1.0, 3.6, 5.1);
    windowAt(b, x, y0, 0, -1, 1.0, 6.4, 8.0);
    windowAt(b, x, y0, 0, -1, 1.0, 9.3, 10.9);
  }
  for (const y of [4.2, 7.6, 11.0]) {
    windowAt(b, x1, y, 1, 0, 1.0, 6.4, 8.0);
    windowAt(b, x1, y, 1, 0, 1.0, 9.3, 10.9);
  }
  stack(b, x1 - 1.2, 7.6, eaves - 0.5, 15.2, 0.7, 1.3);
}

/**
 * The north wing on its footprint (`ring`, local e, n): white, the first floor of large windows over an open
 * loggia on white columns on its river faces (where the passenger gangway lands), plain walls elsewhere, the
 * walls it shares with the main building set just inside it; a slate roof sloping up to a flat top, and a small
 * square lantern (E).
 */
function wing(b: Builder, ringEN: readonly (readonly [number, number])[]): void {
  const W = RD_WING;
  let ring = ringEN.map(([e, n]) => F.fromEN(e, n));
  if (area(ring) < 0) ring = ring.reverse();
  const N = ring.length;
  const edges = ring.map((p, i) => {
    const q = ring[(i + 1) % N]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    // Counter-clockwise: the outward normal is to the right of travel.
    const o: [number, number] = L > 0 ? [(q[1] - p[1]) / L, -(q[0] - p[0]) / L] : [0, 0];
    const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const kind = o[1] < -0.5 ? 'shared' : o[0] < -0.6 && mid[1] < 19.5 && L > 2 ? 'loggia' : 'plain';
    return { p, q, L, o, kind };
  });
  for (const ed of edges) {
    const { p, q, o, L } = ed;
    if (L < 0.3) continue;
    const at = (t: number, d = 0): [number, number] => [p[0] + (q[0] - p[0]) * t - o[0] * d, p[1] + (q[1] - p[1]) * t - o[1] * d];
    if (ed.kind === 'shared') {
      const [a, c] = [at(0, 0.2), at(1, 0.2)];
      b.wall('render', a[0], a[1], c[0], c[1], 1.7, W.eaves, o[0], o[1]);
      continue;
    }
    if (ed.kind === 'plain') {
      b.wall('render', p[0], p[1], q[0], q[1], 1.7, W.eaves, o[0], o[1]);
      const n = Math.floor(L / 2.4);
      for (let k = 0; k < n; k++) {
        const [x, y] = at((k + 0.5) / n);
        windowAt(b, x, y, o[0], o[1], 1.0, 3.6, 5.0);
        windowAt(b, x, y, o[0], o[1], 1.1, 6.1, 8.0);
      }
      continue;
    }
    // The loggia: a stone base at the water, white columns on the face, the wall set back behind them, the
    // ceiling and the floor; the first floor's wall over it with large windows, and a white band between.
    b.wall('stone', p[0] - o[0] * 0.04, p[1] - o[1] * 0.04, q[0] - o[0] * 0.04, q[1] - o[1] * 0.04, -1.5, W.loggia, o[0], o[1]);
    const [a, c] = [at(0, W.loggiaDepth), at(1, W.loggiaDepth)];
    b.wall('render', a[0], a[1], c[0], c[1], W.loggia, W.first, o[0], o[1]);
    b.poly('trim', [F.P(p[0], p[1], W.first), F.P(q[0], q[1], W.first), F.P(c[0], c[1], W.first), F.P(a[0], a[1], W.first)], DOWN);
    b.poly('paving', [F.P(p[0], p[1], W.loggia), F.P(q[0], q[1], W.loggia), F.P(c[0], c[1], W.loggia), F.P(a[0], a[1], W.loggia)], UP);
    const nc = Math.max(1, Math.round(L / 2.6));
    for (let k = 0; k <= nc; k++) {
      const [x, y] = at(k / nc, 0.25);
      column(b, x, y, W.loggia, W.first - 0.25, 0.13);
      b.box('trim', x, y, W.first - 0.25, 0.36, 0.36, 0.25);
    }
    // Doors in the back wall.
    for (let k = 0; k < Math.max(1, Math.floor(L / 3)); k++) {
      const [x, y] = at((k + 0.5) / Math.max(1, Math.floor(L / 3)), W.loggiaDepth);
      windowAt(b, x, y, o[0], o[1], 1.2, W.loggia + 0.05, W.loggia + 2.2, 'door');
    }
    b.wall('render', p[0], p[1], q[0], q[1], W.first, W.eaves, o[0], o[1]);
    b.wall('trim', p[0] - o[0] * 0.04, p[1] - o[1] * 0.04, q[0] - o[0] * 0.04, q[1] - o[1] * 0.04, W.first - 0.05, W.first + 0.25, o[0], o[1]);
    const nw = Math.max(1, Math.floor(L / 1.9));
    for (let k = 0; k < nw; k++) {
      const [x, y] = at((k + 0.5) / nw);
      windowAt(b, x, y, o[0], o[1], 1.25, W.first + 0.45, W.eaves - 0.45);
    }
  }
  // The roof: slate slopes up from the eaves to a flat top (as the town's larger roofs), a white fascia.
  let inner: [number, number][] | undefined;
  for (const d of [2.4, 1.8, 1.2]) if ((inner = insetRingAdaptive(ring, d))) break;
  for (const ed of edges) b.wall('trim', ed.p[0] + ed.o[0] * 0.04, ed.p[1] + ed.o[1] * 0.04, ed.q[0] + ed.o[0] * 0.04, ed.q[1] + ed.o[1] * 0.04, W.eaves - 0.25, W.eaves, ed.o[0], ed.o[1]);
  if (inner && inner.length === N) {
    for (let i = 0; i < N; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % N]!;
      const ip = inner[i]!;
      const iq = inner[(i + 1) % N]!;
      const o = edges[i]!.o;
      const out = F.dir(o[0], o[1]).add(UP.clone().multiplyScalar(1.5)).normalize();
      b.poly('slate', [F.P(p[0], p[1], W.eaves), F.P(q[0], q[1], W.eaves), F.P(iq[0], iq[1], W.top), F.P(ip[0], ip[1], W.top)], out);
    }
    b.poly('slate', inner.map(([x, y]) => F.P(x, y, W.top)), UP);
  } else b.poly('slate', ring.map(([x, y]) => F.P(x, y, W.eaves)), UP);
  // The square lantern on the roof beside the main block (owner's photographs: white, a small hipped cap).
  const lx = 6.6;
  const ly = 15.6;
  b.wall('render', lx - 0.9, ly - 0.9, lx + 0.9, ly - 0.9, W.eaves, 12.0, 0, -1);
  b.wall('render', lx + 0.9, ly - 0.9, lx + 0.9, ly + 0.9, W.eaves, 12.0, 1, 0);
  b.wall('render', lx + 0.9, ly + 0.9, lx - 0.9, ly + 0.9, W.eaves, 12.0, 0, 1);
  b.wall('render', lx - 0.9, ly + 0.9, lx - 0.9, ly - 0.9, W.eaves, 12.0, -1, 0);
  for (const [ox, oy] of [[-1, 0], [0, 1], [1, 0], [0, -1]] as const) windowAt(b, lx + ox * 0.9, ly + oy * 0.9, ox, oy, 0.6, 10.7, 11.6, 'none');
  roof(b, { x0: lx - 0.9, x1: lx + 0.9, y0: ly - 0.9, y1: ly + 0.9, axis: 'x', eaves: 12.0, slope: 0.55, lo: 'hip', hi: 'hip', wallKey: 'render', o: 0.25, key: 'slate' });
}

export interface RoyalDart {
  group: THREE.Group;
  /** 0 by day … 1 at night: the apartments' and the bar's windows glow. */
  setNight(x: number): void;
  triangles: number;
}

/** The Royal Dart and its north wing (src/render/dart.ts adds them in place of the plain footprints). */
export function buildRoyalDart(wingRing?: readonly (readonly [number, number])[]): RoyalDart {
  const b = new Builder(F);
  mainBlock(b);
  bay(b);
  rearRange(b);
  if (wingRing && wingRing.length >= 3) wing(b, wingRing);
  // The glass is shared by every window of the building; it glows at night.
  const mats = materials();
  const group = b.build(mats, 'royal-dart');
  const glass = mats.glass;
  glass.emissive.setHex(0xffc27a);
  glass.emissiveIntensity = 0;
  return {
    group,
    setNight: (x: number) => {
      glass.emissiveIntensity = 0.7 * x;
    },
    triangles: b.tris,
  };
}

// ------------------------------------------------------------------ the passenger pier

/**
 * Kingswear's passenger pier as drawn (E, the owner's photographs): its walkway is a white lattice-truss gangway
 * from the wing's loggia (at the loggia's floor) down to the landing stage, which is a floating pontoon along the
 * river with guide piles. OpenStreetMap's two features for it (the outline and the centreline) give way to these;
 * the outline is still what boats meet (src/sim/race/piers.ts). Other piers are returned as they are.
 */
export function passengerPierAsDrawn<P extends PontoonPier>(p: P): PontoonPier[] {
  const { river, shore, head, headWidth } = KINGSWEAR_PASSENGER_PIER;
  const near = (a: readonly [number, number], c: readonly [number, number], tol = 1.5) => Math.hypot(a[0] - c[0], a[1] - c[1]) < tol;
  const pts = p.line ?? p.poly ?? [];
  const isLine = !!p.line && p.line.length === 2 && pts.some((q) => near(q, river)) && pts.some((q) => near(q, shore));
  const isOutline = !!p.poly && pts.some((q) => near(q, river)) && pts.some((q) => near(q, shore));
  if (p.floating || (!isLine && !isOutline)) return [p];
  if (isLine) return [];
  // The gangway lands just inside the landing stage's shore-side edge, at its middle.
  const mid: [number, number] = [(head[0][0] + head[1][0]) / 2, (head[0][1] + head[1][1]) / 2];
  const L = Math.hypot(head[1][0] - head[0][0], head[1][1] - head[0][1]);
  const across: [number, number] = [(head[1][1] - head[0][1]) / L, -(head[1][0] - head[0][0]) / L];
  const toShore = across[0] * (shore[0] - mid[0]) + across[1] * (shore[1] - mid[1]) > 0 ? 1 : -1;
  const landing: [number, number] = [mid[0] + across[0] * toShore * (headWidth / 2 - 0.8), mid[1] + across[1] * toShore * (headWidth / 2 - 0.8)];
  return [
    {
      name: 'Kingswear passenger pontoon',
      floating: true,
      line: [head[0], head[1]],
      width: headWidth,
      gangway: { shore, pontoon: landing, style: 'truss', shoreY: RD_WING.loggia, width: 2.4 },
    },
  ];
}
