import * as THREE from 'three';
import { Kit as LKit } from './landmarks';
import { Kit, VMAT, hull, outboard, place } from './vessels';
import type { QuayWall } from '../sim/env/quays';

/**
 * The Boatfloat, Dartmouth: the walled basin behind the South Embankment where small boats lie (Historic England
 * 'The Boat Float', as quoted in search results: reclaimed land on its north, west and south sides, the Embankment of
 * about 1889 its east side; docs/SOURCES.md V14). As the owner's photographs of 12 Nov 2026 show it: stone walls
 * green with weed below high water, iron ladders down them, black railings along the top, the arch under the
 * Embankment that lets the tide in and out, and the basin full of small boats - launches and dinghies under blue and
 * grey covers - lying close along the walls, afloat at high water and on the mud at low.
 *
 * The walls are the town's quay walls inside the basin (src/sim/env/quays.ts); the boats, the railing, the ladders
 * and the arch are added here. Where the arch is (its north-east corner) is judged from the photographs, and the
 * number of boats, their sizes and colours are estimates (E). Visual only: no boat can reach the basin.
 */

/** The basin (local e, n): a box round it. */
export const BOATFLOAT_BOX = { eMin: -348, eMax: -286, nMin: 360, nMax: 428 };
/** Where the arch opens on the river wall and on the basin's wall (E: the basin's north-east corner). */
export const BOATFLOAT_ARCH = { river: [-268, 404] as [number, number], basin: [-292, 404] as [number, number], width: 4.2 };

const inBox = (e: number, n: number) => e >= BOATFLOAT_BOX.eMin && e <= BOATFLOAT_BOX.eMax && n >= BOATFLOAT_BOX.nMin && n <= BOATFLOAT_BOX.nMax;

/**
 * The basin's edge (local e, n), going round it with the water on the right (clockwise from its north-west
 * corner), from the 4 m ground: the line where its floor meets the rim. E: about a metre either way.
 */
export const BOATFLOAT_EDGE: [number, number][] = [[-338, 421], [-292, 420], [-293, 367], [-340, 368]];

/**
 * Walls round the basin where the town's quay walls leave a gap (the 4 m ground smooths them into banks, and the
 * quay rule builds walls only where houses stand near): every 2 m along its edge farther than 3 m from a wall
 * already there, topped at the ground 3 m behind (2.6–4.2 m ODN, E).
 */
export function missingBasinWalls(existing: readonly QuayWall[], ground: (e: number, n: number) => number): QuayWall[] {
  // Within 3 m of a wall already there (of its line, not only its points).
  const near = (e: number, n: number) =>
    existing.some((w) =>
      w.line.some((p, i) => {
        const q = w.line[i + 1];
        if (!q) return Math.hypot(p[0] - e, p[1] - n) < 3;
        const le = q[0] - p[0];
        const ln = q[1] - p[1];
        const l2 = le * le + ln * ln || 1;
        const t = Math.max(0, Math.min(1, ((e - p[0]) * le + (n - p[1]) * ln) / l2));
        return Math.hypot(p[0] + le * t - e, p[1] + ln * t - n) < 3;
      }),
    );
  const out: QuayWall[] = [];
  for (let i = 0; i < BOATFLOAT_EDGE.length; i++) {
    const [e0, n0] = BOATFLOAT_EDGE[i]!;
    const [e1, n1] = BOATFLOAT_EDGE[(i + 1) % BOATFLOAT_EDGE.length]!;
    const len = Math.hypot(e1 - e0, n1 - n0);
    const ue = (e1 - e0) / len;
    const un = (n1 - n0) / len;
    let run: [number, number][] = [];
    let tops: number[] = [];
    const flush = () => {
      if (run.length >= 2) out.push({ line: run, top: Math.max(2.6, Math.min(4.2, tops.reduce((a, x) => a + x, 0) / tops.length)) });
      run = [];
      tops = [];
    };
    for (let d = 0; d <= len + 1e-6; d += 2) {
      const e = e0 + ue * d;
      const n = n0 + un * d;
      if (near(e, n)) {
        flush();
        continue;
      }
      run.push([e, n]);
      // Behind the wall: the left of travel.
      tops.push(ground(e - un * 3, n + ue * 3));
    }
    flush();
  }
  return out;
}

/** The quay walls that line the basin (their points inside its box). */
export function boatfloatWalls(quays: readonly QuayWall[]): QuayWall[] {
  return quays
    .map((q) => ({ ...q, line: q.line.filter(([e, n]) => inBox(e, n)) }))
    .filter((q) => q.line.length >= 2);
}

interface Slot {
  e: number;
  n: number;
  heading: number;
  bed: number;
  obj: THREE.Object3D;
}

const SMALL_BOATS: { length: number; beam: number; kind: 'launch' | 'dinghy' | 'cuddy' }[] = [
  { length: 5.2, beam: 2.0, kind: 'launch' },
  { length: 4.2, beam: 1.7, kind: 'launch' },
  { length: 3.2, beam: 1.4, kind: 'dinghy' },
  { length: 6.0, beam: 2.3, kind: 'cuddy' },
];
const COVERS = [0x2a4f8a, 0x3a6cb0, 0x59646d, 0x1f3550, 0x8a2f2f];

