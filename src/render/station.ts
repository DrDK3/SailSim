import * as THREE from 'three';
import { Kit, longAxisDeg, prism } from './landmarks';

/**
 * The former Dartmouth station on the South Embankment by the Boatfloat: the Great Western Railway's booking office
 * for the trains across the river at Kingswear (it never had a railway), Grade II, now a restaurant (Historic
 * England, Wikipedia, CAMRA, via search: docs/SOURCES.md V14). Drawn as the owner's photographs of 12 Nov 2026 show
 * it: one storey of pale yellow boarding on a maroon plinth, maroon pilasters and frieze, big windows with white
 * glazing bars, a hipped slate roof with a raised lantern along its ridge and iron cresting, a glazed canopy on
 * brackets along its landward side, and a gabled canopy on two posts over the pavement at its south end. The
 * footprint and its orientation are the data's; heights and details are estimates (E). Visual only.
 */

/** A point inside its footprint (local e, n): the same as its landmark look ('dartmouth-station'). */
export const STATION_AT: [number, number] = [-276, 371];

const YELLOW = 0xe8cf7a;
const PALE = 0xf1dc8c;
const MAROON = 0x76302a;
const SLATE = 0x4a4f55;
const GLASS = 0x26313b;
const WHITE = 0xefece2;
const GREEN = 0x2f5b40;
const IRON = 0x1b1c1e;

/** A hipped roof over a rectangle centred at the origin (x across, z along), eaves at y = 0, ridge at `rise`. */
export function hipRoofGeometry(length: number, width: number, rise: number): THREE.BufferGeometry {
  const hl = length / 2;
  const hw = width / 2;
  const rl = Math.max(0.01, hl - hw);
  const A = [-hw, 0, -hl];
  const B = [hw, 0, -hl];
  const C = [hw, 0, hl];
  const D = [-hw, 0, hl];
  const R1 = [0, rise, -rl];
  const R2 = [0, rise, rl];
  // Wound to face outward and up.
  const tris = [A, R1, B, C, R2, D, B, R1, R2, B, R2, C, D, R2, R1, D, R1, A];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  return g;
}

/**
 * The station on its footprint (`ring`, local e, n), standing on the ground there (`ground`, m ODN). Built in the
 * footprint's own frame: x across it (+x to the river, east), z along it (+z to its south end).
 */
