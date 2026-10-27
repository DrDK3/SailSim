import * as THREE from 'three';
import { Railway, TRAIN, pathPoint, type RailPath, type RailwayFeatures, type TrainState } from '../sim/env/railway';
import { Kit, VMAT, place } from './vessels';

/**
 * The Dartmouth Steam Railway in the picture: track (ballast, sleepers, rails) on OpenStreetMap's lines at the
 * ground's level, the platforms, and at Kingswear the listed train shed - timber trusses with iron-rod bracing,
 * boarded sides, a roof with a glazed ridge, over the platform and the line beside it - and the platform canopy
 * on iron lattice piers beyond it (Historic England list entry 1308783). Their extents, heights and colours are
 * estimates (E). Then the trains: a GWR-style tank engine and seven chocolate-and-cream coaches, with smoke
 * when the engine works and steam when it stands. Visual only.
 */

const GAUGE = 1.435;
const RAIL_TOP = 0.32; // rail top above the formation (ballast and sleeper)
const PLATFORM_HEIGHT = 0.92; // above the rail top
/** Train shed and canopy lengths along the platform from the buffer end (E). */
const SHED = { from: 0, to: 46 };
const CANOPY = { from: 46, to: 100 };

type Ground = (e: number, n: number) => number;

/** Rail-top level along a path: the ground, smoothed (embankments and cuttings), never buried in it. */
export class TrackProfile {
  readonly step = 2;
  readonly h: Float32Array;
  constructor(readonly path: RailPath, ground: Ground) {
    const n = Math.max(2, Math.ceil(path.length / this.step) + 1);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pathPoint(path, i * this.step);
      raw[i] = ground(p.e, p.n);
    }
    const smooth = (src: Float32Array, w: number) => {
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        let a = 0;
        let c = 0;
        for (let k = Math.max(0, i - w); k <= Math.min(src.length - 1, i + w); k++) {
          a += src[k]!;
          c++;
        }
        out[i] = a / c;
      }
      return out;
    };
    let h = smooth(raw, 12);
    for (let i = 0; i < n; i++) h[i] = Math.max(h[i]!, raw[i]! - 0.25);
    h = smooth(h, 4);
    for (let i = 0; i < n; i++) h[i] = h[i]! + RAIL_TOP;
    this.h = h;
  }

  at(s: number): number {
    const x = Math.min(Math.max(s / this.step, 0), this.h.length - 1);
    const i = Math.min(this.h.length - 2, Math.floor(x));
    const f = x - i;
    return this.h[i]! * (1 - f) + this.h[i + 1]! * f;
  }
}

const MAT = {
  ballast: new THREE.MeshStandardMaterial({ color: 0x7c766c, roughness: 1 }),
  sleeper: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.35, metalness: 0.85 }),
  platform: new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95 }),
  coping: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 }),
  portal: new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1 }),
  dark: new THREE.MeshBasicMaterial({ color: 0x050505 }),
};

