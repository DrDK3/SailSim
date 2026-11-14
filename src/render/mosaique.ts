import * as THREE from 'three';
import { Kit, VMAT, cabin, hull, lifebuoy, outboard, place, rail, type Hull, type HullSpec } from './vessels';
import { burgeeCanvas } from './burgee';
import { rdycEnsignTexture } from './clubEnsign';
import { bakedPerson } from './crew';
import { coloursFlying } from './colours';
import { flagDroop, flagYaw } from './vane';
import { buildLights, colregsLights, updateLights } from './navLights';
import { RDYC_ORIGIN } from '../sim/geo/projection';
import { MOSAIQUE, MOSAIQUE_TENDER, SHIP_BUOYS, SHIP_BUOY_SIZE, mooredBerth, type ShipBuoy } from '../sim/env/shipBuoys';

/**
 * The main-stream ship buoys MS1–MS5 and the superyacht Mosaique moored fore and aft on MS1 and MS2, flying a large
 * Royal Dart Yacht Club burgee at her masthead and the club's defaced red ensign from a staff off her stern (owner,
 * 14 Nov 2026, with photographs of her; the ensign from the owner's drawing). Where the buoys are, and which pair she
 * lies on, is src/sim/env/shipBuoys.ts (estimates).
 *
 * Drawn from the owner's photographs (a Proteksan Turquoise 50 m of 2002): a blue displacement hull with a raked stem,
 * a white capping rail and a stainless rubbing strake, a row of oblong hull windows and round ports forward, anchors
 * in pockets either side of the bow; a teak foredeck with the windlass, bitts and a sunpad; a white superstructure of
 * three decks, its windows divided by white mullions, side doors, the bridge behind raked glass under a visor with
 * its sidelights; the upper deck carried aft over the main aft deck on posts, with white bulwarks, a dining table and
 * lifebuoys; the sun deck with a bar under a hardtop, sunbeds and umbrellas; a white radar mast with two large
 * radomes side by side, an open-array radar, horns, a searchlight, satellite domes and whips, the signal mast above;
 * a blue transom with the tender garage, steps either side up from the swim platform and her name; her tender astern
 * on its painter, and a few of her crew about the decks. Heights, layout and colours are estimates (E). Everything
 * floats (the water at y = 0).
 */

const BLUE = 0x2c64b0;
const DEEP_BLUE = 0x1f4a86;
const WHITE = 0xf3f3ef;
const CREAM = 0xe9e4d6;
const TEAK = 0xb48a58;
const YELLOW = 0xf2c21b;
const ROPE = 0xe6e1d3;
const DARK = 0x16191d;

