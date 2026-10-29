import * as THREE from 'three';
import type { VesselKind, VesselState } from '../sim/env/traffic';
import { makeLabel } from './labels';
import { bakedPerson } from './crew';
import { Kit, VMAT, cabin, car, fenderLine, hull, lifebuoy, mast, navLights, outboard, place, rail, setLightsOn } from './vessels';
import { flagDroop, flagYaw } from './vane';
import { Exhaust } from './railway';
import { longAxisDeg } from './landmarks';

/**
 * River traffic as 3D vessels (positions and manoeuvres from src/sim/env/traffic.ts), modelled with the vessel
 * kit (vessels.ts): lofted hulls, superstructures with framed windows, rails, fendering, masts and lights,
 * cars and passengers. The Lower Ferry is its float - car deck, walkways, hinged ramps at both ends, cars -
 * with the tug (Hauley IV-VI, F1) lashed alongside (F3), which the model moves on its own (it swings end for
 * end at each slip). The Higher Ferry is a cable ferry (2009, Pendennis, F5) on its two cables (F6). The
 * passenger ferry is drawn as the Dartmouth Princess (18 m, blue hull, F7) and the Totnes cruise as the Cardiff
 * Castle (30 m by 6.4 m, three decks, F8; her livery and layout from the owner's photograph, P3). The Hindostan,
 * BRNC's moored training ship, is drawn as a Sandown-class minehunter (N1). Other shapes, colours and liveries are
 * illustrative (E): no measured drawings were found.
 * Model frame: x = starboard, y = up (0 = waterline), z = aft (bow towards -z), as the Squib's.
 */

const C = {
  antifouling: 0x6b1d1d,
  black: 0x18191b,
  white: 0xf2f1ec,
  cream: 0xe9e4d6,
  navy: 0x1f3550,
  blue: 0x1d4d8a,
  greyDeck: 0x6e7175,
  wood: 0x9a7350,
  teak: 0xa77d52,
  yellow: 0xe3b21c,
  hiVis: 0xd7e021,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function addPerson(kit: Kit, x: number, y: number, z: number, yaw: number, seed: number, sitting = false): void {
  kit.add(bakedPerson(seed, sitting), VMAT.paint, undefined, place(x, y, z, yaw));
}

/** A bench along z at (x, y, z), length l, with people on it (facing inboard: side ±1 the bench's side). */
function bench(kit: Kit, x: number, y: number, z: number, l: number, side: number, people: number, seed: number): void {
  kit.box(0.45, 0.06, l, VMAT.paint, C.wood, x, y + 0.45, z);
  kit.box(0.4, 0.42, l - 0.1, VMAT.paint, C.white, x, y + 0.21, z);
  for (let i = 0; i < people; i++) {
    const pz = z - l / 2 + ((i + 0.5) * l) / people;
    // Facing the way `side` points (a figure faces -z; turning by -side·90° faces it to +side·x).
    addPerson(kit, x + side * 0.05, y, pz, (-side * Math.PI) / 2, seed + i * 3, true);
  }
}

let ensignMat: THREE.MeshStandardMaterial | undefined;
/** The Red Ensign (the merchant flag British passenger boats wear): red field, the Union Flag in the canton. */
function ensignMaterial(): THREE.Material {
  if (ensignMat) return ensignMat;
  ensignMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 60;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c8102e';
    g.fillRect(0, 0, 120, 60);
    // Canton (hoist on the left, top half): blue, white and red saltires, white and red crosses.
    g.save();
    g.beginPath();
    g.rect(0, 0, 60, 30);
    g.clip();
    g.fillStyle = '#012169';
    g.fillRect(0, 0, 60, 30);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(60, 30);
    g.moveTo(60, 0);
    g.lineTo(0, 30);
    g.stroke();
    g.strokeStyle = '#c8102e';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fillRect(25, 0, 10, 30);
    g.fillRect(0, 10, 60, 10);
    g.fillStyle = '#c8102e';
    g.fillRect(27, 0, 6, 30);
    g.fillRect(0, 12, 60, 6);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    ensignMat.map = t;
  }
  return ensignMat;
}

let ensignGeo: THREE.PlaneGeometry | undefined;
/**
 * The ensign on a staff at the stern: the flag hangs from a pivot at the staff (named 'ensign'), its fly along
 * the pivot's +x, so turning the pivot flies it with the wind (TrafficView.update); built flying aft.
 */
function ensign(group: THREE.Group, kit: Kit, x: number, y: number, z: number): void {
  kit.rod(V(x, y, z), V(x, y + 1.3, z + 0.25), 0.02, VMAT.paint, C.wood, 6);
  if (!ensignGeo) {
    ensignGeo = new THREE.PlaneGeometry(0.8, 0.4);
    // Hoist (the canton side, u = 0) at the pivot, the fly along +x.
    ensignGeo.translate(0.4, -0.2, 0);
  }
  const pivot = new THREE.Group();
  pivot.position.set(x, y + 1.28, z + 0.24);
  pivot.rotation.y = -Math.PI / 2;
  pivot.name = 'ensign';
  const flag = new THREE.Mesh(ensignGeo, ensignMaterial());
  flag.name = 'ensign-flag';
  pivot.add(flag);
  group.add(pivot);
}

/** A wake: a V of foam behind the stern, scaled by speed. */
let wakeTex: THREE.Texture | undefined;
function wake(beam: number): THREE.Mesh {
  if (!wakeTex && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(64, 0);
    g.lineTo(6, 256);
    g.moveTo(64, 0);
    g.lineTo(122, 256);
    g.stroke();
    g.fillStyle = grad;
    g.globalAlpha = 0.35;
    g.fillRect(44, 0, 40, 256);
    wakeTex = new THREE.CanvasTexture(c);
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.06, 0.5);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: wakeTex ?? null, transparent: true, depthWrite: false, opacity: 0 }));
  m.name = 'wake';
  m.scale.set(beam * 3, 1, beam * 6);
  m.renderOrder = 3;
  return m;
}

// ------------------------------------------------------------------ the Lower Ferry

/** The tug's cream-yellow upperworks (the owner's photographs). */
const TUG_CREAM = 0xe4cd8e;

/**
 * Tug of the Lower Ferry (Hauley IV-VI, F1): a round-bilge workboat, heavily fendered, wheelhouse forward of
 * midships. Black hull, cream-yellow wheelhouse and tyres for fenders, as the owner's photographs show her.
 */
function tugModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tug';
  const kit = new Kit();
  const L = 9.5;
  const B = 3.6;
  const h = hull(kit, {
    length: L, beam: B, freeboard: 1.0, draft: 1.2, sheerBow: 0.45, sheerStern: 0.12, stemRake: 0.5, entry: 0.42, transom: 0.62,
    flare: 0.12, bulwark: 0.5, colours: { bottom: C.antifouling, boot: C.black, topsides: C.black, deck: C.greyDeck, bulwarkInside: TUG_CREAM },
  });
  // Rubber D-fender along the sheer, a thick bow fender, tyres down the sides.
  for (const s of [-1, 1]) fenderLine(kit, h.sheerLine(s, -0.1, 0.06, 1).map((p) => p.setY(p.y - 0.18)), 0.14);
  fenderLine(kit, [...h.sheerLine(-1, -0.15, 0, 0.12).reverse(), ...h.sheerLine(1, -0.15, 0, 0.12)].map((p) => p.setY(p.y - 0.35)), 0.3);
  for (const s of [-1, 1]) {
    for (const z of [-1.8, -0.2, 1.4, 3.0]) {
      kit.add(new THREE.TorusGeometry(0.32, 0.12, 8, 14), VMAT.rubber, undefined, place(s * (h.half(z) + 0.12), 0.5, z, Math.PI / 2));
    }
  }
  // Wheelhouse with windows all round (the skipper sees both ends of the float), roof, mast with radar.
  const wz = -0.8;
  const wy = h.deck(wz);
  cabin(kit, { z: wz, y: wy, length: 2.8, width: 2.3, height: 2.05, rFront: 0.55, rBack: 0.25, rake: 0.25, tumble: 0.12, colour: TUG_CREAM, windows: [0.5, 0.9], front: [0.45, 0.92], roof: { overhang: 0.15, thickness: 0.09, colour: C.white } });
  mast(kit, 0, wy + 2.14, wz + 0.3, 2.3, { radar: true });
  lifebuoy(kit, -1.16, wy + 0.8, wz + 0.6, -1);
  lifebuoy(kit, 1.16, wy + 0.8, wz + 0.6, 1);
  // Exhaust stack, towing bitts and the hatch on the after deck.
  const sz = 1.05;
  kit.rod(V(0.6, h.deck(sz), sz), V(0.6, h.deck(sz) + 2.4, sz), 0.12, VMAT.paint, C.black, 10);
  kit.rod(V(0.6, h.deck(sz) + 1.5, sz), V(0.6, h.deck(sz) + 1.75, sz), 0.13, VMAT.paint, C.cream, 10);
  for (const x of [-0.7, 0.7]) kit.rod(V(x, h.deck(3), 3), V(x, h.deck(3) + 0.55, 3), 0.11, VMAT.paint, C.black);
  kit.rod(V(-0.7, h.deck(3) + 0.42, 3), V(0.7, h.deck(3) + 0.42, 3), 0.06, VMAT.paint, C.black);
  kit.box(1.2, 0.12, 1.2, VMAT.paint, TUG_CREAM, 0, h.deck(2) + 0.06, 2);
  addPerson(kit, 0.4, wy, wz + 0.2, 0, 11);
  g.add(kit.build('tug-hull'));
  navLights(g, { length: L, beam: B, mastY: wy + 4.4, mastZ: wz + 0.3, sideY: wy + 1.6, ram: true });
  g.add(wake(B));
  return g;
}

/**
 * Lower Ferry float: a spoon-ended steel pontoon, two car lanes between walkways, ramps at both ends with
 * orange lips, and "Do not board" boards on the gates at each end (the owner's photographs).
 */
function floatModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const h = hull(kit, {
    length, beam, freeboard: 0.85, draft: 0.9, pontoon: true, camber: 0.04,
    colours: { bottom: 0x3a1414, boot: C.black, topsides: C.black, deck: C.greyDeck },
  });
  const deckY = h.deck(0);
  const deckL = length - 2.5;
  // Walkways (lighter, non-slip) along each side behind rails; the car lanes with their markings.
  const walk = 1.3;
  for (const s of [-1, 1]) {
    kit.box(walk, 0.04, deckL, VMAT.paint, 0x9a9d9f, s * (beam / 2 - walk / 2 - 0.05), deckY + 0.02, 0);
    rail(kit, [V(s * (beam / 2 - walk - 0.1), deckY, -deckL / 2 + 0.6), V(s * (beam / 2 - walk - 0.1), deckY, deckL / 2 - 0.6)], 1.05, { spacing: 2, colour: 0xe8e8e2, material: VMAT.paint, r: 0.03 });
    rail(kit, [V(s * (beam / 2 - 0.12), deckY, -deckL / 2 + 0.3), V(s * (beam / 2 - 0.12), deckY, deckL / 2 - 0.3)], 1.1, { spacing: 2, colour: 0xe8e8e2, material: VMAT.paint, r: 0.03 });
  }
  for (const x of [-beam / 2 + walk + 0.3, 0, beam / 2 - walk - 0.3]) kit.box(0.12, 0.01, deckL - 3, VMAT.paint, x === 0 ? 0xf2f2ee : C.yellow, x, deckY + 0.045, 0);
  // Crew shelter on the port walkway, lamp posts at the corners, lifebuoys on the rails.
  cabin(kit, { x: -(beam / 2 - walk / 2 - 0.05), z: 2, y: deckY, length: 2.6, width: 1.15, height: 2.15, rFront: 0.15, rBack: 0.15, colour: C.cream, windows: [0.5, 0.88], roof: { overhang: 0.12, thickness: 0.08, colour: C.navy } });
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      const p = V(s * (beam / 2 - 0.25), deckY, e * (deckL / 2 - 1));
      kit.rod(p, p.clone().setY(deckY + 3.2), 0.05, VMAT.paint, 0x2b2e33);
      kit.box(0.35, 0.18, 0.25, VMAT.paint, 0xe8e8e2, p.x - s * 0.15, deckY + 3.25, p.z);
    }
    lifebuoy(kit, s * (beam / 2 - 0.1), deckY + 0.75, -4, s);
  }
  // The gates' boards at each end of the walkways: white, lettered in red ("Do not board" when the ramp is up).
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) {
      const x = s * (beam / 2 - walk / 2 - 0.05);
      kit.box(walk - 0.2, 0.55, 0.04, VMAT.paint, 0xf4f4f0, x, deckY + 1.05, e * (deckL / 2 - 0.25));
      kit.box(walk - 0.2, 0.12, 0.05, VMAT.paint, 0xc0282d, x, deckY + 1.17, e * (deckL / 2 - 0.25));
      kit.box(walk - 0.5, 0.06, 0.05, VMAT.paint, 0xc0282d, x, deckY + 0.95, e * (deckL / 2 - 0.25));
    }
  }
  // Cars, two lanes of up to four (8 cars, F1); foot passengers and a deckhand in hi-vis.
  const n = 3 + (seed % 6);
  for (let i = 0; i < n; i++) car(kit, (i % 2 ? 1 : -1) * (beam / 2 - walk - 1.55), deckY + 0.04, -deckL / 2 + 4 + Math.floor(i / 2) * 5.4, seed * 7 + i);
  for (let i = 0; i < 1 + (seed % 3); i++) addPerson(kit, (i % 2 ? 1 : -1) * (beam / 2 - 0.7), deckY + 0.04, -3 + i * 2.5, i % 2 ? Math.PI / 2 : -Math.PI / 2, seed + i);
  g.add(kit.build('float'));
  // Hinged ramps at both ends (pivot at the deck edge), animated from the state: steel plates with hazard edges.
  for (const end of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = end < 0 ? 'ramp-bow' : 'ramp-stern';
    pivot.position.set(0, deckY, (end * deckL) / 2 + end * 0.2);
    const rk = new Kit();
    const w = beam - 2 * walk - 0.4;
    rk.box(w, 0.16, 3.6, VMAT.paint, 0x7a7e82, 0, 0, end * 1.8);
    rk.box(w, 0.18, 0.35, VMAT.paint, 0xe07a2a, 0, 0.01, end * 3.45);
    for (const s of [-1, 1]) {
      rk.box(0.14, 0.45, 3.6, VMAT.paint, 0xe07a2a, s * (w / 2 + 0.07), 0.15, end * 1.8);
      for (let k = 0; k < 6; k++) rk.box(0.15, 0.46, 0.22, VMAT.paint, C.black, s * (w / 2 + 0.07), 0.15, end * (0.3 + k * 0.6));
    }
    pivot.add(rk.build('ramp'));
    g.add(pivot);
  }
  navLights(g, { length: deckL, beam, mastY: deckY + 3.4, mastZ: 2, sideY: deckY + 2.4, ram: true });
  return g;
}

// ------------------------------------------------------------------ the Higher Ferry