/** Ballast shoulder, sleepers and rails along a path (not in tunnels); sleepers only where `sleepersAt` allows. */
function buildTrack(path: RailPath, prof: TrackProfile, group: THREE.Group, sleepers: THREE.Matrix4[], sleepersAt: (e: number, n: number) => boolean = () => true): void {
  const pos: number[] = [];
  const idx: number[] = [];
  const railPos: number[] = [];
  const railIdx: number[] = [];
  const inTunnel = (s: number) => path.tunnels.some(([a, b]) => s > a && s < b);
  const step = 2;
  let prev: { l: number; r: number } | undefined;
  let prevRail: number[] | undefined;
  for (let s = 0; s <= path.length + 1e-6; s += step) {
    const x = Math.min(s, path.length);
    if (inTunnel(x)) {
      prev = undefined;
      prevRail = undefined;
      continue;
    }
    const a = pathPoint(path, Math.max(0, x - 1));
    const b = pathPoint(path, Math.min(path.length, x + 1));
    const p = pathPoint(path, x);
    const h = Math.atan2(b.e - a.e, b.n - a.n);
    // Right of the direction of travel.
    const re = Math.cos(h);
    const rn = -Math.sin(h);
    const top = prof.at(x) - RAIL_TOP;
    // Ballast: a trapezoid (top 2.6 m, foot 4 m, 0.45 m deep) - four vertices across.
    const base = pos.length / 3;
    for (const [off, dy] of [[-2.0, -0.45], [-1.3, 0.02], [1.3, 0.02], [2.0, -0.45]] as const) pos.push(p.e + re * off, top + dy, -(p.n + rn * off));
    if (prev) for (let k = 0; k < 3; k++) idx.push(prev.l + k, base + k, prev.l + k + 1, prev.l + k + 1, base + k, base + k + 1);
    prev = { l: base, r: base + 3 };
    // Rails: head 0.07 wide, 0.16 deep, at half the gauge either side.
    const rb = railPos.length / 3;
    const verts: number[] = [];
    for (const side of [-1, 1]) {
      for (const [w, dy] of [[-0.035, 0], [-0.035, 0.16], [0.035, 0.16], [0.035, 0]] as const) {
        const off = side * (GAUGE / 2 + 0.035) + w;
        verts.push(p.e + re * off, top + 0.16 + dy, -(p.n + rn * off));
      }
    }
    railPos.push(...verts);
    if (prevRail) {
      for (let r = 0; r < 2; r++) {
        for (let k = 0; k < 3; k++) {
          const i0 = prevRail[0]! + r * 4 + k;
          const i1 = rb + r * 4 + k;
          railIdx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
        }
      }
    }
    prevRail = [rb];
    // Sleepers every 0.75 m (two to a step and a bit; drawn as instances).
    for (let k = 0; k < step && sleepersAt(p.e, p.n); k += 0.75) {
      const sp = pathPoint(path, Math.min(path.length, x + k));
      sleepers.push(new THREE.Matrix4().compose(new THREE.Vector3(sp.e, top + 0.1, -sp.n), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h), new THREE.Vector3(1, 1, 1)));
    }
  }
  const mk = (p: number[], i: number[], m: THREE.Material, name: string) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(i);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  mk(pos, idx, MAT.ballast, 'ballast');
  mk(railPos, railIdx, MAT.rail, 'rails');
}

/** A tunnel mouth: a stone face with a dark arch, across the track. */
function portal(path: RailPath, prof: TrackProfile, s: number, facing: 1 | -1, group: THREE.Group): void {
  const a = pathPoint(path, s - 1);
  const b = pathPoint(path, s + 1);
  const p = pathPoint(path, s);
  const h = Math.atan2(b.e - a.e, b.n - a.n) + (facing === 1 ? 0 : Math.PI);
  const y = prof.at(s) - RAIL_TOP;
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(11, 8, 1.2), MAT.portal);
  wall.position.set(0, 4, 0);
  const arch = new THREE.Shape();
  arch.moveTo(-2.4, 0);
  arch.lineTo(-2.4, 3.6);
  arch.absarc(0, 3.6, 2.4, Math.PI, 0, true);
  arch.lineTo(2.4, 0);
  arch.lineTo(-2.4, 0);
  const hole = new THREE.Mesh(new THREE.ShapeGeometry(arch, 12), MAT.dark);
  hole.position.set(0, 0, -0.62);
  hole.rotation.y = Math.PI;
  g.add(wall, hole);
  g.position.set(p.e, y, -p.n);
  g.rotation.y = -h;
  g.name = 'tunnel-portal';
  group.add(g);
}

// ------------------------------------------------------------------ rolling stock

