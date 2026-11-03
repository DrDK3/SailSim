import * as THREE from 'three';
import { shared } from './dispose';
import { Kit, VMAT, cabin, hull, place } from './vessels';
import { COMMITTEE_BOAT } from '../sim/race/anchored';

/**
 * The race committee boat: SAMARITAN, a Southerly 110 deck-saloon sloop (Rob Humphreys design, built by
 * Northshore), drawn from the owner's photograph of her at her berth (P4) and published descriptions of the
 * class (R11, R12):
 *  - principal dimensions: 10.82 m overall, 3.57 m beam, air draft about 14 m (broker listings);
 *  - a deep, high-sided hull; four fixed hull portlights; a raised deck saloon with long tinted windows, a
 *    wraparound front and the mast stepped at its front; deck hatches and dorades; wheel steering, twin angled
 *    rudders; a walk-through transom gate, bathing platform and boarding ladder (reviews and listings);
 *  - from the photograph: the layout along her length (the cockpit under its enclosure aft, the saloon about
 *    3.25 m long ending at the mast, a long foredeck), the hatches' burgundy covers and where they are, the
 *    navy sprayhood and full cockpit enclosure with clear windows, the navy stack pack along the boom, the
 *    white furled genoa, the radome a third of the way up the mast and the solar panel aft on the coachroof.
 * Her side profile, sheer, colours below the deck edge, window shapes and where her name is painted are not
 * in the photograph (taken from above): they are estimates (E). Visual only: the race physics still treat the
 * committee boat as a 2.5 m circle at the line's end (OUTSTANDING_ISSUES 111).
 */

/** Her name and size: the simulation's committee boat (src/sim/race/anchored.ts), so the drawing and the contact hull agree. */
export const SAMARITAN = COMMITTEE_BOAT;

const NAVY = 0x1d2a47;
const WHITE = 0xf2efe4; // her gelcoat reads warm, cream-white in the photograph
const ALLOY = 0xd3d6d9;
const HATCH = 0x6c2430; // the hatch covers' burgundy (photograph)
/** Her tinted glass (saloon, portlights, the enclosure's clear panels): dark from outside, as in the photograph. */
const TINT = shared(new THREE.MeshStandardMaterial({ color: 0x0e151d, roughness: 0.22, metalness: 0.15, envMapIntensity: 0.45 }));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The boat's name for her topsides: navy capitals on a clear background (null without a DOM, e.g. tests). */
function nameTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, c.width, c.height);
  g.font = "700 104px 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1d2a47';
  g.letterSpacing = '12px';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * A section of the cockpit enclosure: straight sides, a rounded top, open at the bottom (x right, y up). Points:
 * 0 bottom left, 1 mid left, 2–7 the left arc, 8–13 the right arc, 14 mid right, 15 bottom right.
 */