/** The Higher Ferry: a cable ferry with three car lanes, a lounge and control cabin to starboard, big ramps. */
function bridgeModel(length: number, beam: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const h = hull(kit, {
    length, beam, freeboard: 1.2, draft: 1.2, pontoon: true, camber: 0.05,
    colours: { bottom: 0x3a1414, boot: C.white, topsides: C.navy, deck: 0x6a6e72 }, bootTop: 0.35,
  });
  const deckY = h.deck(0);
  const deckL = length - 3;
  const sup = 3.2; // width of the starboard superstructure
  // Lanes and the port walkway.
  for (const x of [-beam / 2 + 1.6, -beam / 2 + 1.6 + 3.3, -beam / 2 + 1.6 + 6.6, beam / 2 - sup - 0.4]) kit.box(0.12, 0.01, deckL - 4, VMAT.paint, C.yellow, x, deckY + 0.05, 0);
  rail(kit, [V(-beam / 2 + 0.15, deckY, -deckL / 2 + 0.5), V(-beam / 2 + 0.15, deckY, deckL / 2 - 0.5)], 1.1, { spacing: 2, colour: 0xe8e8e2, material: VMAT.paint, r: 0.03 });
  // Lounge along the starboard side, the control cabin above it (windows all round), mast, lifebuoys.
  const sx = beam / 2 - sup / 2 - 0.1;
  cabin(kit, { x: sx, z: 0, y: deckY, length: length * 0.52, width: sup, height: 2.6, rFront: 0.3, rBack: 0.3, colour: C.white, windows: [0.42, 0.85], roof: { overhang: 0.15, thickness: 0.12, colour: C.white } });
  rail(kit, [V(sx - sup / 2 + 0.1, deckY + 2.72, -length * 0.25), V(sx - sup / 2 + 0.1, deckY + 2.72, length * 0.25)], 1.0, { spacing: 1.6 });
  cabin(kit, { x: sx, z: 0, y: deckY + 2.72, length: 6, width: sup + 0.3, height: 2.1, rFront: 0.5, rBack: 0.5, colour: C.white, windows: [0.4, 0.92], front: [0.35, 0.94], roof: { overhang: 0.25, thickness: 0.12, colour: C.navy } });
  mast(kit, sx, deckY + 4.95, 0, 2.4, { radar: false });
  for (const z of [-8, 8]) lifebuoy(kit, beam / 2 - 0.08, deckY + 1.2, z, 1);
  // Cable sheaves at each end (she runs on two cables, F6).
  for (const e of [-1, 1]) for (const x of [-beam / 2 + 2.5, beam / 2 - sup - 1.0]) kit.box(0.9, 0.9, 1.4, VMAT.paint, C.navy, x, deckY + 0.3, e * (deckL / 2 - 0.4));
  // Cars in three lanes; people at the lounge windows and on the walkway.
  let k = 0;
  for (let lane = 0; lane < 3; lane++) for (let i = 0; i < 6; i++) {
    if ((lane * 7 + i * 3) % 5 === 4) continue;
    car(kit, -beam / 2 + 1.6 + 1.65 + lane * 3.3, deckY + 0.05, -deckL / 2 + 5 + i * 5.6, k++ * 3 + lane);
  }
  for (let i = 0; i < 3; i++) addPerson(kit, -beam / 2 + 0.7, deckY + 0.04, -6 + i * 5, -Math.PI / 2, 20 + i);
  g.add(kit.build('higher-ferry'));
  for (const end of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = end < 0 ? 'ramp-bow' : 'ramp-stern';
    pivot.position.set(-sup / 2, deckY, (end * deckL) / 2 + end * 0.3);
    const rk = new Kit();
    const w = beam - sup - 1.2;
    rk.box(w, 0.22, 4.6, VMAT.paint, 0x7a7e82, 0, 0, end * 2.3);
    for (const s of [-1, 1]) rk.box(0.2, 0.6, 4.6, VMAT.paint, C.navy, s * (w / 2 + 0.1), 0.2, end * 2.3);
    pivot.add(rk.build('ramp'));
    g.add(pivot);
  }
  navLights(g, { length: deckL, beam, mastY: deckY + 7.3, mastZ: 0, sideY: deckY + 4.8, ram: true });
  return g;
}

// ------------------------------------------------------------------ passenger vessels

/** The Dartmouth-Kingswear passenger ferry (Dartmouth Princess: 18 m, blue hull): saloon, open upper deck. */
function passengerFerry(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const h = hull(kit, {
    length, beam, freeboard: 1.15, draft: 1.1, sheerBow: 0.5, sheerStern: 0.2, stemRake: 1.2, entry: 0.4, transom: 0.72, transomRake: 0.15,
    flare: 0.1, bulwark: 0.85, colours: { bottom: C.antifouling, boot: C.white, topsides: C.blue, deck: C.wood, bulwarkInside: C.white },
    bootTop: 0.18,
  });
  const L = length;
  // Saloon amidships with big windows; the upper deck on its roof, railed, with benches and people.
  const sz = -0.07 * L;
  const sl = 0.5 * L;
  const sy = h.deck(sz);
  cabin(kit, { z: sz, y: sy, length: sl, width: beam - 1.1, height: 2.1, rFront: 1.3, rBack: 0.3, rake: 0.3, tumble: 0.08, colour: C.white, windows: [0.42, 0.88], front: [0.38, 0.9], roof: { overhang: 0.1, thickness: 0.1 } });
  const top = sy + 2.2;
  const rw = (beam - 1.1) / 2 - 0.1;
  rail(kit, [V(-rw, top, sz + sl / 2 - 0.2), V(-rw, top, sz - sl / 2 + 2.2), V(0, top, sz - sl / 2 + 0.5), V(rw, top, sz - sl / 2 + 2.2), V(rw, top, sz + sl / 2 - 0.2), V(-rw, top, sz + sl / 2 - 0.2)], 1.0, { spacing: 1.5 });
  // Small wheelhouse at the front of the upper deck.
  cabin(kit, { z: sz - sl / 2 + 2.6, y: top, length: 2.2, width: 2.3, height: 1.7, rFront: 0.6, rBack: 0.2, rake: 0.2, colour: C.white, windows: [0.45, 0.92], front: [0.4, 0.94], roof: { overhang: 0.12, thickness: 0.08, colour: C.blue } });
  mast(kit, 0, top + 1.8, sz - sl / 2 + 2.9, 1.8);
  for (let i = 0; i < 2; i++) bench(kit, (i ? 1 : -1) * 0.75, top, sz + 1.2, sl * 0.45, i ? -1 : 1, 3, seed + i * 5);
  // Aft deck: benches along the bulwarks, people; ensign.
  const az = sz + sl / 2 + (L / 2 - (sz + sl / 2)) / 2;
  const al = L / 2 - (sz + sl / 2) - 1.2;
  for (const s of [-1, 1]) bench(kit, s * (h.half(az) - 0.45), h.deck(az), az, al, -s, 3, seed + 10 + s);
  for (let i = 0; i < 2; i++) addPerson(kit, (i - 0.5) * 0.8, h.deck(az), az + 0.6, i * 0.6, seed + 30 + i);
  lifebuoy(kit, -(beam / 2 - 0.55), sy + 1.0, sz + sl / 2 - 0.3, -1);
  lifebuoy(kit, beam / 2 - 0.55, sy + 1.0, sz + sl / 2 - 0.3, 1);
  ensign(g, kit, 0, h.sheer(L / 2 - 0.3), L / 2 - 0.4);
  g.add(kit.build('passenger-ferry'));
  navLights(g, { length: L, beam, mastY: top + 3.5, mastZ: sz - sl / 2 + 2.9, sideY: top + 1.0 });
  g.add(wake(beam));
  return g;
}