/** Her measurements as drawn (m, E from the photographs): main deck, deck heights, mast, flags. */
export const MOSAIQUE_DRAWN = {
  freeboard: 3.3,
  draft: 2.9,
  /** Main deck house, upper deck house and sun deckhouse heights (walls) and roof thicknesses. */
  mainHouse: 2.7,
  upperHouse: 2.5,
  roof: 0.22,
  /** Height of the masthead (the burgee's truck) above the water. */
  masthead: 18.8,
  ensign: { fly: 2.4, hoist: 1.2 },
  burgee: { fly: 2.4, hoist: 1.45 },
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A flag of `fly` × `hoist` (m) on a pivot (its hoist at the pivot, its fly along +x), waving in the wind. */
class WavingFlag {
  readonly pivot = new THREE.Group();
  private readonly geo: THREE.PlaneGeometry;
  private readonly rest: Float32Array;

  constructor(name: string, private readonly fly: number, hoist: number, map: THREE.Texture | null | undefined, fallback: number, alphaTest = 0) {
    this.pivot.name = name;
    this.geo = new THREE.PlaneGeometry(fly, hoist, 14, 4);
    this.geo.translate(fly / 2, -hoist / 2, 0);
    this.rest = Float32Array.from(this.geo.getAttribute('position').array as Float32Array);
    // Bunting is matt; a little under full albedo so the sunlit red stays red after tone mapping (as the burgee).
    const mat = new THREE.MeshStandardMaterial({ map: map ?? null, color: map ? 0xb4b4b4 : fallback, side: THREE.DoubleSide, roughness: 0.9, alphaTest });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.name = `${name}-cloth`;
    this.pivot.add(mesh);
  }

  /** Fly towards `yaw` (rad, about the pivot's y) in an apparent wind of `aws` m/s. */
  update(yaw: number, aws: number, time: number): void {
    this.pivot.rotation.y = yaw;
    const droop = flagDroop(aws);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const freq = 0.9 + 0.25 * aws;
    const amp = 0.18 * (0.4 + Math.min(1, aws / 8));
    for (let i = 0; i < pos.count; i++) {
      const x = this.rest[i * 3]!;
      const y = this.rest[i * 3 + 1]!;
      const f = x / this.fly;
      const wave = amp * f * Math.sin(f * 6 - time * freq * 2 * Math.PI) + 0.35 * amp * f * Math.sin(f * 11 - time * freq * 2.9 + y * 3);
      pos.setXYZ(i, x * Math.cos(droop), y - x * Math.sin(droop), wave);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

/** Her name for the transom: white italic serif (none outside a browser). */
function nameTexture(text: string): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#f6f4ec';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 600 78px Georgia, "Times New Roman", serif';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One ship buoy: a yellow drum with a rubber fender round its top and a mooring ring on it. */
function buoyModel(b: ShipBuoy): THREE.Group {
  const kit = new Kit();
  const r = SHIP_BUOY_SIZE.diameter / 2;
  const h = SHIP_BUOY_SIZE.freeboard + SHIP_BUOY_SIZE.draft;
  kit.add(new THREE.CylinderGeometry(r, r * 0.96, h, 28), VMAT.paint, YELLOW, place(0, SHIP_BUOY_SIZE.freeboard - h / 2, 0));
  // A slightly domed top plate, the fender round its edge and the ring.
  kit.add(new THREE.CylinderGeometry(r * 0.82, r, 0.18, 28), VMAT.paint, YELLOW, place(0, SHIP_BUOY_SIZE.freeboard + 0.09, 0));
  kit.add(new THREE.TorusGeometry(r, 0.13, 8, 32).rotateX(Math.PI / 2), VMAT.rubber, undefined, place(0, SHIP_BUOY_SIZE.freeboard - 0.05, 0));
  kit.add(new THREE.TorusGeometry(r, 0.11, 8, 32).rotateX(Math.PI / 2), VMAT.rubber, undefined, place(0, 0.25, 0));
  kit.add(new THREE.TorusGeometry(0.28, 0.06, 8, 16), VMAT.paint, 0x3a3d40, place(0, SHIP_BUOY_SIZE.freeboard + 0.42, 0));
  kit.box(0.5, 0.16, 0.16, VMAT.paint, 0x3a3d40, 0, SHIP_BUOY_SIZE.freeboard + 0.2, 0);
  const g = kit.build(`ship-buoy-${b.id}`);
  g.position.set(b.e, 0, -b.n);
  g.userData.buoy = b.id;
  return g;
}

/** A rope from `a` to `b`, hanging in a shallow curve but clear of the water. */
function hangingLine(kit: Kit, a: THREE.Vector3, b: THREE.Vector3, sag: number, r = 0.028): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = a.clone().lerp(b, t);
    p.y = Math.max(0.15, p.y - sag * 4 * t * (1 - t));
    pts.push(p);
  }
  kit.tube(pts, r, VMAT.paint, ROPE);
}

/** A pair of mooring bitts on a base plate at deck height `y`. */
function bitts(kit: Kit, x: number, y: number, z: number): void {
  kit.box(0.35, 0.05, 0.85, VMAT.steel, undefined, x, y + 0.025, z);
  for (const dz of [-0.25, 0.25]) {
    kit.add(new THREE.CylinderGeometry(0.1, 0.11, 0.36, 12), VMAT.steel, undefined, place(x, y + 0.2, z + dz));
    kit.add(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12), VMAT.steel, undefined, place(x, y + 0.39, z + dz));
  }
}

/** A sunbed: a white base, a cream mattress and a raised back (facing +z unless `flip`). */
function sunbed(kit: Kit, x: number, y: number, z: number, flip = false): void {
  const s = flip ? -1 : 1;
  kit.box(0.74, 0.28, 1.95, VMAT.gloss, WHITE, x, y + 0.14, z);
  kit.box(0.7, 0.12, 1.25, VMAT.paint, CREAM, x, y + 0.34, z + s * 0.32);
  kit.add(new THREE.BoxGeometry(0.7, 0.12, 0.72), VMAT.paint, CREAM, place(x, y + 0.52, z - s * 0.66, 0, s * 0.62));
}

/** A table with chairs round it (teak top, white base and chairs) at deck height `y`, `n` chairs a side. */
function diningTable(kit: Kit, x: number, y: number, z: number, length: number, n: number): void {
  kit.box(1.1, 0.05, length, VMAT.paint, TEAK, x, y + 0.75, z);
  kit.box(0.5, 0.72, length * 0.6, VMAT.gloss, WHITE, x, y + 0.36, z);
  for (const side of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const cz = z - length / 2 + (k + 0.5) * (length / n);
      kit.box(0.48, 0.45, 0.48, VMAT.gloss, WHITE, x + side * 0.95, y + 0.225, cz);
      kit.box(0.46, 0.08, 0.46, VMAT.paint, CREAM, x + side * 0.95, y + 0.49, cz);
      kit.box(0.08, 0.45, 0.46, VMAT.gloss, WHITE, x + side * 1.18, y + 0.7, cz);
    }
  }
}

/** A sofa `width` long facing -z (its back at +z), at deck height `y`. */
function sofa(kit: Kit, x: number, y: number, z: number, width: number): void {
  kit.box(width, 0.42, 0.85, VMAT.gloss, WHITE, x, y + 0.21, z);
  kit.box(width - 0.1, 0.14, 0.8, VMAT.paint, CREAM, x, y + 0.49, z - 0.02);
  kit.box(width, 0.5, 0.2, VMAT.gloss, WHITE, x, y + 0.67, z + 0.38);
  kit.box(width - 0.1, 0.42, 0.14, VMAT.paint, CREAM, x, y + 0.72, z + 0.24);
}