const GWR_GREEN = 0x1d4a2a;
const BLACK = 0x161616;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A GWR-style 2-8-0 tank engine (E), chimney at −z, rail top at y = 0. */
function locoModel(): THREE.Group {
  const kit = new Kit();
  const L = TRAIN.locoLength - 0.6;
  const z0 = -L / 2;
  // Frames and running plate, buffer beams (red) with buffers, the boiler, smokebox, chimney (copper cap),
  // safety-valve bonnet (brass), side tanks, cab and bunker.
  kit.box(2.0, 0.55, L - 0.4, VMAT.paint, BLACK, 0, 1.0, 0);
  kit.box(2.7, 0.08, L - 0.5, VMAT.paint, BLACK, 0, 1.32, 0);
  for (const e of [-1, 1]) {
    kit.box(2.7, 0.5, 0.18, VMAT.paint, 0xa31f1f, 0, 1.05, e * (L / 2 - 0.1));
    for (const s of [-1, 1]) kit.add(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10), VMAT.steel, undefined, place(s * 0.88, 1.05, e * (L / 2 + 0.15), 0, Math.PI / 2));
  }
  const boilerR = 0.78;
  const by = 1.32 + boilerR + 0.1;
  kit.add(new THREE.CylinderGeometry(boilerR, boilerR, L * 0.52, 18), VMAT.paint, GWR_GREEN, place(0, by, z0 + 1.0 + L * 0.26, 0, Math.PI / 2));
  kit.add(new THREE.CylinderGeometry(boilerR + 0.06, boilerR + 0.06, 1.1, 18), VMAT.paint, BLACK, place(0, by, z0 + 0.95, 0, Math.PI / 2));
  kit.add(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 18), VMAT.paint, BLACK, place(0, by, z0 + 0.38, 0, Math.PI / 2));
  kit.add(new THREE.CylinderGeometry(0.26, 0.3, 0.75, 12), VMAT.paint, BLACK, place(0, by + boilerR + 0.3, z0 + 0.95));
  kit.add(new THREE.CylinderGeometry(0.33, 0.27, 0.16, 12), VMAT.paint, 0xb87333, place(0, by + boilerR + 0.72, z0 + 0.95));
  kit.add(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 12), VMAT.paint, 0xc9a227, place(0, by + boilerR + 0.15, z0 + 3.1));
  for (const s of [-1, 1]) kit.box(0.62, 1.35, L * 0.36, VMAT.paint, GWR_GREEN, s * 1.05, 1.36 + 0.68, z0 + 1.6 + L * 0.18);
  const cabZ = z0 + L * 0.68;
  for (const s of [-1, 1]) kit.box(0.08, 1.8, 1.9, VMAT.paint, GWR_GREEN, s * 1.3, 1.36 + 0.9, cabZ);
  kit.box(2.68, 0.6, 0.08, VMAT.paint, GWR_GREEN, 0, 2.95, cabZ - 0.95);
  kit.add(new THREE.CylinderGeometry(2.0, 2.0, 2.0, 16, 1, false, -0.75, 1.5), VMAT.paint, BLACK, place(0, 3.16 - 2.0 * Math.cos(0.75), cabZ, 0, -Math.PI / 2));
  kit.box(2.6, 1.6, L * 0.17, VMAT.paint, GWR_GREEN, 0, 1.36 + 0.8, z0 + L * 0.88);
  for (const s of [-1, 1]) kit.add(new THREE.BoxGeometry(0.02, 0.5, 0.6), VMAT.glass, undefined, place(s * 1.35, 2.7, cabZ - 0.3));
  // Wheels: a pony truck and eight coupled wheels, coupling rods.
  for (const s of [-1, 1]) {
    kit.add(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 14), VMAT.paint, BLACK, place(s * 0.75, 0.45, z0 + 1.2, 0, 0, Math.PI / 2));
    for (let k = 0; k < 4; k++) kit.add(new THREE.CylinderGeometry(0.71, 0.71, 0.14, 18), VMAT.paint, GWR_GREEN, place(s * 0.75, 0.71, z0 + 2.9 + k * 1.55, 0, 0, Math.PI / 2));
    kit.rod(V(s * 0.86, 0.6, z0 + 2.9), V(s * 0.86, 0.6, z0 + 2.9 + 3 * 1.55), 0.06, VMAT.steel, undefined, 6);
    kit.add(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 12), VMAT.paint, BLACK, place(s * 0.75, 1.0, z0 + 1.6, 0, Math.PI / 2));
  }
  return kit.build('loco');
}