/** A small open ferry launch (Castle Ferry, Noss): benches under a canopy, the helm standing aft. */
function launchModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const h = hull(kit, {
    length, beam, freeboard: 0.8, draft: 0.7, sheerBow: 0.3, sheerStern: 0.1, stemRake: 0.6, entry: 0.42, transom: 0.68,
    flare: 0.1, bulwark: 0.55, colours: { bottom: C.antifouling, boot: 0x2d6a4f, topsides: C.white, deck: C.teak, bulwarkInside: C.cream }, bootTop: 0.15,
  });
  const L = length;
  kit.tube(h.sheerLine(-1, 0, 0.02, 1), 0.05, VMAT.paint, C.teak);
  kit.tube(h.sheerLine(1, 0, 0.02, 1), 0.05, VMAT.paint, C.teak);
  // Canopy on posts over the benches.
  const cz0 = -L * 0.22;
  const cz1 = L * 0.3;
  const cy = h.deck(0) + 1.95;
  for (const s of [-1, 1]) for (const z of [cz0, (cz0 + cz1) / 2, cz1]) kit.rod(V(s * (h.half(z) - 0.25), h.sheer(z), z), V(s * (h.half(z) - 0.25), cy, z), 0.03, VMAT.steel);
  kit.box(beam - 0.3, 0.05, cz1 - cz0 + 0.4, VMAT.canvas, seed % 2 ? 0x1f3550 : 0x2d6a4f, 0, cy + 0.02, (cz0 + cz1) / 2);
  for (const s of [-1, 1]) bench(kit, s * (h.half((cz0 + cz1) / 2) - 0.5), h.deck(0), (cz0 + cz1) / 2, cz1 - cz0 - 0.4, -s, 2 + (seed % 2), seed + s * 3);
  // Helm console aft, the skipper standing.
  kit.box(0.6, 0.9, 0.5, VMAT.paint, C.cream, 0.5, h.deck(L * 0.38) + 0.45, L * 0.36);
  addPerson(kit, 0.5, h.deck(L * 0.4), L * 0.42, 0, seed + 7);
  ensign(g, kit, 0, h.sheer(L / 2 - 0.2), L / 2 - 0.3);
  g.add(kit.build('launch'));
  navLights(g, { length: L, beam, mastY: cy + 0.6, mastZ: cz0, sideY: cy - 0.4 });
  g.add(wake(beam));
  return g;
}

/** The river boats' hull navy: darker than the passenger ferry's, as the Cardiff Castle's photograph shows (P3). */
const CARDIFF_NAVY = 0x18212f;

/** A river ferry or cruise boat: the Totnes cruise as the Cardiff Castle (30 m, three decks); smaller ones shorter. */
function cruiserModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const big = length >= 20;
  const h = hull(kit, {
    length, beam, freeboard: big ? 1.4 : 1.0, draft: big ? 1.5 : 1.0, sheerBow: big ? 0.6 : 0.4, sheerStern: 0.2, stemRake: big ? 1.8 : 0.9, entry: 0.38, transom: 0.7,
    // Navy hull under white upperworks with a white band at the gunwale, as the owner's photographs of the river
    // boats show (the Cardiff Castle's, P3; E for any other boat).
    transomRake: 0.2, flare: 0.08, bulwark: 0.9, colours: { bottom: C.antifouling, boot: C.white, topsides: CARDIFF_NAVY, deck: C.wood, bulwarkInside: C.white, stripe: C.white },
    bootTop: 0.25, stripe: [0.3, 0],
  });
  const L = length;
  const mz = big ? -0.02 * L : -0.18 * L;
  const ml = big ? 0.64 * L : 0.36 * L;
  const my = h.deck(mz);
  const mw = beam - (big ? 0.9 : 1.2);
  cabin(kit, { z: mz, y: my, length: ml, width: mw, height: big ? 2.3 : 2.0, rFront: big ? 1.6 : 0.8, rBack: 0.4, rake: 0.3, tumble: 0.06, colour: C.white, windows: [0.35, 0.9], front: [0.32, 0.92], roof: { overhang: 0.12, thickness: 0.12 } });
  const top = my + (big ? 2.42 : 2.12);
  if (big) {
    // As the owner's photograph of the Cardiff Castle shows (P3): the upper deck behind a solid white bulwark
    // with passengers all along it; a raised wheelhouse forward; a tall white mast with a radar and flags; no
    // funnel. Sizes are estimates (E).
    const rw = mw / 2 - 0.1;
    const edge = [V(-rw, top, mz + ml / 2 - 0.2), V(-rw, top, mz - ml / 2 + 2.5), V(0, top, mz - ml / 2 + 0.6), V(rw, top, mz - ml / 2 + 2.5), V(rw, top, mz + ml / 2 - 0.2)];
    for (let k = 1; k < edge.length; k++) {
      const [p, q] = [edge[k - 1]!, edge[k]!];
      kit.add(new THREE.BoxGeometry(0.08, 0.95, p.distanceTo(q)), VMAT.paint, C.white, place((p.x + q.x) / 2, top + 0.47, (p.z + q.z) / 2, Math.atan2(q.x - p.x, q.z - p.z)));
    }
    kit.tube(edge.map((p) => V(p.x, top + 0.96, p.z)), 0.05, VMAT.paint, C.white);
    rail(kit, [edge[4]!, edge[0]!], 1.0, { spacing: 1.2 });
    const wz = mz - ml / 2 + 3.6;
    cabin(kit, { z: wz, y: top, length: 3.4, width: mw - 2.6, height: 2.3, rFront: 1.0, rBack: 0.3, rake: 0.3, colour: C.white, windows: [0.42, 0.9], front: [0.36, 0.93], roof: { overhang: 0.2, thickness: 0.1, colour: C.white } });
    const mastTop = top + 2.4 + 4.2;
    mast(kit, 0, top + 2.4, wz + 0.7, 4.2, { radar: true });
    // Flags from the yard (courtesy and house flags: colours E).
    for (const [x, col] of [[-0.42, 0x1d4d8a], [0.42, 0xc8102e]] as const) kit.box(0.02, 0.32, 0.5, VMAT.paint, col, x, top + 2.4 + 4.2 * 0.7 - 0.25, wz + 0.7 + 0.26);
    kit.box(0.02, 0.36, 0.6, VMAT.paint, C.white, 0, mastTop + 0.1, wz + 0.7 + 0.32);
    for (let i = 0; i < 2; i++) bench(kit, (i ? 1 : -1) * (rw - 0.55), top, mz + ml * 0.14, ml * 0.56, i ? -1 : 1, 5, seed + i * 9);
    for (let i = 0; i < 3; i++) addPerson(kit, -1 + i, top, mz + ml * 0.46, Math.PI, seed + 40 + i);
    for (let i = 0; i < 2; i++) addPerson(kit, -0.5 + i, top, wz + 2.6, 0, seed + 50 + i);
    // The white crest on each bow (P3), drawn as a plain shield (its device not drawn).
    const cz = -L / 2 + 0.13 * L;
    const slope = h.half(cz + 0.5) - h.half(cz - 0.5);
    const shield = new THREE.Shape();
    shield.moveTo(-0.5, 0.4);
    shield.lineTo(0.5, 0.4);
    shield.lineTo(0.5, 0);
    shield.quadraticCurveTo(0.45, -0.38, 0, -0.55);
    shield.quadraticCurveTo(-0.45, -0.38, -0.5, 0);
    shield.closePath();
    for (const sd of [-1, 1]) {
      const nrm = new THREE.Vector3(sd, 0, -slope).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, nrm), up, nrm);
      m.setPosition(V(sd * h.half(cz), h.sheer(cz) - 0.85, cz).addScaledVector(nrm, 0.04));
      kit.add(new THREE.ExtrudeGeometry(shield, { depth: 0.03, bevelEnabled: false, curveSegments: 6 }), VMAT.paint, C.white, m);
    }
  } else {
    // A wheelhouse-saloon forward, open well aft under a canopy.
    const az0 = mz + ml / 2 + 0.3;
    const az1 = L / 2 - 1;
    for (const s of [-1, 1]) for (const z of [az0, az1]) kit.rod(V(s * (h.half(z) - 0.3), h.sheer(z), z), V(s * (h.half(z) - 0.3), my + 2.05, z), 0.03, VMAT.steel);
    kit.box(beam - 0.5, 0.05, az1 - az0 + 0.4, VMAT.canvas, seed % 2 ? 0x2d6a4f : C.navy, 0, my + 2.07, (az0 + az1) / 2);
    for (const s of [-1, 1]) bench(kit, s * (h.half((az0 + az1) / 2) - 0.5), h.deck(az0), (az0 + az1) / 2, az1 - az0 - 0.3, -s, 3, seed + s * 4);
    mast(kit, 0, top, mz - ml * 0.1, 1.6);
  }
  for (const s of [-1, 1]) lifebuoy(kit, s * (mw / 2 + 0.02), my + 1.2, mz + ml * 0.3, s);
  ensign(g, kit, 0, h.sheer(L / 2 - 0.3), L / 2 - 0.4);
  g.add(kit.build(big ? 'river-cruiser' : 'river-ferry'));
  navLights(g, { length: L, beam, mastY: big ? top + 6.2 : top + 1.8, mastZ: big ? mz - ml / 2 + 4.3 : mz - ml * 0.1, sideY: top + 0.8 });
  g.add(wake(beam));
  return g;
}