/** The tender: an open boat, white with a blue band, console, cushions and outboard; bow at -z, at the origin. */
function tenderModel(): THREE.Group {
  const kit = new Kit();
  const { length: L, beam: B } = MOSAIQUE_TENDER;
  const t = hull(
    kit,
    {
      length: L, beam: B, freeboard: 0.78, draft: 0.38, sheerBow: 0.22, stemRake: 0.7, entry: 0.45, transom: 0.92, deadrise: 0.36, chine: true,
      colours: { bottom: 0xf0efe9, boot: 0x1d1f22, topsides: WHITE, stripe: BLUE, deck: 0xd9d6cc }, stripe: [0.14, 0.3], stations: 16, sections: 8,
    },
    VMAT.gloss,
  );
  kit.box(1.0, 0.85, 0.75, VMAT.gloss, WHITE, 0, t.deck(0) + 0.42, -0.2);
  kit.add(new THREE.BoxGeometry(0.95, 0.35, 0.04), VMAT.glass, undefined, place(0, t.deck(0) + 1.02, -0.62, 0, 0.5));
  kit.box(1.5, 0.38, 0.6, VMAT.gloss, WHITE, 0, t.deck(1.3) + 0.19, 1.3);
  kit.box(1.45, 0.12, 0.58, VMAT.paint, CREAM, 0, t.deck(1.3) + 0.44, 1.3);
  kit.box(1.7, 0.32, 1.3, VMAT.paint, CREAM, 0, t.deck(-2.1) + 0.16, -2.1);
  // A grey rubbing band round her gunwale.
  for (const side of [-1, 1]) kit.tube(t.sheerLine(side, -0.04, 0.03, 0.99), 0.07, VMAT.paint, 0x8e959c);
  outboard(kit, 0, t.deck(L / 2), L / 2 - 0.1, 0xf2f2ee);
  return kit.build('mosaique-tender');
}

interface YachtParts {
  group: THREE.Group;
  ensignAt: THREE.Vector3;
  burgeeAt: THREE.Vector3;
  bow: THREE.Vector3;
  stern: THREE.Vector3;
  /** Fairleads at the transom's corners (the stern lines), and the cleats the tender's lines lead to. */
  sternFairleads: THREE.Vector3[];
  tenderCleats: THREE.Vector3[];
  mastZ: number;
}

/** Where the hull's shell is, to starboard (m), at height y and station z: found by casting a ray at a copy of it. */
function hullSurface(spec: HullSpec): (y: number, z: number) => number {
  const probe = new Kit();
  hull(probe, spec, VMAT.gloss);
  const g = probe.build('probe');
  g.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const cache = new Map<string, number>();
  return (y, z) => {
    const key = `${y.toFixed(2)}:${z.toFixed(2)}`;
    let x = cache.get(key);
    if (x === undefined) {
      ray.set(new THREE.Vector3(30, y, z), new THREE.Vector3(-1, 0, 0));
      x = ray.intersectObject(g, true)[0]?.point.x ?? 0;
      cache.set(key, x);
    }
    return x;
  };
}

/** Hull fittings: capping rail, foredeck rail, strake, hull windows, ports and anchors. */
function hullFittings(kit: Kit, h: Hull, L: number, surf: (y: number, z: number) => number): void {
  const sternZ = L / 2;
  for (const side of [-1, 1]) {
    kit.tube(h.sheerLine(side, 0.12, 0.04, 0.985), 0.1, VMAT.gloss, WHITE);
    // The foredeck's stainless rail above the bulwark, on stanchions.
    const fore = h.sheerLine(side, 0.14, 0.03, 0.3).map((p) => p.clone().add(v(0, 0.45, 0)));
    kit.tube(fore, 0.028, VMAT.steel);
    for (let i = 0; i < fore.length; i += 3) kit.rod(fore[i]!.clone().add(v(0, -0.45, 0)), fore[i]!, 0.02, VMAT.steel, undefined, 6);
    // The rubbing strake at the main deck's level.
    const strake: THREE.Vector3[] = [];
    for (let z = -21; z <= sternZ - 0.3; z += 1.5) strake.push(v(side * (surf(h.deck(z) - 0.15, z) + 0.01), h.deck(z) - 0.15, z));
    kit.tube(strake, 0.05, VMAT.steel);
    // Hull windows: oblong lights along the lower deck in stainless frames, and round ports forward.
    for (let k = 0; k < 6; k++) {
      const z = -12.5 + k * 3.7;
      const x = side * surf(1.45, z);
      kit.box(0.08, 0.62, 2.04, VMAT.steel, undefined, x, 1.45, z);
      kit.box(0.08, 0.5, 1.9, VMAT.glass, undefined, x + side * 0.02, 1.45, z);
    }
    for (const z of [-18.6, -16.7, -14.8]) {
      const x = side * surf(2.05, z);
      kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16).rotateZ(Math.PI / 2), VMAT.glass, undefined, place(x, 2.05, z));
      kit.add(new THREE.TorusGeometry(0.2, 0.035, 6, 18).rotateY(Math.PI / 2), VMAT.steel, undefined, place(x + side * 0.04, 2.05, z));
    }
    // The anchor in its pocket, following the shell's line at the bow: a dark recess on the shell, the anchor's
    // shank and crown lying in it, the hawse at its head.
    const az = -20.6;
    const ay = h.sheer(az) - 2.2;
    const x0 = surf(ay, az);
    const yaw = side * Math.atan((surf(ay, az + 0.5) - surf(ay, az - 0.5)) / 1);
    kit.add(new THREE.BoxGeometry(0.06, 1.15, 1.75), VMAT.paint, 0x23272c, place(side * (x0 + 0.01), ay, az, yaw));
    kit.add(new THREE.BoxGeometry(0.08, 0.95, 0.15), VMAT.steel, undefined, place(side * (x0 + 0.05), ay + 0.05, az + 0.15, yaw, 0, side * 0.1));
    kit.add(new THREE.BoxGeometry(0.1, 0.2, 1.0), VMAT.steel, undefined, place(side * (x0 + 0.07), ay - 0.45, az + 0.12, yaw));
    kit.add(new THREE.TorusGeometry(0.22, 0.05, 6, 16).rotateY(Math.PI / 2), VMAT.steel, undefined, place(side * (x0 + 0.04), ay + 0.62, az + 0.1, yaw));
  }
}