/** A small boat lying in the basin: an open launch with an outboard and a cover, a dinghy, or a small cuddy cruiser. */
function smallBoat(i: number): THREE.Group {
  const spec = SMALL_BOATS[i % SMALL_BOATS.length]!;
  const kit = new Kit();
  const hullColour = i % 5 === 3 ? 0x2b5e8f : i % 7 === 5 ? 0x9b2b2b : 0xf2f1ec;
  const h = hull(kit, {
    length: spec.length, beam: spec.beam, freeboard: 0.55, draft: 0.3, sheerBow: 0.18, stemRake: 0.35, entry: 0.42, transom: 0.85, deadrise: 0.3, chine: true,
    colours: { bottom: 0x7a2420, boot: 0x1d1f22, topsides: hullColour, deck: 0xd9d6cc }, stations: 12, sections: 6,
  }, VMAT.gloss);
  const cover = COVERS[i % COVERS.length]!;
  const L = spec.length;
  if (spec.kind === 'dinghy') {
    for (const z of [-0.3, 0.6]) kit.box(spec.beam - 0.35, 0.05, 0.25, VMAT.paint, 0xb08a5a, 0, h.deck(z) + 0.25, z);
  } else if (spec.kind === 'launch') {
    // A cover over the open boat, a little peaked, and the outboard tilted up on the transom.
    kit.add(new THREE.CapsuleGeometry(spec.beam * 0.44, L * 0.5, 2, 8).rotateX(Math.PI / 2).scale(1, 0.3, 1), VMAT.canvas, cover, place(0, h.deck(0) + 0.1, 0.1));
    outboard(kit, 0, h.deck(L / 2), L / 2 - 0.1);
  } else {
    kit.box(spec.beam - 0.6, 0.6, L * 0.35, VMAT.gloss, 0xf2f1ec, 0, h.deck(-0.4) + 0.3, -0.4);
    kit.box(spec.beam - 0.7, 0.22, L * 0.25, VMAT.glass, undefined, 0, h.deck(-0.4) + 0.55, -0.6);
    kit.add(new THREE.CapsuleGeometry(spec.beam * 0.38, L * 0.22, 2, 8).rotateX(Math.PI / 2).scale(1, 0.3, 1), VMAT.canvas, cover, place(0, h.deck(1) + 0.08, L * 0.28));
    outboard(kit, 0, h.deck(L / 2), L / 2 - 0.1);
  }
  const g = new THREE.Group();
  g.add(kit.build('boatfloat-boat'));
  return g;
}

/**
 * The Boatfloat's dressing. `walls` are its quay walls (boatfloatWalls), `riverWalls` all the town's (for the arch on
 * the river face), `ground` the ground or bed (m ODN). Boats go in `floating` (the water at y = 0), the rest in
 * `fixed` (m ODN).
 */
export class Boatfloat {
  readonly fixed = new THREE.Group();
  readonly floating = new THREE.Group();
  private readonly slots: Slot[] = [];