// ------------------------------------------------------------------ the Hindostan (moored)

/**
 * The Hindostan: Britannia Royal Naval College's static training ship off Sandquay, the former Sandown-class
 * minehunter HMS Cromer (M103), 52.5 m by 10.5 m, renamed for the role (Wikipedia, via search). Drawn as a
 * Sandown in naval grey: a high, flared bow, the long deckhouse with the bridge forward and a pole mast with a
 * radar, a low funnel aft of it, the open quarterdeck with its crane, guard rails and an ensign. Bow along -z,
 * floating at y = 0. Proportions and details are estimates (E): no photograph or drawing of her was viewed.
 */
export function minehunterModel(length = 52.5, beam = 10.5): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hindostan';
  const kit = new Kit();
  const GREY = 0x8d9499;
  const DARK = 0x4f5458;
  const h = hull(kit, {
    length, beam, freeboard: 2.6, draft: 2.3, sheerBow: 1.4, sheerStern: 0.2, stemRake: 2.4, entry: 0.4, transom: 0.85, transomRake: -0.2,
    flare: 0.08, bulwark: 0.25, colours: { bottom: C.antifouling, boot: C.black, topsides: GREY, deck: DARK, bulwarkInside: GREY }, bootTop: 0.35,
  });
  const L = length;
  // The deckhouse: from abaft the forecastle to the quarterdeck, the bridge on top forward with its windows.
  const dz = -L * 0.06;
  const dl = L * 0.5;
  const dy = h.deck(dz);
  cabin(kit, { z: dz, y: dy, length: dl, width: beam - 2.2, height: 2.6, rFront: 1.2, rBack: 0.4, colour: GREY, windows: [0.55, 0.75], roof: { overhang: 0.1, thickness: 0.12, colour: DARK } });
  const bz = dz - dl * 0.3;
  cabin(kit, { z: bz, y: dy + 2.72, length: L * 0.14, width: beam - 3.6, height: 2.3, rFront: 1.4, rBack: 0.3, rake: 0.35, colour: GREY, windows: [0.45, 0.85], front: [0.4, 0.9], roof: { overhang: 0.25, thickness: 0.12, colour: DARK } });
  // Pole mast with yards and a radar, and the low funnel aft of it.
  mast(kit, 0, dy + 5.1, bz + L * 0.09, 9, { radar: true, colour: GREY });
  kit.box(5, 0.1, 0.1, VMAT.paint, GREY, 0, dy + 11.5, bz + L * 0.09);
  kit.add(new THREE.CylinderGeometry(0.9, 1.1, 2.4, 14), VMAT.paint, GREY, place(0, dy + 3.8, dz + dl * 0.22));
  kit.add(new THREE.CylinderGeometry(0.92, 0.92, 0.4, 14), VMAT.paint, C.black, place(0, dy + 5.2, dz + dl * 0.22));
  // The gun on the forecastle, the quarterdeck's crane, guard rails round the decks.
  const gz = -L * 0.36;
  kit.add(new THREE.CylinderGeometry(0.7, 0.8, 0.9, 12), VMAT.paint, GREY, place(0, h.deck(gz) + 0.45, gz));
  kit.rod(V(0, h.deck(gz) + 0.9, gz), V(0, h.deck(gz) + 1.05, gz - 2.4), 0.07, VMAT.paint, DARK);
  const qz = L * 0.38;
  kit.rod(V(1.5, h.deck(qz), qz), V(1.5, h.deck(qz) + 3.2, qz), 0.18, VMAT.paint, 0xd7a021);
  kit.rod(V(1.5, h.deck(qz) + 3.2, qz), V(-1.5, h.deck(qz) + 4.2, qz + 3), 0.12, VMAT.paint, 0xd7a021);
  for (const sd of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const z = -L * 0.42 + (k / 12) * L * 0.9;
      pts.push(V(sd * (h.half(z) - 0.15), h.deck(z), z));
    }
    rail(kit, pts, 1.0, { spacing: 2, colour: GREY });
  }
  ensign(g, kit, 0, h.sheer(L / 2 - 0.3), L / 2 - 0.4);
  g.add(kit.build('hindostan'));
  return g;
}

/**
 * A moored ship drawn on her mapped outline (OSM maps the Hindostan as a building): the middle of the outline
 * along its long axis, the heading towards the narrower end (the bow; the area's centroid lies towards the
 * wider stern), and the outline's length and beam.
 */
export function shipOnFootprint(ring: readonly (readonly [number, number])[]): { e: number; n: number; heading: number; length: number; beam: number } {
  const th = (longAxisDeg(ring) * Math.PI) / 180;
  const u = [Math.sin(th), Math.cos(th)] as const;
  const along = ring.map(([e, n]) => e * u[0] + n * u[1]);
  const across = ring.map(([e, n]) => e * u[1] - n * u[0]);
  const [a0, a1] = [Math.min(...along), Math.max(...along)];
  const [c0, c1] = [Math.min(...across), Math.max(...across)];
  // The area's centroid along the axis (shoelace).
  let A = 0;
  let ca = 0;
  for (let k = 0; k < ring.length; k++) {
    const [p, q] = [ring[k]!, ring[(k + 1) % ring.length]!];
    const cr = p[0] * q[1] - q[0] * p[1];
    A += cr;
    ca += cr * ((p[0] + q[0]) * u[0] + (p[1] + q[1]) * u[1]);
  }
  const centroid = A !== 0 ? ca / (3 * A) : (a0 + a1) / 2;
  const sign = centroid < (a0 + a1) / 2 ? 1 : -1;
  const am = (a0 + a1) / 2;
  const cm = (c0 + c1) / 2;
  return {
    e: am * u[0] + cm * u[1],
    n: am * u[1] - cm * u[0],
    heading: Math.atan2(sign * u[0], sign * u[1]),
    length: a1 - a0,
    beam: c1 - c0,
  };
}

// ------------------------------------------------------------------ the paddle steamer

/** Where the steamer's funnel top is in the model's frame (for her smoke). */
export const STEAMER_FUNNEL_TOP = new THREE.Vector3(0, 8.6, -2.3);

/**
 * The paddle steamer Kingswear Castle (1924): 34.7 m long, 5.3 m in the hull and 8.5 m over the paddle boxes,
 * paddle wheels 3 m across (F16). Drawn as the owner's photograph of her shows: a black hull with a gold line,
 * varnished saloons with white rails, a tall raked buff funnel with a black top just ahead of the paddle shaft,
 * a varnished mast forward; the paddle boxes amidships with the bridge across them, an open promenade deck with
 * passengers. The paddle boxes' colour and the layout's proportions are estimates (E).
 */