/** Foredeck: the windlass and its chain, capstans, bitts, hatches and the sunpad in front of the house. */
function foredeck(kit: Kit, h: Hull, houseFront: number): void {
  const wz = -19.4;
  const d = h.deck(wz);
  kit.box(2.6, 0.36, 0.95, VMAT.gloss, WHITE, 0, d + 0.18, wz);
  for (const side of [-1, 1]) {
    kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.3, 18).rotateZ(Math.PI / 2), VMAT.steel, undefined, place(side * 0.78, d + 0.62, wz));
    kit.box(0.42, 0.42, 0.55, VMAT.paint, 0x5b6066, side * 1.15, d + 0.55, wz);
    // The chain from the gypsy forward to its deck pipe.
    kit.box(0.12, 0.05, 1.2, VMAT.paint, 0x3d4146, side * 0.82, h.deck(wz - 0.8) + 0.06, wz - 0.7);
    kit.add(new THREE.CylinderGeometry(0.19, 0.21, 0.1, 14), VMAT.steel, undefined, place(side * 0.85, h.deck(-20.8) + 0.05, -20.8));
    kit.add(new THREE.CylinderGeometry(0.2, 0.22, 0.46, 14), VMAT.steel, undefined, place(side * 1.7, h.deck(-17.8) + 0.23, -17.8));
    bitts(kit, side * 1.5, h.deck(-22.4), -22.4);
    // Fairleads in the bulwark, either side of the stem.
    kit.box(0.14, 0.22, 0.5, VMAT.steel, undefined, side * (h.deckHalf(-23.4) + 0.02), h.deck(-23.4) + 0.55, -23.4);
  }
  kit.box(0.9, 0.12, 0.9, VMAT.gloss, WHITE, 0, h.deck(-22.6) + 0.06, -22.6);
  kit.box(0.7, 0.1, 0.7, VMAT.gloss, WHITE, 0, h.deck(-16.8) + 0.05, -16.8);
  // The sunpad on the forward end of the house's front: a white base, cream cushions and a raised back.
  const sz = houseFront - 1.3;
  const sd = h.deck(sz);
  kit.box(4.2, 0.36, 2.4, VMAT.gloss, WHITE, 0, sd + 0.18, sz);
  kit.box(4.0, 0.14, 1.8, VMAT.paint, CREAM, 0, sd + 0.43, sz - 0.25);
  kit.add(new THREE.BoxGeometry(4.0, 0.14, 0.8), VMAT.paint, CREAM, place(0, sd + 0.62, sz + 0.85, 0, -0.6));
}

/** The transom: garage door, steps either side up from the swim platform, the platform, handrails, cleat. */
function transom(kit: Kit, h: Hull, L: number, main: number): THREE.Vector3 {
  const sternZ = L / 2;
  const P = MOSAIQUE_TENDER.platform;
  const py = 0.78;
  kit.box(7.6, 0.2, P, VMAT.paint, TEAK, 0, py, sternZ + P / 2);
  kit.box(7.7, 0.16, P + 0.1, VMAT.gloss, WHITE, 0, py - 0.18, sternZ + P / 2);
  // The tender garage's door in the middle of the transom, framed in stainless.
  kit.box(3.0, 1.25, 0.06, VMAT.gloss, DEEP_BLUE, 0, 1.62, sternZ + 0.05);
  for (const y of [0.98, 2.26]) kit.box(3.06, 0.05, 0.05, VMAT.steel, undefined, 0, y, sternZ + 0.09);
  for (const x of [-1.52, 1.52]) kit.box(0.05, 1.33, 0.05, VMAT.steel, undefined, x, 1.62, sternZ + 0.09);
  // Steps either side: up from the platform against the transom to the main aft deck, through gates in the bulwark.
  const n = 5;
  const rise = (main - py) / n;
  for (const side of [-1, 1]) {
    const x = side * 3.15;
    for (let k = 1; k <= n; k++) {
      const y = py + rise * k;
      const z = sternZ + 0.15 + (n - k) * 0.3;
      kit.box(1.1, y - py, 0.3, VMAT.gloss, WHITE, x, (y + py) / 2, z);
      kit.box(1.1, 0.04, 0.3, VMAT.paint, TEAK, x, y + 0.02, z);
    }
    kit.box(1.1, h.sheer(sternZ) - main, 0.1, VMAT.paint, DARK, x, (h.sheer(sternZ) + main) / 2, sternZ + 0.02);
    const outer = side * 3.72;
    kit.tube([v(outer, py + 0.9, sternZ + 0.15 + (n - 1) * 0.3), v(outer, main + 0.9, sternZ + 0.15)], 0.025, VMAT.steel);
    for (const t of [0, 1]) kit.rod(v(outer, py + rise * (t ? n : 1), sternZ + 0.15 + (t ? 0 : (n - 1) * 0.3)), v(outer, py + 0.9 + (main - py) * t, sternZ + 0.15 + (t ? 0 : (n - 1) * 0.3)), 0.022, VMAT.steel, undefined, 6);
  }
  const cleat = v(0, py + 0.16, sternZ + P - 0.25);
  kit.box(0.36, 0.08, 0.1, VMAT.steel, undefined, cleat.x, cleat.y, cleat.z);
  return cleat;
}