  constructor(walls: readonly QuayWall[], riverWalls: readonly QuayWall[], ground: (e: number, n: number) => number) {
    this.fixed.name = 'boatfloat';
    this.floating.name = 'boatfloat-boats';
    const kit = new LKit();
    let k = 0;
    for (const w of walls) {
      const pts = w.line;
      let run = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [e0, n0] = pts[i]!;
        const [e1, n1] = pts[i + 1]!;
        const len = Math.hypot(e1 - e0, n1 - n0);
        if (len < 0.2) continue;
        const ue = (e1 - e0) / len;
        const un = (n1 - n0) / len;
        // The water is on the right of the wall's line, the land on its left.
        const re = un;
        const rn = -ue;
        const brg = (Math.atan2(ue, un) * 180) / Math.PI;
        // Black railing along the top, set back 0.3 m: posts every 2 m, a top rail and a middle rail.
        const se = (e0 + e1) / 2 - re * 0.3;
        const sn = (n0 + n1) / 2 - rn * 0.3;
        kit.box(se, w.top + 1.0, sn, 0.06, 0.06, len, brg, 0x15171a);
        kit.box(se, w.top + 0.5, sn, 0.04, 0.04, len, brg, 0x15171a);
        for (let d = 0; d < len; d += 2) kit.box(e0 + ue * d - re * 0.3, w.top, n0 + un * d - rn * 0.3, 0.07, 1.04, 0.07, 0, 0x15171a);
        // A steel ladder down the wall every 25 m or so.
        run += len;
        if (run > 25) {
          run = 0;
          const le = (e0 + e1) / 2 + re * 0.12;
          const ln = (n0 + n1) / 2 + rn * 0.12;
          const bottom = Math.min(w.top - 1, ground(le + re * 2, ln + rn * 2));
          for (const s of [-0.22, 0.22]) kit.box(le + ue * s, bottom, ln + un * s, 0.05, w.top + 0.8 - bottom, 0.05, brg, 0x202326);
          for (let y = bottom + 0.2; y < w.top; y += 0.3) kit.box(le, y, ln, 0.04, 0.04, 0.44, brg, 0x202326);
        }
        // Boats lying stern-to the wall, bows out, every 2.6 m or so where the basin's floor is low enough.
        for (let d = 1.3; d < len; d += 2.6) {
          const spec = SMALL_BOATS[k % SMALL_BOATS.length]!;
          const be = e0 + ue * d + re * (spec.length / 2 + 0.9);
          const bn = n0 + un * d + rn * (spec.length / 2 + 0.9);
          const bed = ground(be, bn);
          if (!inBox(be, bn) || bed > 1.6) continue;
          if (this.slots.some((s) => Math.hypot(s.e - be, s.n - bn) < 2.2)) continue;
          const obj = smallBoat(k);
          // Bow out from the wall: the models' bows point along -z (north at heading 0).
          const heading = Math.atan2(re, rn) + (((k * 37) % 11) - 5) * 0.02;
          obj.position.set(be, 0, -bn);
          obj.rotation.y = -heading;
          this.floating.add(obj);
          this.slots.push({ e: be, n: bn, heading, bed, obj });
          k++;
        }
      }
    }
    this.fixed.add(kit.mesh('boatfloat-rails'));
    // The arch: on the river wall and on the basin's, a dark opening under a ring of lighter stone.
    for (const [which, at] of [['river', BOATFLOAT_ARCH.river], ['basin', BOATFLOAT_ARCH.basin]] as const) {
      const face = nearestFace(which === 'river' ? riverWalls : walls, at);
      if (face) this.fixed.add(archMesh(face, BOATFLOAT_ARCH.width));
    }
  }

  /** The tide (m ODN): the boats float on it, or lie on the mud when it has gone. */
  update(waterLevel: number): void {
    for (const s of this.slots) s.obj.position.y = Math.max(0, s.bed + 0.25 - waterLevel);
  }

  get boats(): number {
    return this.slots.length;
  }
}

/** The wall segment nearest a point: where it meets the wall, the wall's direction, its outward (water) normal, its top. */
function nearestFace(walls: readonly QuayWall[], at: [number, number]): { e: number; n: number; ue: number; un: number; top: number } | undefined {
  let best: { e: number; n: number; ue: number; un: number; top: number } | undefined;
  let bestD = 12;
  for (const w of walls) {
    for (let i = 0; i + 1 < w.line.length; i++) {
      const [e0, n0] = w.line[i]!;
      const [e1, n1] = w.line[i + 1]!;
      const len = Math.hypot(e1 - e0, n1 - n0);
      if (len < 0.5) continue;
      const ue = (e1 - e0) / len;
      const un = (n1 - n0) / len;
      const t = Math.max(0, Math.min(len, (at[0] - e0) * ue + (at[1] - n0) * un));
      const pe = e0 + ue * t;
      const pn = n0 + un * t;
      const d = Math.hypot(at[0] - pe, at[1] - pn);
      if (d < bestD) {
        bestD = d;
        best = { e: pe, n: pn, ue, un, top: w.top };
      }
    }
  }
  return best;
}

/** A round-headed opening in a wall face (dark), with a ring of voussoirs round it, just proud of the face. */
function archMesh(f: { e: number; n: number; ue: number; un: number; top: number }, width: number): THREE.Object3D {
  const r = width / 2;
  const crown = f.top - 0.5;
  const spring = crown - r;
  const foot = -2.5;
  const opening = new THREE.Shape();
  opening.moveTo(-r, foot);
  opening.lineTo(-r, spring);
  opening.absarc(0, spring, r, Math.PI, 0, true);
  opening.lineTo(r, foot);
  opening.lineTo(-r, foot);
  const ring = new THREE.Shape();
  const R = r + 0.45;
  ring.moveTo(-R, spring);
  ring.absarc(0, spring, R, Math.PI, 0, true);
  ring.lineTo(r, spring);
  ring.absarc(0, spring, r, 0, Math.PI, false);
  ring.lineTo(-R, spring);
  const g = new THREE.Group();
  g.name = 'boatfloat-arch';
  // Local +z faces out over the water (the right of the wall's direction), local +x along the wall.
  const re = f.un;
  const rn = -f.ue;
  const rotY = Math.atan2(re, -rn);
  const dark = new THREE.Mesh(new THREE.ShapeGeometry(opening, 16), new THREE.MeshStandardMaterial({ color: 0x0b0d0e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const stone = new THREE.Mesh(new THREE.ShapeGeometry(ring, 16), new THREE.MeshStandardMaterial({ color: 0xa69c8a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  for (const m of [dark, stone]) {
    m.position.set(f.e + re * 0.06, 0, -(f.n + rn * 0.06));
    m.rotation.y = rotY;
    g.add(m);
  }
  return g;
}