function paddleSteamerModel(length: number, beamOver: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const hb = Math.min(5.3, beamOver * 0.62);
  const h = hull(kit, {
    length, beam: hb, freeboard: 1.25, draft: 1.2, sheerBow: 0.75, sheerStern: 0.35, stemRake: 0.35, entry: 0.42, transom: 0.6, transomRake: 0.3, flare: 0.04, bulwark: 0.85,
    colours: { bottom: C.antifouling, boot: C.black, topsides: C.black, deck: C.wood, bulwarkInside: C.white, stripe: 0xd8b04a },
    bootTop: 0.2, stripe: [0.12, 0.05],
  });
  const L = length;
  const deck = h.deck(0);
  const white = C.white;
  // Paddle boxes: half-discs (radius 1.9) outboard of the hull either side, amidships, white with a gold rim and
  // dark vents; sponsons at deck level fore and aft of each.
  const R = 1.9;
  const axle = 0.75;
  const outer = beamOver / 2;
  const boxW = outer - hb / 2 + 0.1;
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-R, 0);
    shape.absarc(0, 0, R, Math.PI, 0, true);
    shape.lineTo(-R, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: boxW, bevelEnabled: false, curveSegments: 20 });
    geo.rotateY(Math.PI / 2);
    // After the turn the extrusion runs along +x from 0 to boxW; shift it to its side.
    const x0 = side > 0 ? hb / 2 - 0.1 : -outer;
    kit.add(geo, VMAT.paint, white, place(x0, axle, 0));
    const xo = side * (outer + 0.01);
    const arc: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI - (k / 16) * Math.PI;
      arc.push(V(xo, axle + Math.sin(a) * R, Math.cos(a) * R));
    }
    kit.tube(arc, 0.06, VMAT.paint, 0xd8b04a);
    for (let k = 1; k <= 5; k++) {
      const a = (k / 6) * Math.PI;
      kit.rod(V(xo, axle + Math.sin(a) * 0.5, Math.cos(a) * 0.5), V(xo, axle + Math.sin(a) * (R - 0.25), Math.cos(a) * (R - 0.25)), 0.07, VMAT.paint, 0x2a2c2f, 6);
    }
    // Sponsons fore and aft of the box, with a rail.
    for (const z of [-R - 1.2, R + 1.2]) kit.box(boxW, 0.12, 2.4, VMAT.paint, C.wood, side * (hb / 2 + boxW / 2 - 0.1), deck, z);
    rail(kit, [V(side * (outer - 0.05), deck, -R - 2.4), V(side * (outer - 0.05), deck, R + 2.4)], 1.0, { spacing: 1.2, colour: white });
  }
  // The bridge across the paddle boxes: an open platform with rails, the wheel and a helmsman.
  const by = axle + R + 0.08;
  kit.box(beamOver, 0.12, 1.4, VMAT.paint, C.wood, 0, by, 0.1);
  rail(kit, [V(-outer, by, -0.6), V(outer, by, -0.6), V(outer, by, 0.8), V(-outer, by, 0.8), V(-outer, by, -0.6)], 1.0, { spacing: 1.0, colour: white });
  kit.add(new THREE.TorusGeometry(0.45, 0.04, 6, 16), VMAT.paint, C.wood, place(0, by + 1.0, 0.1, 0, 0, 0));
  addPerson(kit, 0, by + 0.06, 0.55, 0, seed + 3);
  // Saloons forward and aft of the boxes in varnished wood with windows (the owner's photograph of her), the
  // promenade deck on their roofs.
  const fz = -L * 0.2;
  const fl = L * 0.26;
  const az = L * 0.19;
  const al = L * 0.24;
  for (const [z, l] of [[fz, fl], [az, al]] as const) cabin(kit, { z, y: deck, length: l, width: hb - 0.9, height: 2.1, rFront: 0.4, rBack: 0.4, colour: 0x7d4f2c, windows: [0.38, 0.88], roof: { overhang: 0.2, thickness: 0.1, colour: white } });
  const top = deck + 2.2;
  for (const [z, l] of [[fz, fl], [az, al]] as const) {
    const w = (hb - 0.9) / 2;
    rail(kit, [V(-w, top, z - l / 2), V(w, top, z - l / 2), V(w, top, z + l / 2), V(-w, top, z + l / 2), V(-w, top, z - l / 2)], 1.0, { spacing: 1.3, colour: white });
    for (const s of [-1, 1]) bench(kit, s * (w - 0.5), top, z, l - 1.2, -s, 3 + ((seed + z) % 2 ? 1 : 0), seed + Math.round(z) * 3 + s);
  }
  // The funnel: buff with a black top, raked aft, just ahead of the paddle shaft; a steam pipe beside it.
  const fy0 = deck + 0.3;
  const top2 = STEAMER_FUNNEL_TOP;
  const rake = (6 * Math.PI) / 180;
  const fh = top2.y - fy0;
  const fzc = top2.z - Math.tan(rake) * (fh / 2);
  kit.add(new THREE.CylinderGeometry(0.58, 0.62, fh - 0.9, 18), VMAT.paint, 0xd2ae62, place(0, fy0 + (fh - 0.9) / 2, fzc + 0.05, 0, -rake));
  kit.add(new THREE.CylinderGeometry(0.58, 0.58, 0.9, 18), VMAT.paint, C.black, place(0, top2.y - 0.45, top2.z + 0.04, 0, -rake));
  kit.rod(V(0.7, deck + 0.3, fzc + 0.4), V(0.7, top2.y - 0.6, top2.z + 0.45), 0.07, VMAT.steel);
  // The mast forward with a yard, and lifebuoys.
  mast(kit, 0, top, fz - fl * 0.25, 6.5);
  kit.box(3.2, 0.08, 0.08, VMAT.paint, white, 0, top + 4.6, fz - fl * 0.25);
  for (const s of [-1, 1]) lifebuoy(kit, s * (hb / 2 - 0.42), deck + 1.3, fz + fl * 0.3, s);
  // A few people on the open decks forward and aft.
  for (let i = 0; i < 4; i++) addPerson(kit, -1.2 + i * 0.8, h.deck(-L * 0.42), -L * 0.4 + (i % 2) * 0.6, Math.PI, seed + 20 + i);
  for (let i = 0; i < 3; i++) addPerson(kit, -0.9 + i * 0.9, h.deck(L * 0.42), L * 0.4, 0, seed + 30 + i);
  ensign(g, kit, 0, h.sheer(L / 2 - 0.3), L / 2 - 0.4);
  g.add(kit.build('paddle-steamer'));
  navLights(g, { length: L, beam: beamOver, mastY: top + 6.3, mastZ: fz - fl * 0.25, sideY: by + 0.6 });
  g.add(wake(beamOver));
  return g;
}

// ------------------------------------------------------------------ Dart Marina boats

/** A planing motor cruiser: deep-vee hull, raked superstructure, radar arch, bow rail, bathing platform. */
function motorCruiser(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const hullColour = seed % 4 === 1 ? 0x2b3a4a : C.white;
  const h = hull(kit, {
    length, beam, freeboard: 1.35, draft: 0.75, sheerBow: 0.3, sheerStern: -0.05, stemRake: 1.3, entry: 0.42, transom: 0.95, transomRake: 0.25,
    deadrise: 0.33, chine: true, flare: 0.14, colours: { bottom: 0x1f2a36, boot: 0x2b2e33, topsides: hullColour, deck: 0xf4f3ef, stripe: 0x2b2e33 },
    bootTop: 0.1, stripe: [0.75, 0.55],
  }, VMAT.gloss);
  const L = length;
  const cz = -0.04 * L;
  const cl = 0.44 * L;
  const cy = h.deck(cz);
  cabin(kit, { z: cz, y: cy, length: cl, width: beam - 0.7, height: 1.15, rFront: 1.1, rBack: 0.2, rake: 1.0, tumble: 0.22, colour: C.white, windows: [0.22, 0.9], front: [0.12, 0.96], noBackWindows: true, roof: { overhang: 0.06, thickness: 0.06 }, material: VMAT.gloss });
  // Radar arch over the cockpit, bow rail, bathing platform, cockpit seating; people aboard.
  const az = cz + cl / 2 + 0.6;
  const aw = h.half(az) - 0.2;
  kit.tube([V(-aw, h.deck(az), az + 0.4), V(-aw * 0.8, cy + 1.6, az), V(aw * 0.8, cy + 1.6, az), V(aw, h.deck(az), az + 0.4)], 0.07, VMAT.gloss, C.white);
  kit.add(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), VMAT.paint, C.white, place(0, cy + 1.66, az));
  rail(kit, h.sheerLine(-1, 0.12, 0.03, 0.4).reverse().concat(h.sheerLine(1, 0.12, 0.03, 0.4)).map((p) => p.setY(h.deck(p.z))), 0.6, { spacing: 1.2, mid: false });
  kit.box(beam * 0.8, 0.08, 0.9, VMAT.paint, C.teak, 0, 0.35, L / 2 + 0.45);
  kit.box(beam - 0.9, 0.42, 0.55, VMAT.paint, 0xe9e1cf, 0, h.deck(L * 0.38) + 0.21, L * 0.38);
  addPerson(kit, -0.4, h.deck(L * 0.3), L * 0.3, Math.PI / 2, seed + 1, true);
  if (seed % 2) addPerson(kit, 0.5, h.deck(L * 0.25), L * 0.25, 0.4, seed + 2);
  g.add(kit.build('motor-cruiser'));
  navLights(g, { length: L, beam, mastY: cy + 1.9, mastZ: az, sideY: cy + 0.6 });
  g.add(wake(beam));
  return g;
}