/** Mosaique herself, in her own frame (x to starboard, y up from the water, z aft; the bow at -z). */
function yachtModel(): YachtParts {
  const L = MOSAIQUE.loa;
  const D = MOSAIQUE_DRAWN;
  const kit = new Kit();
  const spec: HullSpec = {
    length: L, beam: MOSAIQUE.beam, freeboard: D.freeboard, draft: D.draft, sheerBow: 1.6, sheerStern: 0.05, stemRake: 3.0,
    entry: 0.42, transom: 0.86, deadrise: 0.32, flare: 0.07, bulwark: 1.0, bootTop: 0.28,
    colours: { bottom: 0x7a2a23, boot: 0x16181b, topsides: BLUE, deck: TEAK, bulwarkInside: WHITE }, stations: 48, sections: 20,
  };
  const h = hull(kit, spec, VMAT.gloss);
  const surf = hullSurface(spec);
  const sternZ = L / 2;
  const main = h.deck(0);
  hullFittings(kit, h, L, surf);

  // ---- Main deck: the saloon from z -13 to 16, its windows divided by mullions, side doors, handrails.
  const mFront = -13;
  const mBack = 16;
  const mw = 7.6;
  cabin(kit, { z: (mFront + mBack) / 2, y: main, length: mBack - mFront, width: mw, height: D.mainHouse, rFront: 3.0, rBack: 0.4, rake: 0.5, tumble: 0.12, colour: WHITE, windows: [0.28, 0.86], front: [0.3, 0.86], roof: { overhang: 0.25, thickness: D.roof }, material: VMAT.gloss });
  const upFloor = main + D.mainHouse + D.roof;
  const mWin = { y: main + D.mainHouse * 0.57, h: D.mainHouse * 0.58 + 0.06 };
  for (const side of [-1, 1]) {
    const mx = side * (mw / 2 - 0.12 * 0.57 + 0.03);
    for (let z = -9; z <= mBack - 1; z += 2.4) kit.box(0.07, mWin.h, 0.13, VMAT.gloss, WHITE, mx, mWin.y, z);
    // The side door, its handle, and a handrail along the house side.
    kit.box(0.08, 2.05, 0.95, VMAT.gloss, WHITE, mx, main + 1.03, -4.4);
    kit.box(0.06, 0.2, 0.04, VMAT.steel, undefined, mx + side * 0.04, main + 1.0, -4.05);
    kit.tube([v(side * (mw / 2 + 0.08), main + 1.05, -9.5), v(side * (mw / 2 + 0.08), main + 1.05, mBack - 0.5)], 0.025, VMAT.steel);
    for (const z of [-9.5, -1, 7.5, mBack - 0.5]) kit.rod(v(side * (mw / 2 + 0.02), main + 1.05, z), v(side * (mw / 2 + 0.08), main + 1.05, z), 0.018, VMAT.steel, undefined, 6);
    bitts(kit, side * (h.deckHalf(-6) - 0.45), main, -6);
    bitts(kit, side * (h.deckHalf(23.3) - 0.45), main, 23.3);
  }
  foredeck(kit, h, mFront);

  // ---- Main aft deck, under the upper deck's overhang: a sofa and a low table.
  sofa(kit, 0, main, 21.2, 5.4);
  kit.box(2.2, 0.06, 0.95, VMAT.paint, TEAK, 0, main + 0.44, 19.6);
  kit.box(1.6, 0.4, 0.6, VMAT.gloss, WHITE, 0, main + 0.2, 19.6);
  transom(kit, h, L, main);

  // ---- Upper deck: the bridge forward behind raked glass under its visor, the sky lounge, side doors.
  const uFront = -11;
  const uBack = 8;
  const uw = 7.4;
  const uBase = upFloor - 0.05;
  cabin(kit, { z: (uFront + uBack) / 2, y: uBase, length: uBack - uFront, width: uw, height: D.upperHouse, rFront: 3.0, rBack: 0.4, rake: 1.1, tumble: 0.15, colour: WHITE, windows: [0.3, 0.86], front: [0.22, 0.9], roof: { overhang: 0.3, thickness: 0.2 }, material: VMAT.gloss });
  const sunFloor = uBase + D.upperHouse + 0.2;
  for (const side of [-1, 1]) {
    const ux = side * (uw / 2 - 0.15 * 0.58 + 0.03);
    for (let z = -7.6; z <= uBack - 0.8; z += 2.2) kit.box(0.07, D.upperHouse * 0.56 + 0.06, 0.13, VMAT.gloss, WHITE, ux, uBase + D.upperHouse * 0.58, z);
    kit.box(0.08, 1.95, 0.9, VMAT.gloss, WHITE, ux, uBase + 0.98, -7.0);
    // Sidelights on the bridge's shoulders: red to port, green to starboard, in white boxes.
    kit.box(0.3, 0.32, 0.5, VMAT.gloss, WHITE, side * (uw / 2 - 0.25), sunFloor - 0.45, -8.4);
    kit.box(0.04, 0.2, 0.36, VMAT.paint, side < 0 ? 0xc0282d : 0x1f8f3a, side * (uw / 2 - 0.08), sunFloor - 0.45, -8.4);
  }
  // The visor over the windscreen: a centre piece and two angled wings.
  kit.box(3.4, 0.1, 0.9, VMAT.gloss, WHITE, 0, sunFloor - 0.05, uFront + 0.75);
  for (const side of [-1, 1]) kit.box(2.0, 0.1, 0.8, VMAT.gloss, WHITE, side * 2.35, sunFloor - 0.05, uFront + 1.35, -side * 0.55);
  // Windscreen wipers.
  for (const x of [-1.6, 0, 1.6]) kit.add(new THREE.BoxGeometry(0.04, 0.85, 0.03), VMAT.paint, DARK, place(x, uBase + 1.3, uFront + 0.45, 0, 0.42));

  // ---- Upper aft deck: carried aft over the main aft deck on posts; teak, white bulwarks with a stainless rail,
  // a dining table, lifebuoys; the sun deck's floor carried aft over its forward half.
  const aftEnd = 22;
  kit.box(8.0, 0.26, aftEnd - mBack, VMAT.gloss, WHITE, 0, upFloor - 0.13, (aftEnd + mBack) / 2);
  kit.box(7.8, 0.04, aftEnd - uBack - 0.2, VMAT.paint, TEAK, 0, upFloor + 0.02, (aftEnd + uBack) / 2);
  for (const side of [-1, 1]) kit.rod(v(side * 3.7, main, aftEnd - 0.4), v(side * 3.7, upFloor - 0.26, aftEnd - 0.4), 0.09, VMAT.gloss, WHITE, 10);
  const bw = 3.95;
  for (const side of [-1, 1]) kit.box(0.08, 0.95, aftEnd - uBack, VMAT.gloss, WHITE, side * bw, upFloor + 0.475, (aftEnd + uBack) / 2);
  kit.box(bw * 2, 0.95, 0.08, VMAT.gloss, WHITE, 0, upFloor + 0.475, aftEnd);
  kit.tube([v(-bw, upFloor + 1.0, uBack), v(-bw, upFloor + 1.0, aftEnd), v(bw, upFloor + 1.0, aftEnd), v(bw, upFloor + 1.0, uBack)], 0.03, VMAT.steel);
  diningTable(kit, 0, upFloor, 13.2, 3.0, 4);
  sofa(kit, 0, upFloor, aftEnd - 0.55, 5.6);
  for (const side of [-1, 1]) lifebuoy(kit, side * (bw + 0.06), upFloor + 0.5, aftEnd - 1.2, side);
  const sunAft = 15;
  kit.box(7.9, 0.2, sunAft - uBack, VMAT.gloss, WHITE, 0, sunFloor - 0.1, (sunAft + uBack) / 2);
  for (const side of [-1, 1]) kit.rod(v(side * 3.6, upFloor, sunAft - 0.4), v(side * 3.6, sunFloor - 0.2, sunAft - 0.4), 0.07, VMAT.gloss, WHITE, 10);

  // ---- Sun deck: the deckhouse, teak, a bar under the hardtop, sunbeds and umbrellas, rails.
  const sBase = sunFloor - 0.05;
  const sHouseH = 2.1;
  cabin(kit, { z: -3, y: sBase, length: 7, width: 5.8, height: sHouseH, rFront: 2.0, rBack: 0.3, rake: 0.5, colour: WHITE, windows: [0.32, 0.86], front: [0.32, 0.86], roof: { overhang: 0.2, thickness: 0.16 }, material: VMAT.gloss });
  const sRoof = sBase + sHouseH + 0.16;
  kit.box(7.4, 0.04, sunAft - 0.7, VMAT.paint, TEAK, 0, sunFloor + 0.02, (sunAft + 0.7) / 2);
  const hardTop = sunFloor + 2.45;
  kit.box(6.2, 0.16, 6, VMAT.gloss, WHITE, 0, hardTop, 4.5);
  for (const side of [-1, 1]) for (const z of [2.2, 6.8]) kit.rod(v(side * 2.9, sunFloor, z), v(side * 2.9, hardTop - 0.08, z), 0.05, VMAT.steel);
  kit.box(2.8, 1.0, 0.7, VMAT.gloss, WHITE, 0, sunFloor + 0.5, 2.6);
  kit.box(2.9, 0.05, 0.85, VMAT.paint, TEAK, 0, sunFloor + 1.03, 2.6);
  for (const x of [-0.9, 0, 0.9]) {
    kit.add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), VMAT.steel, undefined, place(x, sunFloor + 0.36, 3.35));
    kit.add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), VMAT.paint, CREAM, place(x, sunFloor + 0.74, 3.35));
  }
  sofa(kit, 0, sunFloor, 7.0, 4.6);
  for (const x of [-2.7, -0.9, 0.9, 2.7]) sunbed(kit, x, sunFloor, 11.6);
  for (const x of [-2.1, 2.1]) {
    kit.add(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), VMAT.steel, undefined, place(x, sunFloor + 1.2, 14.0));
    kit.add(new THREE.ConeGeometry(1.4, 0.45, 12, 1, true), VMAT.canvas, WHITE, place(x, sunFloor + 2.35, 14.0));
  }
  const railRun = (y: number, hw: number, z0: number, z1: number) => [v(-hw, y, z0), v(-hw, y, z1), v(hw, y, z1), v(hw, y, z0)];
  rail(kit, railRun(sunFloor, 3.7, -8, sunAft - 0.2), 1.0, { spacing: 1.6 });

  // ---- The radar mast: raked legs, a crossbar with the two big radomes side by side, an open-array radar ahead of
  // them, horns, whips, a searchlight and satellite domes on the deckhouse roof; the signal mast above, its yard and
  // masthead light; the burgee at its truck.
  const mastZ = -1.2;
  const legTop = sRoof + 2.6;
  for (const side of [-1, 1]) kit.rod(v(side * 1.9, sRoof, mastZ + 1.4), v(side * 1.4, legTop, mastZ), 0.2, VMAT.gloss, WHITE, 12);
  {
    // The arch between the legs: a white frame (a trapezoid with an opening), raked like them.
    const H = Math.hypot(legTop - sRoof, 1.4);
    const outer = new THREE.Shape([new THREE.Vector2(-2.05, 0), new THREE.Vector2(2.05, 0), new THREE.Vector2(1.55, H), new THREE.Vector2(-1.55, H)]);
    outer.holes.push(new THREE.Path([new THREE.Vector2(-1.55, 0.45), new THREE.Vector2(-1.25, H - 0.5), new THREE.Vector2(1.25, H - 0.5), new THREE.Vector2(1.55, 0.45)]));
    const arch = new THREE.ExtrudeGeometry(outer, { depth: 0.24, bevelEnabled: false }).translate(0, 0, -0.12);
    kit.add(arch, VMAT.gloss, WHITE, place(0, sRoof, mastZ + 1.4, 0, -Math.atan2(1.4, legTop - sRoof)));
  }
  kit.box(4.4, 0.32, 0.6, VMAT.gloss, WHITE, 0, legTop, mastZ);
  for (const side of [-1, 1]) {
    kit.add(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 16), VMAT.gloss, WHITE, place(side * 1.45, legTop + 0.33, mastZ));
    kit.add(new THREE.SphereGeometry(0.72, 22, 16), VMAT.gloss, WHITE, place(side * 1.45, legTop + 1.15, mastZ));
    kit.rod(v(side * 2.1, legTop + 0.1, mastZ), v(side * 2.1, legTop + 2.7, mastZ), 0.02, VMAT.paint, 0xe9e9e4, 4);
    kit.add(new THREE.ConeGeometry(0.1, 0.38, 10, 1, true).rotateX(Math.PI / 2), VMAT.steel, undefined, place(side * 0.55, legTop + 0.28, mastZ - 0.45));
    kit.add(new THREE.SphereGeometry(0.32, 14, 10), VMAT.gloss, WHITE, place(side * 1.8, sRoof + 0.42, -5.2));
    kit.add(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 10), VMAT.gloss, WHITE, place(side * 1.8, sRoof + 0.12, -5.2));
  }
  kit.box(0.42, 0.3, 0.42, VMAT.paint, 0x2d3035, 0, legTop + 0.31, mastZ - 1.0);
  kit.box(3.6, 0.22, 0.34, VMAT.paint, 0x2d3035, 0, legTop + 0.56, mastZ - 1.0);
  kit.add(new THREE.SphereGeometry(0.42, 16, 12), VMAT.gloss, WHITE, place(0, sRoof + 0.5, -4.2));
  kit.rod(v(0.9, sRoof, -5.9), v(0.9, sRoof + 0.35, -5.9), 0.04, VMAT.steel, undefined, 6);
  kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.36, 12).rotateX(Math.PI / 2), VMAT.paint, DARK, place(0.9, sRoof + 0.5, -5.95));
  const truck = D.masthead;
  kit.rod(v(0, legTop, mastZ), v(0, truck, mastZ), 0.09, VMAT.gloss, WHITE, 10);
  const yard = legTop + (truck - legTop) * 0.55;
  kit.box(3.0, 0.1, 0.12, VMAT.gloss, WHITE, 0, yard, mastZ);
  for (const side of [-1, 1]) {
    kit.rod(v(side * 1.3, yard, mastZ), v(side * 1.3, yard + 1.2, mastZ), 0.02, VMAT.paint, 0xe9e9e4, 4);
    kit.add(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), VMAT.gloss, WHITE, place(side * 0.8, yard + 0.11, mastZ));
  }
  kit.box(0.2, 0.26, 0.18, VMAT.gloss, WHITE, 0, legTop + (truck - legTop) * 0.35, mastZ - 0.12);
  kit.add(new THREE.SphereGeometry(0.1, 10, 8), VMAT.gloss, WHITE, place(0, truck + 0.05, mastZ));

  // ---- The ensign staff off the stern: on the transom's top at the centre line, raked aft, varnished, a gilt truck.
  const staffBase = v(0, h.sheer(sternZ) + 0.02, sternZ + 0.08);
  const rake = 0.45;
  const staffLen = 3.4;
  const staffTop = staffBase.clone().add(v(0, staffLen * Math.cos(rake), staffLen * Math.sin(rake)));
  kit.add(new THREE.CylinderGeometry(0.08, 0.09, 0.3, 12), VMAT.steel, undefined, place(staffBase.x, staffBase.y + 0.1, staffBase.z, 0, rake));
  kit.rod(staffBase, staffTop, 0.045, VMAT.gloss, 0x7a4b26, 10);
  kit.add(new THREE.SphereGeometry(0.075, 10, 8), VMAT.gloss, 0xd6a73a, place(staffTop.x, staffTop.y + 0.06, staffTop.z));

  // ---- Fairleads for the stern lines at the transom's corners; the tender's fenders and the cleats for its lines.
  const sternFairleads = [-1, 1].map((side) => v(side * 3.45, h.sheer(sternZ) - 0.12, sternZ + 0.03));
  for (const f of sternFairleads) kit.box(0.5, 0.2, 0.14, VMAT.steel, undefined, f.x, f.y, f.z);
  const tz = -MOSAIQUE_TENDER.along;
  const tenderCleats = [tz - 3.4, tz + 3.0].map((z) => v(h.deckHalf(z) - 0.2, h.sheer(z) + 0.02, z));
  for (const c of tenderCleats) kit.box(0.1, 0.08, 0.36, VMAT.steel, undefined, c.x, c.y, c.z);
  for (const dz of [-2.0, 0, 2.0]) {
    const z = tz + dz;
    const x = surf(1.1, z) + 0.2;
    kit.add(new THREE.CapsuleGeometry(0.19, 0.75, 4, 12), VMAT.paint, 0x23395d, place(x, 1.15, z));
    kit.rod(v(x, 1.7, z), v(h.half(z) - 0.05, h.sheer(z) + 0.05, z), 0.012, VMAT.paint, ROPE, 4);
  }

  // ---- A few of her crew about the decks (E).
  const crew: [number, number, number, number, number, boolean][] = [
    [3, -1.3, h.deck(-17.2), -17.2, 0, false],
    [8, 1.6, main, 18.4, Math.PI, false],
    [5, 0.95, sunFloor + 0.28, 11.2, Math.PI, true],
  ];
  for (const [seed, x, y, z, yaw, sitting] of crew) kit.add(bakedPerson(seed, sitting).clone(), VMAT.paint, undefined, place(x, y, z, yaw));

  const group = kit.build('mosaique');
  // Her name across the transom's top, above the garage door.
  const tex = nameTexture(MOSAIQUE.name);
  if (tex) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.74), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    plate.name = 'mosaique-name';
    plate.position.set(0, (h.sheer(sternZ) + 2.3) / 2 + 0.05, sternZ + 0.07);
    group.add(plate);
  }
  return { group, ensignAt: staffTop, burgeeAt: v(0, truck, mastZ), bow: v(0, h.sheer(-L / 2 + 1), -L / 2 + 0.6), stern: v(0, h.deck(sternZ) + 0.6, sternZ - 0.4), sternFairleads, tenderCleats, mastZ };
}

