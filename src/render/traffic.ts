import * as THREE from 'three';
import type { VesselKind, VesselState } from '../sim/env/traffic';
import { makeLabel } from './labels';

/**
 * River traffic as 3D vessels (positions and manoeuvres from src/sim/env/traffic.ts). The Lower Ferry is its
 * float - car deck, rails, hinged ramps at both ends, cars - with the tug lashed alongside, which the model
 * moves on its own (it swings end for end at each slip). The Higher Ferry is a floating bridge on its guide
 * cables. The other ferries and the boats coming in and out of Dart Marina are drawn by type. Shapes, colours
 * and liveries are illustrative (E): no measured drawings or photographs were available here.
 * Model frame: x = starboard, y = up (0 = waterline), z = aft (bow towards -z), as the Squib's.
 */

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
const std = (hex: number, rough = 0.6, metal = 0) => mat(`s${hex}-${rough}-${metal}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.15, metalness: 0.4 }));
const lamp = (hex: number) => mat(`lamp${hex}`, () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: hex, emissiveIntensity: 0 }));

function box(w: number, h: number, l: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  b.position.set(x, y, z);
  return b;
}

/**
 * A hull: plan outline with a pointed (or blunt) bow, extruded from the keel line to the sheer with a rounded
 * edge. bow = fraction of the length that tapers.
 */
function hull(length: number, beam: number, depth: number, bow: number, m: THREE.Material, blunt = 0.25): THREE.Mesh {
  const s = new THREE.Shape();
  const L = length / 2;
  const B = beam / 2;
  const taper = length * bow;
  s.moveTo(-B, L);
  s.lineTo(B, L);
  s.lineTo(B, -L + taper);
  s.quadraticCurveTo(B * 0.95, -L + taper * 0.15, B * blunt, -L);
  s.lineTo(-B * blunt, -L);
  s.quadraticCurveTo(-B * 0.95, -L + taper * 0.15, -B, -L + taper);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: Math.min(0.25, depth * 0.2), bevelSize: Math.min(0.2, beam * 0.04), bevelSegments: 2, steps: 1 });
  geo.rotateX(Math.PI / 2);
  // Freeboard about 0.6 of the depth.
  geo.translate(0, depth * 0.6, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'hull';
  return mesh;
}

/** Railings along a run: posts and two rails (thin boxes). */
function railing(from: THREE.Vector3, to: THREE.Vector3, height: number, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const len = from.distanceTo(to);
  const dir = to.clone().sub(from).normalize();
  const posts = Math.max(2, Math.round(len / 1.8));
  for (let i = 0; i <= posts; i++) {
    const p = from.clone().addScaledVector(dir, (len * i) / posts);
    g.add(box(0.05, height, 0.05, m, p.x, p.y + height / 2, p.z));
  }
  for (const h of [height, height * 0.5]) {
    const r = box(0.04, 0.04, len, m);
    r.position.copy(from).add(to).multiplyScalar(0.5);
    r.position.y += h;
    r.lookAt(r.position.clone().add(dir));
    g.add(r);
  }
  return g;
}

/** A car on deck: body and cabin, in one of a few common colours. */
function car(seed: number): THREE.Group {
  const colours = [0xd9d9d9, 0x1c1c1c, 0x8a8f96, 0x2a4f8a, 0x9b1c1c, 0xf2f2f2, 0x3b5d3b, 0x5a5f66];
  const g = new THREE.Group();
  g.add(box(1.8, 0.7, 4.3, std(colours[seed % colours.length]!, 0.35, 0.3), 0, 0.55, 0));
  g.add(box(1.6, 0.55, 2.2, glass(), 0, 1.15, 0.2));
  return g;
}

/** Navigation lights (red port, green starboard, white masthead and stern): lit at dusk. */
function navLights(length: number, beam: number, mastY: number, ram: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lights';
  const s = new THREE.SphereGeometry(0.12, 8, 6);
  const add = (hex: number, x: number, y: number, z: number) => {
    const l = new THREE.Mesh(s, lamp(hex));
    l.position.set(x, y, z);
    g.add(l);
  };
  add(0xff2020, -beam / 2 + 0.2, mastY * 0.5, -length * 0.2);
  add(0x20ff40, beam / 2 - 0.2, mastY * 0.5, -length * 0.2);
  add(0xffffff, 0, mastY, -length * 0.1);
  add(0xffffff, 0, mastY * 0.4, length / 2 - 0.2);
  // Restricted in her ability to manoeuvre: red, white, red all-round lights in a vertical line.
  if (ram) for (const [i, hex] of [0xff2020, 0xffffff, 0xff2020].entries()) add(hex, 0.2, mastY + 0.6 + i * 0.6, -length * 0.1);
  return g;
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

function tugModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tug';
  const L = 9.5;
  const B = 3.6;
  g.add(hull(L, B, 1.9, 0.35, std(0x1e2124, 0.55), 0.5));
  // Boot top and the heavy rubber fendering round the bow.
  g.add(box(B + 0.05, 0.2, L * 0.8, std(0x8f1e1e), 0, 0.05, L * 0.08));
  const fender = new THREE.Mesh(new THREE.TorusGeometry(B * 0.42, 0.22, 8, 16, Math.PI), std(0x111111, 0.9));
  fender.rotation.x = Math.PI / 2;
  fender.position.set(0, 0.9, -L * 0.28);
  g.add(fender);
  g.add(box(B * 0.92, 0.08, L * 0.92, std(0x5b5f63, 0.8), 0, 1.25, 0));
  // Wheelhouse with windows all round, and the mast.
  g.add(box(2.4, 1.7, 2.8, std(0xf0efe9, 0.5), 0, 2.15, -0.6));
  g.add(box(2.42, 0.6, 2.82, glass(), 0, 2.55, -0.6));
  g.add(box(2.6, 0.12, 3.0, std(0xf0efe9, 0.5), 0, 3.05, -0.6));
  g.add(box(0.12, 2.2, 0.12, std(0xd0d0d0), 0, 4.2, -0.4));
  g.add(box(0.5, 1.0, 0.5, std(0x1e2124), 0, 2.0, 1.2));
  g.add(navLights(L, B, 5.2, false));
  g.add(wake(B));
  return g;
}

function floatModel(length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const depth = 1.3;
  const deckY = 0.75;
  g.add(box(beam, depth, length - 6, std(0x2c3440, 0.6), 0, deckY - depth / 2, 0));
  g.add(box(beam, 0.08, length - 6, std(0x6d7175, 0.85), 0, deckY + 0.04, 0));
  // Lane markings.
  for (const x of [-beam / 4, beam / 4]) g.add(box(0.12, 0.01, length - 8, std(0xd8c04a, 0.7), x, deckY + 0.085, 0));
  // Side rails and walkways.
  const railM = std(0xe8e8e2, 0.5, 0.2);
  for (const s of [-1, 1]) g.add(railing(new THREE.Vector3(s * (beam / 2 - 0.15), deckY, -(length - 6) / 2), new THREE.Vector3(s * (beam / 2 - 0.15), deckY, (length - 6) / 2), 1.1, railM));
  // Hinged ramps at both ends (pivot at the deck edge): animated from the state.
  for (const end of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = end < 0 ? 'ramp-bow' : 'ramp-stern';
    pivot.position.set(0, deckY, end * (length - 6) / 2);
    const ramp = box(beam - 1.2, 0.15, 3.4, std(0x7a7e82, 0.8), 0, 0, end * 1.7);
    pivot.add(ramp);
    for (const s of [-1, 1]) pivot.add(box(0.12, 0.5, 3.4, std(0xe8c33a, 0.6), s * (beam / 2 - 0.7), 0.25, end * 1.7));
    g.add(pivot);
  }
  // Cars (two lanes, up to four in each: up to 8 cars, F1).
  const n = 3 + (seed % 6);
  for (let i = 0; i < n; i++) {
    const c = car(seed * 7 + i);
    c.position.set((i % 2 ? 1 : -1) * (beam / 4), deckY + 0.08, -length / 2 + 6 + Math.floor(i / 2) * 5.2);
    g.add(c);
  }
  // A small control and shelter cabin for the crew and foot passengers.
  g.add(box(1.6, 2.1, 3.0, std(0xe9e5d8, 0.6), beam / 2 - 1.0, deckY + 1.05, 0));
  g.add(navLights(length, beam, 4.2, true));
  return g;
}

function bridgeModel(length: number, beam: number): THREE.Group {
  const g = new THREE.Group();
  const deckY = 1.0;
  g.add(box(beam, 1.8, length - 8, std(0x1f3550, 0.6), 0, deckY - 0.9, 0));
  g.add(box(beam - 3, 0.08, length - 8, std(0x6a6e72, 0.85), -1.0, deckY + 0.04, 0));
  for (const x of [-beam / 2 + 2.5, -1.5, 2.0]) g.add(box(0.12, 0.01, length - 10, std(0xd8c04a, 0.7), x, deckY + 0.085, 0));
  // Side structure: passenger lounge along one side with the control cabin above it.
  g.add(box(2.6, 2.6, length * 0.55, std(0xf2f1ec, 0.5), beam / 2 - 1.3, deckY + 1.3, 0));
  g.add(box(2.62, 0.8, length * 0.55 - 0.4, glass(), beam / 2 - 1.3, deckY + 1.9, 0));
  g.add(box(3.2, 2.0, 5, std(0xf2f1ec, 0.5), beam / 2 - 1.6, deckY + 3.6, 0));
  g.add(box(3.22, 0.9, 5.02, glass(), beam / 2 - 1.6, deckY + 3.9, 0));
  g.add(railing(new THREE.Vector3(-beam / 2 + 0.2, deckY, -(length - 8) / 2), new THREE.Vector3(-beam / 2 + 0.2, deckY, (length - 8) / 2), 1.1, std(0xe8e8e2, 0.5, 0.2)));
  for (const end of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = end < 0 ? 'ramp-bow' : 'ramp-stern';
    pivot.position.set(-1.0, deckY, end * (length - 8) / 2);
    pivot.add(box(beam - 3.5, 0.2, 4.0, std(0x7a7e82, 0.8), 0, 0, end * 2.0));
    g.add(pivot);
  }
  for (let i = 0; i < 10; i++) {
    const c = car(i * 3 + 1);
    c.position.set(-beam / 2 + 2.5 + (i % 3) * 3.4, deckY + 0.08, -length / 2 + 8 + Math.floor(i / 3) * 5.5);
    g.add(c);
  }
  g.add(navLights(length, beam, 6.5, true));
  return g;
}

function passengerModel(length: number, beam: number, kind: VesselKind): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xf3f2ee, 0.45);
  g.add(hull(length, beam, 1.6, 0.3, white));
  g.add(box(beam + 0.04, 0.25, length * 0.75, std(kind === 'river-cruiser' ? 0x1d4d7a : 0x2d6a4f, 0.5), 0, 0.85, length * 0.05));
  const deckY = 1.15;
  if (kind === 'river-cruiser') {
    g.add(box(beam - 0.5, 2.0, length * 0.62, white, 0, deckY + 1.0, length * 0.08));
    g.add(box(beam - 0.48, 0.9, length * 0.6, glass(), 0, deckY + 1.25, length * 0.08));
    g.add(railing(new THREE.Vector3(-beam / 2 + 0.3, deckY + 2.0, -length * 0.2), new THREE.Vector3(-beam / 2 + 0.3, deckY + 2.0, length * 0.38), 1.0, std(0xd8d8d2)));
    g.add(railing(new THREE.Vector3(beam / 2 - 0.3, deckY + 2.0, -length * 0.2), new THREE.Vector3(beam / 2 - 0.3, deckY + 2.0, length * 0.38), 1.0, std(0xd8d8d2)));
    g.add(box(beam - 0.8, 0.08, length * 0.35, std(0x2a6f97, 0.7), 0, deckY + 4.2, length * 0.18));
    for (const z of [-0.0, 0.34]) for (const x of [-1, 1]) g.add(box(0.06, 1.2, 0.06, std(0xd8d8d2), x * (beam / 2 - 0.6), deckY + 3.6, length * z));
  } else {
    g.add(box(beam - 0.8, 1.9, length * (kind === 'launch' ? 0.35 : 0.5), white, 0, deckY + 0.95, -length * 0.05));
    g.add(box(beam - 0.78, 0.8, length * (kind === 'launch' ? 0.35 : 0.5) - 0.1, glass(), 0, deckY + 1.25, -length * 0.05));
    if (kind === 'launch') g.add(box(beam - 0.4, 0.06, length * 0.4, std(0x1d4d7a, 0.7), 0, deckY + 2.0, length * 0.25));
  }
  g.add(navLights(length, beam, kind === 'river-cruiser' ? 5.4 : 3.6, false));
  g.add(wake(beam));
  return g;
}

function leisureModel(kind: VesselKind, length: number, beam: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'rib') {
    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, length - 0.9, 4, 10), std(0x3d4246, 0.8));
    for (const s of [-1, 1]) {
      const t = tube.clone();
      t.rotation.x = Math.PI / 2;
      t.position.set(s * (beam / 2 - 0.3), 0.45, 0.1);
      g.add(t);
    }
    g.add(hull(length - 0.4, beam - 0.5, 0.7, 0.35, std(0xe6e6e2, 0.5)));
    g.add(box(0.8, 1.0, 0.7, std(0x2b2e33), 0, 0.95, 0.5));
    g.add(box(0.5, 0.6, 0.5, std(0x2b2e33), 0, 0.7, length / 2 - 0.4));
  } else if (kind === 'yacht') {
    g.add(hull(length, beam, 1.4, 0.45, std(seed % 3 ? 0xf2f2ee : 0x1f3550, 0.4)));
    g.add(box(beam * 0.55, 0.55, length * 0.38, std(0xf2f2ee, 0.5), 0, 1.25, -length * 0.02));
    g.add(box(beam * 0.56, 0.22, length * 0.36, glass(), 0, 1.3, -length * 0.02));
    g.add(box(0.14, 13, 0.14, std(0xc8ccd0, 0.35, 0.6), 0, 7.3, -length * 0.12));
    // Mainsail stowed on the boom under its cover.
    g.add(box(0.35, 0.35, length * 0.42, std(0x1d3557, 0.8), 0, 2.4, length * 0.1));
    g.add(navLights(length, beam, 13.5, false));
  } else {
    g.add(hull(length, beam, 1.6, 0.4, std(0xf4f3ef, 0.35)));
    g.add(box(beam * 0.7, 1.2, length * 0.45, std(0xf4f3ef, 0.4), 0, 1.65, -length * 0.02));
    g.add(box(beam * 0.71, 0.5, length * 0.44, glass(), 0, 1.85, -length * 0.02));
    g.add(box(beam * 0.6, 0.1, length * 0.3, std(0xe9e8e2, 0.5), 0, 2.6, length * 0.02));
    g.add(navLights(length, beam, 3.6, false));
  }
  g.add(wake(beam));
  return g;
}

interface Entry {
  root: THREE.Group;
  body: THREE.Group;
  tug?: THREE.Group;
  label?: THREE.Sprite;
  ramps: THREE.Object3D[];
  wakes: THREE.Mesh[];
  lights: THREE.Mesh[];
  seen: number;
}

const LABEL_RANGE_M = 900;

export class TrafficView {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private day = 1;

  constructor() {
    this.group.name = 'traffic';
  }

  private build(s: VesselState): Entry {
    const root = new THREE.Group();
    root.name = `vessel-${s.kind}`;
    const seed = [...s.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    let body: THREE.Group;
    switch (s.kind) {
      case 'tug-float':
        body = floatModel(s.length, s.beam, seed);
        break;
      case 'floating-bridge':
        body = bridgeModel(s.length, s.beam);
        break;
      case 'passenger-ferry':
      case 'launch':
      case 'river-cruiser':
        body = passengerModel(s.length, s.beam, s.kind);
        break;
      default:
        body = leisureModel(s.kind, s.length, s.beam, seed);
    }
    root.add(body);
    let tug: THREE.Group | undefined;
    if (s.kind === 'tug-float') {
      tug = tugModel();
      this.group.add(tug);
    }
    let label: THREE.Sprite | undefined;
    if (s.kind === 'tug-float' || s.kind === 'floating-bridge' || s.kind === 'passenger-ferry' || s.kind === 'river-cruiser' || s.kind === 'launch') {
      label = makeLabel(`${s.label}${s.ram ? ' · RAM' : ''}`, s.ram ? '#ffd28a' : '#ffffff');
      label.position.y = 7;
      label.userData.priority = 2;
      root.add(label);
    }
    const ramps: THREE.Object3D[] = [];
    const wakes: THREE.Mesh[] = [];
    const lights: THREE.Mesh[] = [];
    for (const g of [root, ...(tug ? [tug] : [])]) {
      g.traverse((o) => {
        if (o.name.startsWith('ramp-')) ramps.push(o);
        if (o.name === 'wake') wakes.push(o as THREE.Mesh);
        if (o.parent?.name === 'lights') lights.push(o as THREE.Mesh);
        if (o instanceof THREE.Mesh && o.name !== 'wake') o.castShadow = o.receiveShadow = false;
      });
    }
    this.group.add(root);
    return { root, body, tug, label, ramps, wakes, lights, seen: 0 };
  }

  /** Daylight 0 (night) … 1 (day): navigation lights come on at dusk. */
  setDaylight(day: number): void {
    this.day = day;
  }

  /** The labels, for decluttering with the place labels. */
  labels(): THREE.Sprite[] {
    return [...this.entries.values()].flatMap((e) => (e.label ? [e.label] : []));
  }

  update(states: VesselState[], time: number, camera: THREE.Camera, showLabels: boolean): void {
    const stamp = time;
    const lightOn = this.day < 0.35 ? 3 : 0;
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
      for (const w of e.wakes) (w.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, Math.max(0, (s.sog - 0.3) / 3));
      for (const l of e.lights) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = lightOn;
      if (e.tug && s.tug) {
        e.tug.visible = true;
        e.tug.position.set(s.tug.e, bob, -s.tug.n);
        e.tug.rotation.set(0, -s.tug.heading, 0.015 * Math.sin(time * 1.4));
      }
      if (e.label) e.label.visible = showLabels && e.root.position.distanceTo(camera.position) < LABEL_RANGE_M;
    }
    for (const [id, e] of this.entries) {
      if (e.seen === stamp) continue;
      // Gone (a marina boat that has arrived, a seasonal ferry off service): remove it.
      this.group.remove(e.root);
      if (e.tug) this.group.remove(e.tug);
      this.entries.delete(id);
    }
  }
}