/** A BR Mark 1 coach in chocolate and cream (E), rail top at y = 0. */
function coachModel(): THREE.Group {
  const kit = new Kit();
  const L = TRAIN.coachLength - 0.8;
  const W = 2.85;
  // Body sides: chocolate below the waist, cream above; a window band; roof; ends with gangways; bogies.
  kit.box(W, 1.15, L, VMAT.paint, 0x5a3324, 0, 1.0 + 0.58, 0);
  kit.box(W, 1.05, L, VMAT.paint, 0xe8dcb5, 0, 1.0 + 1.15 + 0.52, 0);
  for (const s of [-1, 1]) kit.add(new THREE.BoxGeometry(0.02, 0.7, L - 1.6), VMAT.glass, undefined, place(s * (W / 2 + 0.01), 2.62, 0));
  // Roof: a shallow arc along the coach (the cylinder's axis turned to lie along it, its arc on top).
  const roof = new THREE.CylinderGeometry(2.4, 2.4, L, 20, 1, false, -0.62, 1.24);
  kit.add(roof, VMAT.paint, 0x55585b, place(0, 3.2 - 2.4 * Math.cos(0.62), 0, 0, -Math.PI / 2));
  for (const e of [-1, 1]) {
    kit.box(1.0, 2.0, 0.4, VMAT.paint, BLACK, 0, 2.0, e * (L / 2 + 0.2));
    for (const s of [-1, 1]) kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 8), VMAT.steel, undefined, place(s * 0.88, 1.05, e * (L / 2 + 0.2), 0, Math.PI / 2));
    // Bogie: frame and two wheelsets each side.
    const bz = e * 7.1;
    kit.box(2.3, 0.45, 2.9, VMAT.paint, BLACK, 0, 0.62, bz);
    for (const s of [-1, 1]) for (const w of [-1, 1]) kit.add(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 12), VMAT.paint, BLACK, place(s * 0.75, 0.46, bz + w * 1.3, 0, 0, Math.PI / 2));
  }
  return kit.build('coach');
}

// ------------------------------------------------------------------ exhaust