/** The buoys, the yacht on them, her tender, her mooring lines and her flags (add `group` to the floating group). */
export class ShipBuoysView {
  readonly group = new THREE.Group();
  readonly yacht: THREE.Group;
  private readonly ensign: WavingFlag;
  private readonly burgee: WavingFlag;
  private readonly lights: THREE.Group;
  private readonly heading: number;
  private day = 1;

  constructor() {
    this.group.name = 'ship-buoys';
    for (const b of SHIP_BUOYS) this.group.add(buoyModel(b));
    const berth = mooredBerth();
    this.heading = berth.heading;
    const m = yachtModel();
    this.yacht = m.group;
    this.yacht.position.set(berth.e, 0, -berth.n);
    this.yacht.rotation.y = -berth.heading;
    this.group.add(this.yacht);
    // Her tender astern on its painter, bow towards her (the yacht's frame: aft is +z).
    const tender = tenderModel();
    tender.position.set(MOSAIQUE_TENDER.across, 0, -MOSAIQUE_TENDER.along);
    this.yacht.add(tender);
    // Her lines: the bow to the buoy ahead, the stern to the one astern; the tender's painter.
    const toWorld = (p: THREE.Vector3) => p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -berth.heading).add(new THREE.Vector3(berth.e, 0, -berth.n));
    const ring = (id: string) => {
      const b = SHIP_BUOYS.find((x) => x.id === id)!;
      return new THREE.Vector3(b.e, SHIP_BUOY_SIZE.freeboard + 0.42, -b.n);
    };
    const lines = new Kit();
    for (const dx of [-0.5, 0.5]) {
      hangingLine(lines, toWorld(m.bow.clone().add(new THREE.Vector3(dx, 0, 0))), ring(MOSAIQUE.between[1]), 2.2);
    }
    for (const f of m.sternFairleads) hangingLine(lines, toWorld(f), ring(MOSAIQUE.between[0]), 2.2);
    // The tender's bow and stern lines up to her cleats.
    const t = MOSAIQUE_TENDER;
    const ends = [v(t.across - 0.3, 0.95, -t.along - t.length / 2 + 0.5), v(t.across - 0.6, 0.95, -t.along + t.length / 2 - 0.4)];
    ends.forEach((e, i) => hangingLine(lines, toWorld(m.tenderCleats[i]!), toWorld(e), 0.25, 0.018));
    this.group.add(lines.build('mosaique-lines'));
    // Flags: the club's ensign off the stern, its burgee (large) at the masthead.
    this.ensign = new WavingFlag('mosaique-ensign', MOSAIQUE_DRAWN.ensign.fly, MOSAIQUE_DRAWN.ensign.hoist, rdycEnsignTexture(), 0xd0101e);
    this.ensign.pivot.position.copy(m.ensignAt);
    this.yacht.add(this.ensign.pivot);
    const bt = typeof document === 'undefined' ? null : new THREE.CanvasTexture(burgeeCanvas());
    if (bt) bt.colorSpace = THREE.SRGBColorSpace;
    this.burgee = new WavingFlag('mosaique-burgee', MOSAIQUE_DRAWN.burgee.fly, MOSAIQUE_DRAWN.burgee.hoist, bt, 0xc8102e, bt ? 0.5 : 0);
    this.burgee.pivot.position.copy(m.burgeeAt).add(new THREE.Vector3(0, MOSAIQUE_DRAWN.burgee.hoist / 2, 0));
    this.yacht.add(this.burgee.pivot);
    // At anchor (moored) by night: an all-round white light (COLREGs Rule 30).
    this.lights = buildLights(colregsLights('anchored', { length: MOSAIQUE.loa, beam: MOSAIQUE.beam, mastY: MOSAIQUE_DRAWN.masthead - 2.2, mastZ: m.mastZ }));
    this.yacht.add(this.lights);
  }

  setDaylight(day: number): void {
    this.day = day;
  }

  /** The flags in the wind (from `windFromDir` rad, `windSpeed` m/s); the ensign at colours; the light at night. */
  update(epochMs: number, windFromDir: number, windSpeed: number, time: number, camera?: THREE.Camera): void {
    const { yaw, aws } = flagYaw(windFromDir, windSpeed, this.heading, 0);
    this.ensign.pivot.visible = coloursFlying(epochMs, RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    if (this.ensign.pivot.visible) this.ensign.update(yaw + 0.05 * Math.sin(time * 1.3), aws, time);
    // The burgee at the truck feels a little more wind (E).
    this.burgee.update(yaw + 0.04 * Math.sin(time * 1.7 + 1), aws * 1.15, time + 0.4);
    if (camera) {
      this.yacht.updateMatrixWorld();
      updateLights(this.lights, camera, this.day < 0.35);
    }
  }
}