/** A sloop under engine: low coachroof, sprayhood, mast with furled genoa and sail cover, guard rails. */
function yachtModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const navy = seed % 3 === 0;
  const h = hull(kit, {
    length, beam, freeboard: 1.0, draft: 0.5, sheerBow: 0.18, stemRake: 0.35, entry: 0.45, transom: 0.85, transomRake: -0.35, flare: 0.06,
    deadrise: 0.35, colours: { bottom: 0x1f2a36, boot: navy ? C.white : C.navy, topsides: navy ? C.navy : C.white, deck: 0xe9e6dc },
  }, VMAT.gloss);
  const L = length;
  kit.tube(h.sheerLine(-1, 0.03, 0.02, 1), 0.035, VMAT.paint, C.teak);
  kit.tube(h.sheerLine(1, 0.03, 0.02, 1), 0.035, VMAT.paint, C.teak);
  const cz = -0.06 * L;
  const cl = 0.4 * L;
  const cy = h.deck(cz) - 0.03;
  cabin(kit, { z: cz, y: cy, length: cl, width: beam - 1.1, height: 0.55, rFront: 0.9, rBack: 0.15, rake: 0.3, tumble: 0.15, colour: C.white, windows: [0.35, 0.72], noBackWindows: true, roof: { overhang: 0.03, thickness: 0.05 }, material: VMAT.gloss });
  // Sprayhood over the companionway.
  const sprayZ = cz + cl / 2 - 0.15;
  const hood = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, -Math.PI / 2, Math.PI);
  hood.scale((beam - 1.4) / 2, 1, 0.75);
  kit.add(hood, VMAT.canvas, 0x2b3a4a, place(0, cy + 0.55, sprayZ, 0, Math.PI / 2));
  // Rig: mast (keel-stepped) through the coachroof, spreaders, forestay, backstay, shrouds; boom with cover.
  const mz = cz - cl * 0.12;
  const top = 13.5;
  kit.add(new THREE.CylinderGeometry(0.07, 0.09, top - cy, 10), VMAT.paint, 0xc8ccd0, place(0, (top + cy) / 2, mz));
  const stem = V(0, h.sheer(-L / 2 + 0.2) + 0.05, -L / 2 + 0.25);
  const head = V(0, top - 0.3, mz);
  kit.rod(stem, head, 0.008, VMAT.steel);
  kit.rod(V(0, h.sheer(L / 2) + 0.05, L / 2 - 0.1), V(0, top, mz + 0.05), 0.007, VMAT.steel);
  for (const s of [-1, 1]) {
    const tip = V(s * 0.85, top * 0.55, mz + 0.15);
    kit.rod(V(0, top * 0.55, mz), tip, 0.02, VMAT.paint, 0xc8ccd0);
    const plate = V(s * (h.half(mz) - 0.08), h.sheer(mz), mz + 0.2);
    kit.rod(plate, tip, 0.006, VMAT.steel);
    kit.rod(tip, V(0, top - 0.4, mz), 0.006, VMAT.steel);
  }
  // Furled genoa round the forestay (blue sacrificial strip), the main under its cover on the boom.
  const fl = stem.distanceTo(head);
  const furl = new THREE.CylinderGeometry(0.02, 0.075, fl * 0.92, 10);
  kit.add(furl, VMAT.canvas, 0xe8e6de, new THREE.Matrix4().compose(stem.clone().lerp(head, 0.48), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), head.clone().sub(stem).normalize()), V(1, 1, 1)));
  const boomY = cy + 1.15;
  kit.add(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 8), VMAT.paint, 0xc8ccd0, place(0, boomY, mz + 2.1, 0, Math.PI / 2));
  kit.add(new THREE.CapsuleGeometry(0.22, 3.6, 4, 10).scale(0.9, 1, 1.2), VMAT.canvas, 0x24476e, place(0, boomY + 0.25, mz + 2.0, 0, Math.PI / 2));
  // Pulpit, pushpit and guard wires on stanchions; wheel and helm; ensign.
  const gw = (side: number) => h.sheerLine(side, 0.1, 0.05, 0.97).map((p) => p.setY(p.y + 0.02));
  for (const s of [-1, 1]) rail(kit, gw(s), 0.62, { spacing: 1.8, r: 0.014 });
  const wz = L * 0.33;
  kit.add(new THREE.TorusGeometry(0.42, 0.025, 6, 20), VMAT.steel, undefined, place(0, h.deck(wz) + 0.75, wz));
  addPerson(kit, 0, h.deck(wz), wz + 0.55, 0, seed + 3);
  if (seed % 2) addPerson(kit, 0.6, h.deck(wz - 1), wz - 0.9, Math.PI / 2, seed + 4, true);
  ensign(g, kit, 0.3, h.sheer(L / 2 - 0.3), L / 2 - 0.3);
  g.add(kit.build('yacht'));
  navLights(g, { length: L, beam, mastY: top, mastZ: mz, sideY: h.sheer(-L * 0.4) + 0.3 });
  g.add(wake(beam));
  return g;
}

/** A RIB: deep-vee hull, buoyancy tubes round the sides and bow, centre console, A-frame, outboard. */
function ribModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const h = hull(kit, {
    length, beam: beam - 0.5, freeboard: 0.45, draft: 0.45, sheerBow: 0.25, stemRake: 0.4, entry: 0.4, transom: 0.92, deadrise: 0.38, chine: true, flare: 0.1,
    colours: { bottom: C.white, boot: C.white, topsides: C.white, deck: 0x8f9396 },
  }, VMAT.gloss);
  const L = length;
  const tubeColour = seed % 3 === 0 ? 0xe8541c : 0x3d4246;
  const ring = [...h.sheerLine(-1, -0.2, 0, 0.97).reverse(), ...h.sheerLine(1, -0.2, 0, 0.97)].map((p) => p.setY(p.y + 0.05));
  kit.tube(ring, 0.27, VMAT.paint, tubeColour);
  // Console with windscreen, jockey seat behind, A-frame with the light, outboard.
  const cz = L * 0.05;
  kit.box(0.75, 0.95, 0.65, VMAT.gloss, C.white, 0, h.deck(cz) + 0.48, cz);
  kit.add(new THREE.BoxGeometry(0.8, 0.4, 0.04), VMAT.glass, undefined, place(0, h.deck(cz) + 1.1, cz - 0.3, 0, -0.5));
  kit.box(0.5, 0.7, 0.6, VMAT.paint, 0x2b2e33, 0, h.deck(cz + 1) + 0.35, cz + 1.0);
  const fz = L / 2 - 0.35;
  for (const s of [-1, 1]) kit.rod(V(s * 0.7, h.deck(fz), fz), V(s * 0.45, h.deck(fz) + 1.6, fz - 0.2), 0.03, VMAT.steel);
  kit.rod(V(-0.45, h.deck(fz) + 1.6, fz - 0.2), V(0.45, h.deck(fz) + 1.6, fz - 0.2), 0.03, VMAT.steel);
  outboard(kit, 0, h.sheer(L / 2) - 0.1, L / 2 - 0.05);
  addPerson(kit, 0, h.deck(cz + 0.6), cz + 0.55, 0, seed + 5);
  if (seed % 2) addPerson(kit, 0, h.deck(cz + 1.1), cz + 1.2, 0, seed + 6);
  g.add(kit.build('rib'));
  navLights(g, { length: L, beam, mastY: h.deck(fz) + 1.7, mastZ: fz - 0.2, sideY: h.deck(cz) + 0.9 });
  g.add(wake(beam));
  return g;
}