function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Exhaust {
  readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; age: number; life: number; v: THREE.Vector3; grow: number }[] = [];
  private acc = 0;
  private readonly material?: THREE.SpriteMaterial;
  constructor() {
    this.group.name = 'exhaust';
    if (typeof document === 'undefined') return;
    this.material = new THREE.SpriteMaterial({ map: puffTexture(), color: 0xdddddd, transparent: true, depthWrite: false });
  }

  /** Emit at `rate` puffs a second from `at`, smoke (grey) when working, steam (white) otherwise; age the rest. */
  update(dt: number, at: THREE.Vector3 | undefined, rate: number, smoke: boolean, drift: THREE.Vector3): void {
    if (!this.material) return;
    this.acc += at ? rate * dt : 0;
    while (this.acc >= 1 && at) {
      this.acc -= 1;
      const m = this.material.clone();
      m.color.setHex(smoke ? 0x8a8a88 : 0xf4f4f2);
      const s = new THREE.Sprite(m);
      s.position.copy(at);
      s.scale.setScalar(0.8);
      this.group.add(s);
      this.puffs.push({ s, age: 0, life: smoke ? 5 : 3, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, smoke ? 2.2 : 1.4, (Math.random() - 0.5) * 0.3).add(drift), grow: smoke ? 1.6 : 1.1 });
      if (this.puffs.length > 60) {
        const old = this.puffs.shift()!;
        this.group.remove(old.s);
        (old.s.material as THREE.Material).dispose();
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      if (p.age > p.life) {
        this.group.remove(p.s);
        (p.s.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      p.s.position.addScaledVector(p.v, dt);
      p.v.y *= 1 - 0.3 * dt;
      p.s.scale.setScalar(0.8 + p.grow * p.age);
      (p.s.material as THREE.SpriteMaterial).opacity = 0.75 * (1 - p.age / p.life);
    }
  }
}

// ------------------------------------------------------------------ view

export class RailwayView {
  readonly group = new THREE.Group();
  readonly railway: Railway;
  private readonly mainProfile?: TrackProfile;
  private readonly loopProfile?: TrackProfile;
  private readonly loco?: THREE.Group;
  private readonly coaches: THREE.Group[] = [];
  private readonly exhaust = new Exhaust();
  private lastTime?: number;

  /** `detail` 'low' (a software renderer): sleepers only within 300 m of the station, where trains are seen up close. */
  constructor(features: RailwayFeatures, ground: Ground, detail: 'high' | 'low' = 'high') {
    this.group.name = 'railway';
    this.railway = new Railway(features);
    const sleepers: THREE.Matrix4[] = [];
    const st = this.railway.station;
    const sleepersAt = detail === 'low' && st ? (e: number, n: number) => Math.hypot(e - st.e, n - st.n) < 300 : undefined;
    // Every line, as track; the main path and loop keep their profiles for the trains.
    const r = this.railway;
    if (r.main) {
      this.mainProfile = new TrackProfile(r.main, ground);
      buildTrack(r.main, this.mainProfile, this.group, sleepers, sleepersAt);
      for (const [a, b] of r.main.tunnels) {
        portal(r.main, this.mainProfile, a, -1, this.group);
        portal(r.main, this.mainProfile, b, 1, this.group);
      }
    }
    if (r.loop) this.loopProfile = new TrackProfile(r.loop, ground);
    const inMain = (l: { line: [number, number][] }) => r.main && l.line.every(([e, n]) => r.main!.pts.some(([pe, pn]) => Math.hypot(pe - e, pn - n) < 0.5));
    for (const l of features.lines) {
      if (l.tunnel || inMain(l)) continue;
      const pts = l.line;
      const path: RailPath = (() => {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
        return { pts, cum, length: cum[cum.length - 1]!, tunnels: [] };
      })();
      if (path.length < 4) continue;
      buildTrack(path, new TrackProfile(path, ground), this.group, sleepers, sleepersAt);
    }
    if (sleepers.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.14, 0.26), MAT.sleeper, sleepers.length);
      sleepers.forEach((m, i) => im.setMatrixAt(i, m));
      im.name = 'sleepers';
      im.receiveShadow = true;
      this.group.add(im);
    }
    for (const st of features.stations) this.buildStation(st, ground);
    if (r.main && r.station) {
      this.loco = locoModel();
      this.group.add(this.loco);
      const c = coachModel();
      for (let i = 0; i < TRAIN.coaches; i++) {
        const g = i === 0 ? c : c.clone();
        this.coaches.push(g);
        this.group.add(g);
      }
      for (const o of [this.loco, ...this.coaches]) {
        o.visible = false;
        o.traverse((x) => {
          if ((x as THREE.Mesh).isMesh) {
            x.castShadow = true;
            x.receiveShadow = true;
          }
        });
      }
    }
    this.group.add(this.exhaust.group);
  }

  /** Platforms (raised to platform height above the nearest track) and, at Kingswear, the shed and canopy. */
  private buildStation(st: RailwayFeatures['stations'][number], ground: Ground): void {
    const r = this.railway;
    const prof = this.mainProfile;
    for (const ring of st.platforms) {
      // Platform top: the level of the nearest track's rail top plus the platform height.
      let top = 0;
      let c = 0;
      for (const [e, n] of ring) {
        if (prof && r.main && r.station === st) {
          let best = { s: 0, d: Infinity };
          for (let s = 0; s < Math.min(r.main.length, 400); s += 2) {
            const p = pathPoint(r.main, s);
            const d = Math.hypot(p.e - e, p.n - n);
            if (d < best.d) best = { s, d };
          }
          top += prof.at(best.s);
        } else top += ground(e, n) + RAIL_TOP;
        c++;
      }
      top = top / Math.max(1, c) + PLATFORM_HEIGHT;
      const low = Math.min(...ring.map(([e, n]) => ground(e, n))) - 0.5;
      const shape = new THREE.Shape(ring.map(([e, n]) => new THREE.Vector2(e, n)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: top - low, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, MAT.platform);
      m.position.y = low;
      m.name = 'platform';
      m.receiveShadow = true;
      this.group.add(m);
      // White coping along the edges.
      const pts = [...ring, ring[0]!].map(([e, n]) => V(e, top + 0.02, -n));
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = a.distanceTo(b);
        if (len < 0.3) continue;
        const cm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, len), MAT.coping);
        cm.position.copy(a).add(b).multiplyScalar(0.5);
        cm.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        this.group.add(cm);
      }
      if (r.station === st && r.main && prof) this.buildShed(ring, top);
    }
  }

  /**
   * Kingswear's train shed over the platform and the platform road (E: about 46 m long) and the canopy on
   * lattice piers beyond it over the platform alone (E: about 54 m).
   */
  private buildShed(ring: [number, number][], platformTop: number): void {
    const main = this.railway.main!;
    const prof = this.mainProfile!;
    const kit = new Kit();
    // Which side of the platform road the platform lies, and how wide it is there.
    const side = (s: number) => {
      const a = pathPoint(main, s - 1);
      const b = pathPoint(main, s + 1);
      const h = Math.atan2(b.e - a.e, b.n - a.n);
      const re = Math.cos(h);
      const rn = -Math.sin(h);
      const p = pathPoint(main, s);
      let far = 0;
      let dir = 1;
      for (const sign of [1, -1]) {
        for (let w = 1; w < 14; w += 0.5) {
          const e = p.e + re * w * sign;
          const n = p.n + rn * w * sign;
          if (pointInRing(e, n, ring) && w > far) {
            far = w;
            dir = sign;
          }
        }
      }
      return { p, re: re * dir, rn: rn * dir, far, h };
    };
    const rail = (s: number) => prof.at(s);
    const eaves = (s: number) => rail(s) + 5.2;
    const cross = (s: number, w: number, y: number) => {
      const q = side(s);
      return V(q.p.e + q.re * w, y, -(q.p.n + q.rn * w));
    };
    // Shed: posts each side every 4.6 m, timber trusses with iron-rod ties, a pitched roof with a glazed ridge
    // and boarded sides down to 2.4 m above the rails.
    const shedPost = 0xb9a98a;
    for (let s = SHED.from + 1; s <= SHED.to; s += 4.6) {
      const q = side(s);
      if (q.far < 2) continue;
      const wL = -2.6;
      const wR = q.far + 0.3;
      const yb = rail(s) - RAIL_TOP;
      for (const w of [wL, wR]) kit.rod(cross(s, w, w === wL ? yb : platformTop), cross(s, w, eaves(s)), 0.13, VMAT.paint, shedPost, 6);
      const mid = (wL + wR) / 2;
      const apex = cross(s, mid, eaves(s) + 2.3);
      kit.rod(cross(s, wL, eaves(s)), apex, 0.1, VMAT.paint, 0x6b5136, 4);
      kit.rod(cross(s, wR, eaves(s)), apex, 0.1, VMAT.paint, 0x6b5136, 4);
      kit.rod(cross(s, wL, eaves(s)), cross(s, wR, eaves(s)), 0.03, VMAT.steel, undefined, 4);
      kit.rod(cross(s, mid, eaves(s)), apex, 0.025, VMAT.steel, undefined, 4);
    }
    const strip = (s0: number, s1: number, w0: number, w1: number, y0: (s: number) => number, y1: (s: number) => number, mat: THREE.Material, colour?: number) => {
      const pos: number[] = [];
      for (let s = s0; s <= s1 + 1e-6; s += 2) {
        const q = side(s);
        if (q.far < 2) continue;
        for (const [w, y] of [[w0, y0(s)], [w1, y1(s)]] as const) {
          const ww = w === Infinity ? q.far + 0.3 : w === -Infinity ? -2.6 : w;
          pos.push(q.p.e + q.re * ww, y, -(q.p.n + q.rn * ww));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const idx: number[] = [];
      for (let i = 0; i + 3 < pos.length / 3; i += 2) idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      g.setIndex(idx);
      g.computeVertexNormals();
      kit.add(g.toNonIndexed(), mat, colour);
      const back = g.clone();
      back.setIndex([...idx].reverse());
      back.computeVertexNormals();
      kit.add(back.toNonIndexed(), mat, colour);
    };
    const midW = (s: number) => (side(s).far + 0.3 - 2.6) / 2;
    // Roof slopes (grey corrugated), each stopping short of the ridge for the glazing.
    for (const sgn of [-1, 1]) {
      const pos: number[] = [];
      for (let s = SHED.from; s <= SHED.to + 1e-6; s += 2) {
        const q = side(s);
        if (q.far < 2) continue;
        const m = midW(s);
        const edge = sgn < 0 ? -2.6 - 0.4 : q.far + 0.3 + 0.4;
        const nearRidge = m + sgn * 0.7;
        for (const [w, y] of [[edge, eaves(s) - 0.18], [nearRidge, eaves(s) + 2.3 - 0.7 * (2.3 / Math.abs(edge - m))]] as const) pos.push(q.p.e + q.re * w, y, -(q.p.n + q.rn * w));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const idx: number[] = [];
      for (let i = 0; i + 3 < pos.length / 3; i += 2) idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2, i, i + 2, i + 1, i + 1, i + 2, i + 3);
      g.setIndex(idx);
      g.computeVertexNormals();
      kit.add(g.toNonIndexed(), VMAT.paint, 0x5d6166);
    }
    // Glazed ridge.
    {
      const pos: number[] = [];
      for (let s = SHED.from; s <= SHED.to + 1e-6; s += 2) {
        const q = side(s);
        if (q.far < 2) continue;
        const m = midW(s);
        for (const w of [m - 0.75, m + 0.75]) pos.push(q.p.e + q.re * w, eaves(s) + 2.15, -(q.p.n + q.rn * w));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const idx: number[] = [];
      for (let i = 0; i + 3 < pos.length / 3; i += 2) idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2, i, i + 2, i + 1, i + 1, i + 2, i + 3);
      g.setIndex(idx);
      g.computeVertexNormals();
      const ng = g.toNonIndexed();
      ng.deleteAttribute('uv');
      kit.add(ng, VMAT.glass);
    }
    // Boarded sides: the track side from 2.4 m above the rails to the eaves; the platform side above 3.2 m.
    strip(SHED.from, SHED.to, -2.6, -2.6, (s) => rail(s) + 2.4, (s) => eaves(s), VMAT.paint, 0x6e2b22);
    strip(SHED.from, SHED.to, Infinity, Infinity, () => platformTop + 3.2, (s) => eaves(s), VMAT.paint, 0x6e2b22);
    // Canopy beyond: lattice piers on the platform's middle, a shallow ridged roof over the platform.
    for (let s = CANOPY.from + 3; s <= CANOPY.to; s += 6) {
      const q = side(s);
      if (q.far < 2) continue;
      const m = (1.6 + q.far) / 2;
      const base = cross(s, m, platformTop);
      const top = cross(s, m, platformTop + 3.4);
      kit.rod(base, top, 0.11, VMAT.paint, 0x2f4a3a, 4);
      kit.rod(cross(s, 1.4, platformTop + 3.4), cross(s, q.far + 0.2, platformTop + 3.4), 0.07, VMAT.paint, 0x2f4a3a, 4);
    }
    strip(CANOPY.from, CANOPY.to, 1.2, Infinity, () => platformTop + 3.55, () => platformTop + 3.85, VMAT.paint, 0x5d6166);
    const g = kit.build('train-shed');
    g.traverse((x) => {
      if ((x as THREE.Mesh).isMesh) {
        x.castShadow = true;
        x.receiveShadow = true;
      }
    });
    this.group.add(g);
  }

  /** Place the train (if one is about) and its exhaust. `time` is the picture's clock (s), for the exhaust. */
  update(epochMs: number, time: number, wind: { e: number; n: number }): void {
    const st: TrainState | undefined = this.railway.state(epochMs);
    const dt = this.lastTime === undefined ? 0 : Math.min(0.2, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (!this.loco) return;
    const all = [this.loco, ...this.coaches];
    if (!st) {
      for (const o of all) o.visible = false;
      this.exhaust.update(dt, undefined, 0, false, new THREE.Vector3());
      return;
    }
    let chimney: THREE.Vector3 | undefined;
    this.group.updateWorldMatrix(true, false);
    st.vehicles.forEach((v, i) => {
      const o = i === 0 ? this.loco! : this.coaches[v.index]!;
      if (v.hidden) {
        o.visible = false;
        return;
      }
      o.visible = true;
      const prof = v.track === 'loop' && this.loopProfile ? this.loopProfile : this.mainProfile!;
      const half = v.kind === 'coach' ? 7.1 : 4;
      const sOn = v.track === 'loop' && this.railway.loop ? nearestOn(this.railway.loop, v.e, v.n) : v.s;
      const ya = prof.at(sOn - half);
      const yb = prof.at(sOn + half);
      const pitch = Math.atan2(yb - ya, 2 * half);
      o.position.set(v.e, (ya + yb) / 2, -v.n);
      o.rotation.set(0, -v.heading, 0, 'YXZ');
      // Facing the buffers (towards lower s), the nose dips when the ground rises with s.
      o.rotateX(-pitch);
      if (i === 0) {
        o.updateMatrixWorld(true);
        chimney = this.group.worldToLocal(o.localToWorld(V(0, 3.5, -TRAIN.locoLength / 2 + 1.25)));
      }
    });
    const smoke = st.working;
    const rate = st.speed > 0.3 ? Math.min(6, 0.9 * st.speed + 1) : st.working ? 4 : 0.7;
    this.exhaust.update(dt, this.loco.visible ? chimney : undefined, rate, smoke, new THREE.Vector3(wind.e * 0.25, 0, -wind.n * 0.25));
  }
}

function nearestOn(p: RailPath, e: number, n: number): number {
  let best = { s: 0, d: Infinity };
  for (let i = 1; i < p.pts.length; i++) {
    const [ae, an] = p.pts[i - 1]!;
    const [be, bn] = p.pts[i]!;
    const de = be - ae;
    const dn = bn - an;
    const L2 = de * de + dn * dn;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / L2)) : 0;
    const d = Math.hypot(e - (ae + de * t), n - (an + dn * t));
    if (d < best.d) best = { s: p.cum[i - 1]! + t * Math.sqrt(L2), d };
  }
  return best.s;
}

function pointInRing(e: number, n: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ei, ni] = ring[i]!;
    const [ej, nj] = ring[j]!;
    if (ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei) inside = !inside;
  }
  return inside;
}