function enclosureSection(w: number, top: number, base: number, r: number, n = 5, tumble = 0): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const hw = w / 2;
  // The sides lean in by `tumble` towards the top (as the canvas falls from its frame).
  const tw = hw - tumble;
  const mid = base + 0.4 * (top - r - base);
  pts.push(new THREE.Vector2(-hw, base), new THREE.Vector2(-hw + tumble * 0.4, mid));
  for (let k = 0; k <= n; k++) {
    const a = Math.PI - (k / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(-tw + r + r * Math.cos(a), top - r + r * Math.sin(a)));
  }
  for (let k = 0; k <= n; k++) {
    const a = Math.PI / 2 - (k / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(tw - r + r * Math.cos(a), top - r + r * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(hw - tumble * 0.4, mid), new THREE.Vector2(hw, base));
  return pts;
}

/**
 * Loft a surface through sections at increasing z (same number of points each). `pick(i, j)`, for the quad from
 * section i to i + 1 between points j and j + 1, says whether it belongs to this surface (windows are lofted
 * separately, a little proud of the canvas).
 */
function loft(sections: { z: number; pts: THREE.Vector2[] }[], pick: (i: number, j: number) => boolean, proud = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const at = (i: number, j: number) => {
    const s = sections[i]!;
    const p = s.pts[j]!;
    // Push windows out along the section's own outward direction (from its centre line).
    const cy = s.pts.reduce((a, q) => a + q.y, 0) / s.pts.length;
    const d = new THREE.Vector2(p.x, p.y - cy).normalize().multiplyScalar(proud);
    return [p.x + d.x, p.y + d.y, s.z];
  };
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < sections[i]!.pts.length - 1; j++) {
      if (!pick(i, j)) continue;
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j + 1);
      const d = at(i + 1, j);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * SAMARITAN, bow towards −z (the model frame of src/render/vessels.ts), centred on the origin at the waterline.
 * Named meshes: `samaritan-body`, `samaritan-glass`, `samaritan-fittings`, `samaritan-name-port`,
 * `samaritan-name-starboard`.
 */
export function samaritanModel(): THREE.Group {
  const kit = new Kit();
  const L = SAMARITAN.loa;
  const beam = SAMARITAN.beam;
  const h = hull(kit, {
    length: L, beam, freeboard: 1.3, draft: 0.55, sheerBow: 0.3, sheerStern: 0.08, stemRake: 0.45, entry: 0.56, transom: 0.86, transomRake: 0.25,
    deadrise: 0.25, flare: 0.06, sternRise: 0.25, colours: { bottom: 0x1f2a36, boot: NAVY, topsides: WHITE, deck: 0xe4dccb }, bootTop: 0.1,
    stations: 34, sections: 12,
  });
  const bow = -L / 2;
  const stern = L / 2;

  // Deck edge: a dark rubbing strake just below the sheer and an aluminium toe rail on it.
  for (const s of [-1, 1]) {
    const line = h.sheerLine(s, 0, 0.02, 0.985);
    kit.tube(line.map((p) => p.clone().setY(p.y - 0.06).setX(p.x + s * 0.025)), 0.03, VMAT.paint, 0x4a4f56);
    kit.tube(line.map((p) => p.clone().setY(p.y + 0.03).setX(p.x - s * 0.04)), 0.018, VMAT.paint, ALLOY);
  }
  // Four fixed hull portlights, two a side, long and low, under the saloon (listings; their shape is E).
  for (const s of [-1, 1]) {
    for (const [z, len] of [[-1.45, 0.62], [0.65, 0.5]] as const) {
      kit.add(new THREE.BoxGeometry(0.02, 0.14, len), VMAT.glass, undefined, place(s * (h.half(z) + 0.015), h.sheer(z) - 0.4, z));
    }
  }

  // The deck saloon (photograph): from the mast, stepped just inside its raked front, back to the cockpit about
  // 3 m from the stern; a band of tinted windows wraps round the front either side of the mast and runs along
  // each side as two long windows (split by a mullion), the aft one under the sprayhood. Its sides lean in.
  const mastZ = -0.75;
  const front = mastZ - 0.2;
  const aft = 3.0;
  const sl = aft - front;
  const sz = (front + aft) / 2;
  const sy = h.deck(sz) - 0.03;
  const sh = 0.62;
  const sw = beam - 1.15;
  cabin(kit, { z: sz, y: sy, length: sl, width: sw, height: sh, rFront: 1.05, rBack: 0.2, rake: 0.75, tumble: 0.34, colour: WHITE, windows: [0.3, 0.84], front: [0.2, 0.88], noBackWindows: true, corner: 5 });
  const roof = sy + sh;
  // White frames between the windows, on the leaning sides (two windows a side) and at the front below the mast.
  const wallX = sw / 2 - 0.34 * 0.57;
  for (const z of [0.55, 1.98]) for (const s of [-1, 1]) kit.box(0.09, sh * 0.6, 0.12, VMAT.paint, WHITE, s * wallX, sy + sh * 0.57, z, 0);
  kit.box(0.22, sh * 0.72, 0.14, VMAT.paint, WHITE, 0, sy + sh * 0.55, front + 0.2 + 0.75 * 0.55);
  // Hatches with their burgundy covers, as in the photograph: a small one on the saloon roof, two on the foredeck.
  const hatch = (x: number, z: number, w: number, l: number, y: number) => {
    kit.box(w + 0.08, 0.05, l + 0.08, VMAT.paint, 0xd9d9d4, x, y + 0.025, z);
    kit.box(w, 0.07, l, VMAT.canvas, HATCH, x, y + 0.06, z);
  };
  hatch(-0.5, 0.9, 0.36, 0.36, roof);
  hatch(-0.34, -1.75, 0.3, 0.26, h.deck(-1.75));
  hatch(0, -2.75, 0.62, 0.62, h.deck(-2.75));
  // On the saloon roof just ahead of the sprayhood: the solar panel (starboard) and a mushroom vent (port).
  kit.box(0.6, 0.035, 0.5, VMAT.paint, 0x141b26, 0.48, roof + 0.03, 0.85);
  kit.add(new THREE.CylinderGeometry(0.11, 0.07, 0.1, 10), VMAT.paint, 0xf2f2ee, place(-0.82, roof + 0.05, 1.1));

  // The navy sprayhood and cockpit enclosure (photograph): the sprayhood sits on the saloon's aft part, its front
  // raked with two large clear windows and a clear window each side; aft of the saloon the enclosure steps out
  // over the cockpit coamings and runs to the stern, a clear window high on each side; a rounded top.
  const deckAft = h.deck(stern - 1.5);
  const top = roof + 0.68;
  const spec = [
    { z: 1.15, base: roof - 0.02, top: roof + 0.14, w: sw - 0.6, r: 0.3, tumble: 0.05 },
    { z: 1.6, base: roof - 0.02, top: top - 0.06, w: sw - 0.32, r: 0.5, tumble: 0.12 },
    { z: aft - 0.05, base: roof - 0.02, top, w: sw - 0.22, r: 0.6, tumble: 0.14 },
    { z: aft + 0.05, base: deckAft - 0.05, top, w: Math.min(2.95, 2 * h.half(aft + 0.05) - 0.3), r: 0.62, tumble: 0.18 },
    { z: stern - 1.0, base: deckAft - 0.05, top: top - 0.05, w: Math.min(2.9, 2 * h.half(stern - 1.0) - 0.3), r: 0.66, tumble: 0.2 },
    // Falling away at the back, as the canvas does over the pushpit.
    { z: stern - 0.45, base: deckAft - 0.05, top: top - 0.4, w: Math.min(2.7, 2 * h.half(stern - 0.45) - 0.35), r: 0.7, tumble: 0.25 },
  ];
  const sections = spec.map((q) => ({ z: q.z, pts: enclosureSection(q.w, q.top, q.base, q.r, 5, q.tumble) }));
  const tops = spec.map((q) => q.top);
  const npts = sections[0]!.pts.length; // 16
  const isFrontWindow = (i: number, j: number) => i === 0 && j >= 2 && j <= 13 && j !== 7;
  const isSideWindow = (i: number, j: number) => (i === 1 || i === 3) && (j === 1 || j === npts - 3);
  kit.add(loft(sections, (i, j) => !isFrontWindow(i, j) && !isSideWindow(i, j)), VMAT.canvas, NAVY);
  kit.add(loft(sections, (i, j) => isFrontWindow(i, j) || isSideWindow(i, j), 0.012), VMAT.glass);
  // Its ends closed: the front panel down to the saloon roof, the back panel over the stern.
  for (const k of [0, sections.length - 1]) {
    const s = sections[k]!;
    const shape = new THREE.Shape(s.pts.map((p) => new THREE.Vector2(p.x, p.y)));
    const cap = new THREE.ShapeGeometry(shape);
    cap.translate(0, 0, s.z);
    kit.add(cap, VMAT.canvas, NAVY);
  }

  // Mast at the saloon's front; two pairs of swept spreaders; the radome a third of the way up; boom with the
  // navy stack pack over the enclosure; the furled genoa (white) on the forestay.
  const mastTop = 14.0;
  kit.add(new THREE.CylinderGeometry(0.075, 0.105, mastTop - roof, 8), VMAT.paint, ALLOY, place(0, (mastTop + roof) / 2, mastZ));
  for (const [y, half] of [[5.7, 1.15], [9.8, 0.85]] as const) {
    for (const s of [-1, 1]) kit.rod(V(0, y, mastZ), V(s * half, y, mastZ + 0.28), 0.03, VMAT.paint, ALLOY, 6);
  }
  kit.add(new THREE.CylinderGeometry(0.31, 0.31, 0.27, 18), VMAT.paint, 0xf4f4f2, place(0, 4.7, mastZ - 0.34));
  kit.box(0.1, 0.06, 0.32, VMAT.paint, ALLOY, 0, 4.55, mastZ - 0.18);
  const boomY = Math.max(...tops) + 0.14;
  const boomEnd = stern - 1.25;
  const blen = boomEnd - mastZ;
  kit.add(new THREE.CylinderGeometry(0.075, 0.075, blen, 8), VMAT.paint, ALLOY, place(0, boomY, mastZ + blen / 2, 0, Math.PI / 2));
  kit.add(new THREE.CapsuleGeometry(0.22, blen - 0.6, 3, 10).scale(0.8, 1, 1.15), VMAT.canvas, NAVY, place(0, boomY + 0.26, mastZ + blen / 2 + 0.1, 0, Math.PI / 2));
  const stem = V(0, h.sheer(bow + 0.25) + 0.12, bow + 0.15);
  const hounds = V(0, mastTop - 0.25, mastZ);
  const fl = stem.distanceTo(hounds);
  kit.add(new THREE.CylinderGeometry(0.035, 0.085, fl * 0.92, 10), VMAT.canvas, 0xefece4, new THREE.Matrix4().compose(stem.clone().lerp(hounds, 0.47), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), hounds.clone().sub(stem).normalize()), V(1, 1, 1)));
  // Standing rigging: split backstay to the stern quarters, cap shrouds and lowers.
  for (const s of [-1, 1]) kit.rod(V(s * 0.9, h.sheer(stern - 0.2) + 0.1, stern - 0.2), V(0, mastTop - 2.4, mastZ + 0.1), 0.008, VMAT.paint, 0x9aa0a6, 4);
  kit.rod(V(0, mastTop - 2.4, mastZ + 0.1), V(0, mastTop, mastZ + 0.05), 0.009, VMAT.paint, 0x9aa0a6, 4);
  for (const s of [-1, 1]) {
    const chain = V(s * (h.half(mastZ + 0.35) - 0.12), h.sheer(mastZ + 0.35), mastZ + 0.35);
    kit.rod(chain, V(0, mastTop - 0.3, mastZ), 0.009, VMAT.paint, 0x9aa0a6, 4);
    kit.rod(chain, V(s * 0.08, 5.7, mastZ), 0.009, VMAT.paint, 0x9aa0a6, 4);
  }

  // Stanchions and two guard wires a side; pulpit; pushpit in two halves with the walk-through gap.
  for (const s of [-1, 1]) {
    const line = h.sheerLine(s, 0.1, 0.1, 0.9);
    const n = 6;
    const pts = Array.from({ length: n }, (_, k) => line[Math.round((k / (n - 1)) * (line.length - 1))]!);
    for (const p of pts) kit.rod(p, p.clone().setY(p.y + 0.62), 0.014, VMAT.steel, undefined, 4);
    for (const dy of [0.62, 0.32]) for (let k = 1; k < n; k++) kit.rod(pts[k - 1]!.clone().setY(pts[k - 1]!.y + dy), pts[k]!.clone().setY(pts[k]!.y + dy), 0.006, VMAT.steel, undefined, 3);
  }
  const ry = (z: number) => h.sheer(z) + 0.66;
  const pulpit = [V(-0.62, ry(bow + 1.3), bow + 1.3), V(-0.42, ry(bow + 0.55), bow + 0.6), V(0, ry(bow + 0.3), bow + 0.32), V(0.42, ry(bow + 0.55), bow + 0.6), V(0.62, ry(bow + 1.3), bow + 1.3)];
  kit.tube(pulpit, 0.016, VMAT.steel);
  for (const p of pulpit) kit.rod(p, p.clone().setY(p.y - 0.64), 0.014, VMAT.steel, undefined, 4);
  for (const s of [-1, 1]) {
    const x0 = s * (h.half(stern - 1.2) - 0.1);
    const pushpit = [V(x0, ry(stern - 1.2), stern - 1.2), V(s * (h.half(stern - 0.15) - 0.12), ry(stern - 0.15), stern - 0.2), V(s * 0.45, ry(stern - 0.1), stern - 0.12)];
    kit.tube(pushpit, 0.016, VMAT.steel);
    for (const p of pushpit) kit.rod(p, p.clone().setY(p.y - 0.64), 0.014, VMAT.steel, undefined, 4);
  }
  // Bathing platform at the foot of the transom, with the boarding ladder folded on it.
  kit.box(2.3, 0.1, 0.42, VMAT.paint, WHITE, 0, 0.36, stern + 0.12);
  kit.box(0.4, 0.04, 0.32, VMAT.steel, undefined, 0, 0.43, stern + 0.15);
  // Twin rudders under the stern, angled out (as the class's), mostly under the water.
  for (const s of [-1, 1]) kit.add(new THREE.BoxGeometry(0.06, 1.05, 0.42), VMAT.paint, 0x1f2a36, place(s * 0.62, -0.45, stern - 1.05, 0, 0, s * 0.18));
  // Bow roller with the anchor.
  kit.box(0.16, 0.12, 0.55, VMAT.steel, undefined, 0, h.sheer(bow) + 0.02, bow + 0.02);
  kit.box(0.34, 0.06, 0.2, VMAT.steel, undefined, 0, h.sheer(bow) - 0.05, bow - 0.18);
  // The committee boat's flag (orange, by the sailing instructions' usual convention) on a staff at the stern.
  kit.rod(V(0.75, ry(stern - 0.3) - 0.6, stern - 0.3), V(0.75, ry(stern - 0.3) + 1.8, stern - 0.3), 0.02, VMAT.paint, 0xcfcfca, 6);
  kit.add(new THREE.PlaneGeometry(1.0, 0.65), VMAT.canvas, 0xff7a1a, place(0.75, ry(stern - 0.3) + 1.45, stern + 0.2, Math.PI / 2));

  const g = kit.build('samaritan');
  for (const c of g.children) {
    if (c.name === 'samaritan-glass') (c as THREE.Mesh).material = TINT;
    (c as THREE.Mesh).castShadow = true;
    (c as THREE.Mesh).receiveShadow = true;
  }
  // Her name on both bows, on the white topsides below the rubbing strake (where is not in the photograph: E).
  const map = nameTexture(SAMARITAN.name);
  if (map) {
    const mat = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) {
      // Forward of the portlights (the forward one starts about 3.3 m from the bow).
      const z = bow + 2.3;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.27), mat);
      plane.position.set(s * (h.half(z) + 0.05), h.sheer(z) - 0.34, z);
      // Facing outboard along the hull's line in plan (it widens aft), reading left to right from alongside.
      const slope = Math.atan(h.half(z + 0.5) - h.half(z - 0.5));
      plane.rotation.y = s > 0 ? Math.PI / 2 + slope : -Math.PI / 2 - slope;
      plane.name = s > 0 ? 'samaritan-name-starboard' : 'samaritan-name-port';
      g.add(plane);
    }
  }
  return g;
}