export function buildStation(ring: readonly [number, number][], ground: number): THREE.Object3D {
  const kit = new Kit();
  const ce = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cn = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const brg = longAxisDeg(ring);
  const t = (brg * Math.PI) / 180;
  // Extents along the long axis (bearing brg) and across it.
  const along = ring.map(([e, n]) => (e - ce) * Math.sin(t) + (n - cn) * Math.cos(t));
  const across = ring.map(([e, n]) => (e - ce) * Math.cos(t) - (n - cn) * Math.sin(t));
  const L = Math.max(...along) - Math.min(...along);
  const W = Math.max(...across) - Math.min(...across);
  // Local frame: +z points against the bearing (the bearing is northward, so +z is the south end), +x to the east.
  const frame = new THREE.Matrix4().compose(new THREE.Vector3(ce, ground, -cn), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t), new THREE.Vector3(1, 1, 1));
  const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, rot?: THREE.Euler) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    kit.add(geo, frame.clone().multiply(m), hex);
  };
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: number, rot?: THREE.Euler) => at(new THREE.BoxGeometry(w, h, l), x, y + h / 2, z, hex, rot);

  const plinth = 0.45;
  const wallH = 3.2;
  const top = plinth + wallH;
  box(W + 0.12, plinth, L + 0.12, 0, 0, 0, MAROON);
  box(W, wallH, L, 0, plinth, 0, YELLOW);
  // Frieze and cornice under the eaves.
  box(W + 0.1, 0.28, L + 0.1, 0, top - 0.28, 0, MAROON);
  box(W + 0.3, 0.12, L + 0.3, 0, top, 0, WHITE);
  // Pilasters along both sides and at the corners; between them, windows (and a door in the middle of each side).
  const bays = Math.max(3, Math.round(L / 2.4));
  const pitch = L / bays;
  for (const s of [-1, 1]) {
    for (let k = 0; k <= bays; k++) box(0.24, wallH, 0.24, s * (W / 2 + 0.06), plinth, -L / 2 + k * pitch, MAROON);
    for (let k = 0; k < bays; k++) {
      const z = -L / 2 + (k + 0.5) * pitch;
      const door = k === Math.floor(bays / 2);
      const ww = pitch - 0.7;
      const x = s * (W / 2 + 0.04);
      if (door) {
        box(0.08, 2.4, ww * 0.8, x, plinth, z, GREEN);
        box(0.1, 0.5, ww * 0.8, x, plinth + 2.45, z, GLASS);
        continue;
      }
      box(0.08, 1.9, ww, x, plinth + 0.7, z, WHITE);
      box(0.1, 1.7, ww - 0.2, x + s * 0.01, plinth + 0.8, z, GLASS);
      // Glazing bars: a transom and two mullions.
      box(0.12, 0.06, ww - 0.2, x + s * 0.02, plinth + 2.05, z, WHITE);
      for (const f of [-1, 1]) box(0.12, 1.7, 0.06, x + s * 0.02, plinth + 0.8, z + f * (ww - 0.2) / 6, WHITE);
    }
  }
  // Ends: a window in each, between corner pilasters.
  for (const e of [-1, 1]) {
    box(W * 0.5, 1.7, 0.1, 0, plinth + 0.8, e * (L / 2 + 0.04), GLASS);
    box(W * 0.5 + 0.2, 0.06, 0.12, 0, plinth + 2.05, e * (L / 2 + 0.05), WHITE);
  }
  // The roof: hipped, slate, over deep eaves; a lantern along the ridge with its own hipped roof; iron cresting.
  const rise = 2.0;
  at(hipRoofGeometry(L + 0.9, W + 0.9, rise), 0, top + 0.12, 0, SLATE);
  const lanL = Math.max(3, (L - W) * 0.85);
  box(1.7, 0.75, lanL, 0, top + 0.12 + rise - 0.35, 0, PALE);
  for (const s of [-1, 1]) for (let k = 0; k < Math.floor(lanL / 0.9); k++) box(0.06, 0.4, 0.55, s * 0.86, top + rise - 0.1, -lanL / 2 + 0.45 + k * 0.9, GLASS);
  at(hipRoofGeometry(lanL + 0.5, 2.2, 0.55), 0, top + 0.12 + rise + 0.4, 0, SLATE);
  const crestY = top + 0.12 + rise + 0.95;
  const crestL = Math.max(0.5, lanL + 0.5 - 2.2);
  box(0.05, 0.05, crestL, 0, crestY + 0.32, 0, IRON);
  for (let k = 0; k <= Math.floor(crestL / 0.3); k++) box(0.04, 0.34, 0.04, 0, crestY, -crestL / 2 + k * 0.3, IRON);
  // The canopy along the landward (west) side: glazed, pale yellow beneath, on maroon brackets.
  const cd = 2.4;
  const slope = 0.14;
  for (let k = 0; k < bays; k++) {
    const z = -L / 2 + (k + 0.5) * pitch;
    at(new THREE.BoxGeometry(cd, 0.08, pitch - 0.05), -(W / 2 + cd / 2), top - 0.15 - (cd / 2) * slope, z, k % 2 ? PALE : 0xe9d37f, new THREE.Euler(0, 0, slope));
  }
  box(0.08, 0.24, L - 0.2, -(W / 2 + cd), top - 0.5 - cd * slope, 0, MAROON);
  for (let k = 0; k <= bays; k++) {
    const z = -L / 2 + k * pitch;
    at(new THREE.BoxGeometry(0.1, 1.5, 0.1), -(W / 2 + 0.55), top - 0.85, z, MAROON, new THREE.Euler(0, 0, -0.75));
  }
  // The gabled canopy at the south end, over the pavement, on two posts; decorative bargeboards.
  const gw = 4.2;
  const gd = 3.0;
  const ge = top - 0.35;
  const gr = 1.5;
  const zEnd = L / 2;
  at(prism([[-gw / 2 - 0.2, 0, gd + 0.25], [gw / 2 + 0.2, 0, gd + 0.25], [0, gr, gd + 0.25]], [[-gw / 2 - 0.2, 0, -0.3], [gw / 2 + 0.2, 0, -0.3], [0, gr, -0.3]], 'roof'), 0, ge, zEnd, SLATE);
  at(prism([[-gw / 2 + 0.1, 0.02, gd + 0.27], [gw / 2 - 0.1, 0.02, gd + 0.27], [0, gr - 0.15, gd + 0.27]], [[-gw / 2 + 0.1, 0.02, gd + 0.2], [gw / 2 - 0.1, 0.02, gd + 0.2], [0, gr - 0.15, gd + 0.2]], 'wall'), 0, ge, zEnd, PALE);
  const bl = Math.hypot(gw / 2 + 0.2, gr);
  const ba = Math.atan2(gr, gw / 2 + 0.2);
  for (const s of [-1, 1]) {
    at(new THREE.BoxGeometry(bl, 0.32, 0.06), (s * (gw / 2 + 0.2)) / 2, ge + gr / 2 - 0.05, zEnd + gd + 0.32, MAROON, new THREE.Euler(0, 0, -s * ba));
    box(0.2, ge, 0.2, s * (gw / 2 - 0.1), 0, zEnd + gd - 0.1, MAROON);
    at(new THREE.BoxGeometry(0.1, 1.2, 0.1), s * (gw / 2 - 0.5), ge - 0.45, zEnd + gd - 0.1, MAROON, new THREE.Euler(0, 0, s * 0.8));
  }
  box(0.1, 0.9, 0.1, 0, ge + gr - 0.1, zEnd + gd + 0.32, MAROON);
  box(gw, 0.2, 0.16, 0, ge - 0.2, zEnd + gd - 0.1, MAROON);
  const mesh = kit.mesh('dartmouth-station');
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