function leisureModel(kind: VesselKind, length: number, beam: number, seed: number): THREE.Group {
  if (kind === 'rib') return ribModel(length, beam, seed);
  if (kind === 'yacht') return yachtModel(length, beam, seed);
  return motorCruiser(length, beam, seed);
}


function makeModel(kind: VesselKind, length: number, beam: number, seed: number): THREE.Group {
  switch (kind) {
    case 'tug-float':
      return floatModel(length, beam, seed);
    case 'floating-bridge':
      return bridgeModel(length, beam);
    case 'passenger-ferry':
      return passengerFerry(length, beam, seed);
    case 'launch':
      return launchModel(length, beam, seed);
    case 'river-cruiser':
      return cruiserModel(length, beam, seed);
    case 'paddle-steamer':
      return paddleSteamerModel(length, beam, seed);
    default:
      return leisureModel(kind, length, beam, seed);
  }
}

/** Liveries, cars and passengers vary over this many versions of each vessel. */
const MODEL_VARIANTS = 12;
const models = new Map<string, THREE.Group>();
/**
 * A vessel's model, built once and then copied (the copies share geometry and materials, so a boat leaving
 * the marina costs no rebuild); each copy has its own wake material, whose opacity follows its speed.
 */
function instance(key: string, make: () => THREE.Group): THREE.Group {
  let m = models.get(key);
  if (!m) models.set(key, (m = make()));
  const copy = m.clone();
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === 'wake') o.material = (o.material as THREE.Material).clone();
  });
  return copy;
}

interface Entry {
  root: THREE.Group;
  body: THREE.Group;
  tug?: THREE.Group;
  label?: THREE.Sprite;
  ramps: THREE.Object3D[];
  ensigns: THREE.Object3D[];
  wakes: THREE.Mesh[];
  lights: THREE.Mesh[];
  seen: number;
}

const LABEL_RANGE_M = 900;

export class TrafficView {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private day = 1;
  /** The paddle steamer's coal smoke. */
  private readonly smoke = new Exhaust();
  private lastTime?: number;

  constructor() {
    this.group.name = 'traffic';
    this.group.add(this.smoke.group);
  }

  private build(s: VesselState): Entry {
    const root = new THREE.Group();
    root.name = `vessel-${s.kind}`;
    const seed = [...s.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const body = instance(`${s.kind}:${s.length}:${s.beam}:${seed % MODEL_VARIANTS}`, () => makeModel(s.kind, s.length, s.beam, seed % MODEL_VARIANTS));
    root.add(body);
    let tug: THREE.Group | undefined;
    if (s.kind === 'tug-float') {
      tug = instance('tug', tugModel);
      this.group.add(tug);
    }
    let label: THREE.Sprite | undefined;
    if (s.kind === 'tug-float' || s.kind === 'floating-bridge' || s.kind === 'passenger-ferry' || s.kind === 'river-cruiser' || s.kind === 'paddle-steamer' || s.kind === 'launch') {
      label = makeLabel(`${s.label}${s.ram ? ' · RAM' : ''}`, s.ram ? '#ffd28a' : '#ffffff');
      label.position.y = 7;
      label.userData.priority = 2;
      root.add(label);
    }
    const ramps: THREE.Object3D[] = [];
    const ensigns: THREE.Object3D[] = [];
    const wakes: THREE.Mesh[] = [];
    const lights: THREE.Mesh[] = [];
    for (const g of [root, ...(tug ? [tug] : [])]) {
      g.traverse((o) => {
        if (o.name.startsWith('ramp-')) ramps.push(o);
        if (o.name === 'ensign') ensigns.push(o);
        if (o.name === 'wake') wakes.push(o as THREE.Mesh);
        if (o.parent?.name === 'lights') lights.push(o as THREE.Mesh);
        if (o instanceof THREE.Mesh && o.name !== 'wake') {
          o.castShadow = o.receiveShadow = true;
        }
      });
    }
    this.group.add(root);
    return { root, body, tug, label, ramps, ensigns, wakes, lights, seen: 0 };
  }

  /** Daylight 0 (night) … 1 (day): navigation lights come on at dusk. */
  setDaylight(day: number): void {
    this.day = day;
  }

  /** The labels, for decluttering with the place labels. */
  labels(): THREE.Sprite[] {
    return [...this.entries.values()].flatMap((e) => (e.label ? [e.label] : []));
  }

  /** `wind`: where the true wind comes from (rad, compass) and its speed (m/s), for the ensigns; else they fly aft. */
  update(states: VesselState[], time: number, camera: THREE.Camera, showLabels: boolean, wind?: { fromDir: number; speed: number }): void {
    const stamp = time;
    const lit = this.day < 0.35;
    setLightsOn(lit);
    for (const s of states) {
      let e = this.entries.get(s.id);
      if (!e) {
        e = this.build(s);
        this.entries.set(s.id, e);
      }
      e.seen = stamp;
      e.root.visible = true;
      const bob = 0.04 * Math.sin(time * 1.3 + s.e * 0.1);
      e.root.position.set(s.e, bob, -s.n);
      e.root.rotation.set(0.01 * Math.sin(time * 0.9 + s.n), -s.heading, 0.012 * Math.sin(time * 1.1 + s.e));
      for (const r of e.ramps) {
        // Down onto the slip (tilted below the deck) when loading; raised for the crossing.
        const end = r.name === 'ramp-bow' ? -1 : 1;
        r.rotation.x = end * (0.32 * (s.ramp ?? 1) - 0.12);
      }
      if (wind) {
        const { yaw, aws } = flagYaw(wind.fromDir, wind.speed, s.heading, s.sog);
        // A flutter that quickens with the wind (E).
        const flutter = Math.min(0.12, 0.02 * aws) * Math.sin(time * (2 + aws) + s.e);
        for (const f of e.ensigns) {
          f.rotation.y = yaw + flutter;
          f.children[0]!.rotation.z = -flagDroop(aws);
        }
      }
      // Unlit, the lamps are not drawn at all (small housings, not dark balls in the air).
      for (const l of e.lights) l.visible = lit;
      for (const w of e.wakes) (w.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, Math.max(0, (s.sog - 0.3) / 3));
      if (e.tug && s.tug) {
        e.tug.visible = true;
        e.tug.position.set(s.tug.e, bob, -s.tug.n);
        e.tug.rotation.set(0, -s.tug.heading, 0.015 * Math.sin(time * 1.4));
      }
      if (e.label) e.label.visible = showLabels && e.root.position.distanceTo(camera.position) < LABEL_RANGE_M;
    }
    // The paddle steamer smokes from her funnel: thickly under way, a wisp alongside; it drifts downwind.
    const dt = this.lastTime === undefined ? 0 : Math.min(0.25, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const steamer = states.find((s) => s.kind === 'paddle-steamer');
    const se = steamer ? this.entries.get(steamer.id) : undefined;
    let funnel: THREE.Vector3 | undefined;
    if (se) {
      se.root.updateMatrix();
      funnel = STEAMER_FUNNEL_TOP.clone().applyMatrix4(se.root.matrix);
    }
    const drift = wind ? new THREE.Vector3(-Math.sin(wind.fromDir) * wind.speed * 0.25, 0, Math.cos(wind.fromDir) * wind.speed * 0.25) : new THREE.Vector3();
    this.smoke.update(dt, funnel, steamer?.moving ? 3 : 0.6, true, drift);
    for (const [id, e] of this.entries) {
      if (e.seen === stamp) continue;
      // Gone (a marina boat that has arrived, a seasonal ferry off service): remove it.
      this.group.remove(e.root);
      if (e.tug) this.group.remove(e.tug);
      this.entries.delete(id);
    }
  }
}
