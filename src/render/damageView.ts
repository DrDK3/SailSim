import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { Damage, Scar, ScarKind } from '../sim/boat/damage';
import { FLOOD } from '../sim/boat/flooding';

/**
 * What damage looks like on a Squib (owner, 6 Nov 2026): marks on the hull where she was struck (a scuff of
 * the other boat's paint, a gouge through the gelcoat, a star of cracks, a ragged hole with torn glass round
 * it), chips of glassfibre flying off as it happens; the rudder bent or gone; the mast broken off at the deck
 * and lying, with its sails, where it fell (over the stern, or over the side into the water); and the water
 * inside at its level, or the sea over her deck once she is awash. Only drawn: the physics is
 * src/sim/boat/damage.ts and src/sim/boat/flooding.ts. Sizes and colours are for the eye (E).
 */

/** The part of the damage the picture needs (a snapshot's). */
export type DamageLook = Pick<Damage, 'scars' | 'rigParts' | 'rudder' | 'sinkage' | 'trim' | 'state' | 'version' | 'water'>;

/** Body frame (x forward, y to starboard, z up) to the model's frame (x to starboard, y up, z aft). */
export function bodyToModel(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(y, z, -x);
}

function rand(seed: number): () => number {
  let s = Math.floor(seed * 2 ** 31) | 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const textures = new Map<string, THREE.Texture>();

/** A scar's picture (transparent outside the mark), one of a few variants per kind. */
export function scarTexture(kind: ScarKind, seed: number): THREE.Texture {
  const variant = Math.floor(seed * 4);
  const key = `${kind}:${variant}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const S = 256;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : undefined;
  if (!c) {
    const t = new THREE.Texture();
    textures.set(key, t);
    return t;
  }
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rand(variant / 4 + 0.13 + kind.length * 0.071);
  g.clearRect(0, 0, S, S);
  g.lineCap = 'round';
  const line = (pts: [number, number][], w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  const crackFrom = (x: number, y: number, len: number, ang: number, w: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    let px = x;
    let py = y;
    const steps = 5 + Math.floor(r() * 4);
    for (let i = 0; i < steps; i++) {
      ang += (r() - 0.5) * 0.7;
      px += (Math.cos(ang) * len) / steps;
      py += (Math.sin(ang) * len) / steps;
      pts.push([px, py]);
      if (depth > 0 && r() < 0.3) crackFrom(px, py, len * 0.45, ang + (r() < 0.5 ? 0.8 : -0.8), w * 0.6, depth - 1);
    }
    line(pts, w, 'rgba(38, 34, 30, 0.85)');
  };
  if (kind === 'scuff') {
    // Rub marks along the hull: dark smears of the other boat's paint and rubber, with lighter scratches.
    for (let i = 0; i < 9; i++) {
      const y = S * (0.3 + 0.4 * r());
      const x0 = S * (0.05 + 0.2 * r());
      const x1 = S * (0.7 + 0.25 * r());
      line([[x0, y], [x1, y + (r() - 0.5) * 14]], 2 + r() * 7, `rgba(${40 + r() * 50}, ${40 + r() * 40}, ${45 + r() * 40}, ${0.18 + r() * 0.3})`);
    }
    for (let i = 0; i < 6; i++) {
      const y = S * (0.35 + 0.3 * r());
      line([[S * (0.15 + 0.2 * r()), y], [S * (0.6 + 0.3 * r()), y + (r() - 0.5) * 8]], 1, 'rgba(255, 255, 255, 0.55)');
    }
  } else if (kind === 'gouge') {
    // Through the gelcoat: a jagged pale furrow of exposed laminate with dark, crushed edges.
    const y = S * 0.5;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) pts.push([S * (0.1 + 0.08 * i), y + (r() - 0.5) * 18 + Math.sin(i) * 4]);
    line(pts, 22, 'rgba(70, 60, 50, 0.55)');
    line(pts, 13, 'rgba(232, 222, 196, 0.95)');
    line(pts, 4, 'rgba(180, 165, 130, 0.9)');
    for (let i = 0; i < 12; i++) {
      const x = S * (0.15 + 0.7 * r());
      line([[x, y - 18 - r() * 18], [x + 18 * (r() - 0.5), y + 18 + r() * 14]], 1.2, 'rgba(60, 55, 50, 0.5)');
    }
  } else if (kind === 'crack') {
    // A star crack in the gelcoat: lines from the point struck, branching, and a chipped centre.
    const cx = S / 2;
    const cy = S / 2;
    const n = 7 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) crackFrom(cx, cy, S * (0.22 + 0.25 * r()), (i / n) * Math.PI * 2 + r() * 0.4, 2.2, 2);
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = 'rgba(40, 36, 30, 0.45)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(cx, cy, S * (0.07 + 0.08 * i + 0.03 * r()), r() * 6, r() * 6 + 1.5 + r() * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(225, 215, 190, 0.9)';
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
  } else {
    // A hole: torn laminate round a ragged black opening, fibres standing out, cracks running away from it.
    const cx = S / 2;
    const cy = S / 2;
    const rim: [number, number][] = [];
    const k = 22;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      const rr = S * (0.2 + 0.09 * r()) * (i % 3 === 0 ? 1.18 : 1);
      rim.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85]);
    }
    for (let i = 0; i < 10; i++) crackFrom(cx, cy, S * (0.38 + 0.12 * r()), r() * Math.PI * 2, 2, 1);
    // Torn glass: a pale, fibrous band round the opening.
    g.fillStyle = 'rgba(226, 214, 180, 0.95)';
    g.beginPath();
    rim.forEach(([x, y], i) => {
      const ex = cx + (x - cx) * 1.25;
      const ey = cy + (y - cy) * 1.25;
      if (i) g.lineTo(ex, ey);
      else g.moveTo(ex, ey);
    });
    g.closePath();
    g.fill();
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const r0 = S * 0.2;
      line([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.85], [cx + Math.cos(a) * (r0 + 6 + r() * 18), cy + Math.sin(a) * (r0 + 6 + r() * 18) * 0.85]], 1.4, 'rgba(250, 244, 220, 0.9)');
    }
    // The opening: dark, a glint of the wet inside.
    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, S * 0.24);
    grad.addColorStop(0, 'rgba(6, 10, 14, 1)');
    grad.addColorStop(0.8, 'rgba(18, 22, 26, 1)');
    grad.addColorStop(1, 'rgba(60, 54, 44, 1)');
    g.fillStyle = grad;
    g.beginPath();
    rim.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

const decalMaterials = new Map<string, THREE.MeshStandardMaterial>();
function decalMaterial(kind: ScarKind, seed: number): THREE.MeshStandardMaterial {
  const key = `${kind}:${Math.floor(seed * 4)}`;
  let m = decalMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: scarTexture(kind, seed),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      // The hull's faces are drawn from both sides (their winding is not outward everywhere): so are the marks.
      side: THREE.DoubleSide,
      roughness: kind === 'hole' ? 0.9 : 0.6,
    });
    decalMaterials.set(key, m);
  }
  return m;
}

/** Parts of a Squib model the damage changes. */
export interface DamageTargets {
  root: THREE.Object3D;
  /** The hull's surface meshes (scars are projected onto them). */
  hull: THREE.Mesh[];
  /** Everything that falls with the mast: spars, standing rigging, sails, sheets, telltales, burgee, boom. */
  rig: THREE.Object3D[];
  rudder: THREE.Object3D;
  rudderBlade?: THREE.Object3D;
  waterMask?: THREE.Object3D;
  mastZ: number;
  deckY: number;
  mastLength: number;
  boomLength: number;
  sailMaterial?: THREE.Material;
}

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
}

export class DamageView {
  readonly group = new THREE.Group();
  private readonly decals = new THREE.Group();
  private readonly wreck = new THREE.Group();
  private version = -1;
  private scarCount = 0;
  private applied = false;
  private readonly debris: Particle[] = [];
  private readonly debrisMesh: THREE.InstancedMesh;
  /** Air escaping as she floods and goes down: bubbles breaking at the surface round the hull. */
  private readonly bubbles: Particle[] = [];
  private readonly bubbleMesh: THREE.InstancedMesh;
  private bubbleClock = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly t: DamageTargets) {
    this.group.name = 'damage';
    this.decals.name = 'damage-decals';
    this.wreck.name = 'damage-wreck';
    this.group.add(this.decals, this.wreck);
    const chip = new THREE.BoxGeometry(0.03, 0.006, 0.02);
    this.debrisMesh = new THREE.InstancedMesh(chip, new THREE.MeshStandardMaterial({ color: 0xece4cc, roughness: 0.8 }), 64);
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.name = 'damage-debris';
    this.group.add(this.debrisMesh);
    this.bubbleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf4f8fa, roughness: 0.2, transparent: true, opacity: 0.85 }), 96);
    this.bubbleMesh.count = 0;
    this.bubbleMesh.frustumCulled = false;
    this.bubbleMesh.name = 'damage-bubbles';
    this.group.add(this.bubbleMesh);
    t.root.add(this.group);
  }

  /** Where the hull's surface is at a body point (raycast from outside towards the centreline), with its normal. */
  private surfaceAt(s: Scar): { p: THREE.Vector3; n: THREE.Vector3 } | undefined {
    const target = bodyToModel(s.x, s.y, s.z);
    const side = Math.abs(s.y) < 0.05 ? 0 : Math.sign(s.y);
    const from = side === 0 ? new THREE.Vector3(0.12, target.y, target.z) : new THREE.Vector3(side * 2.5, target.y, target.z);
    const dir = side === 0 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(-side, 0, 0);
    if (side === 0 && s.z < -0.2) {
      // The bottom near the keel root: from below and to one side.
      from.set(0.35, -1.2, target.z);
      dir.set(-0.28, 1, 0).normalize();
    } else if (side === 0) {
      // The stem or the transom: along the hull from outside.
      const bow = s.x > 0;
      from.set(0, target.y, bow ? target.z - 1.5 : target.z + 1.5);
      dir.set(0, 0, bow ? 1 : -1);
    }
    this.raycaster.set(from, dir);
    this.raycaster.far = 4;
    const inv = new THREE.Matrix4().copy(this.t.root.matrixWorld).invert();
    for (const m of this.t.hull) {
      // In the model's frame, whatever the boat's pose.
      const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const saved = m.matrixWorld.clone();
      m.matrixWorld.copy(local);
      const hit = this.raycaster.intersectObject(m, false)[0];
      m.matrixWorld.copy(saved);
      if (hit && hit.face) return { p: hit.point.clone(), n: hit.face.normal.clone().transformDirection(local).normalize() };
    }
    return undefined;
  }

  private rebuildDecals(d: DamageLook): void {
    for (const c of this.decals.children) (c as THREE.Mesh).geometry.dispose();
    this.decals.clear();
    this.t.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.t.root.matrixWorld).invert();
    for (const s of d.scars) {
      const hit = this.surfaceAt(s);
      if (!hit) continue;
      const look = new THREE.Object3D();
      look.position.copy(hit.p);
      look.lookAt(hit.p.clone().add(hit.n));
      // Scuffs and gouges run along the hull (the decal's x is level: along her side), cracks and holes are round.
      const along = s.kind === 'scuff' || s.kind === 'gouge' ? 1.9 : 1;
      const size = new THREE.Vector3(s.size * along, s.size, 0.5);
      for (const m of this.t.hull) {
        const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        const saved = m.matrixWorld.clone();
        m.matrixWorld.copy(local);
        try {
          const geo = new DecalGeometry(m, look.position, look.rotation, size);
          if (geo.getAttribute('position')?.count) {
            const mesh = new THREE.Mesh(geo, decalMaterial(s.kind, s.seed));
            mesh.name = `scar-${s.kind}`;
            mesh.renderOrder = 3;
            mesh.receiveShadow = true;
            this.decals.add(mesh);
          } else geo.dispose();
        } finally {
          m.matrixWorld.copy(saved);
        }
      }
    }
  }

  /** The mast broken at the deck and lying where it fell, its sails with it; the boom in the cockpit. */
  private rebuildWreck(d: DamageLook): void {
    for (const c of this.wreck.children) (c as THREE.Mesh).geometry?.dispose();
    this.wreck.clear();
    const down = d.rigParts.down;
    if (!down) return;
    const spar = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.6, roughness: 0.4 });
    const base = new THREE.Vector3(0, this.t.deckY, this.t.mastZ);
    // The stump: a jagged short length above the deck.
    const stumpH = 0.45;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.048, stumpH, 10), spar);
    stump.position.set(0, this.t.deckY + stumpH / 2, this.t.mastZ);
    stump.rotation.z = down === 'stbd' ? -0.12 : down === 'port' ? 0.12 : 0;
    stump.rotation.x = down === 'aft' ? 0.15 : 0;
    stump.name = 'mast-stump';
    this.wreck.add(stump);
    // The rest of the mast: from the break over the rail (or the transom) and then lying on the water, as a
    // spar in the water does; the sails draped from it, flat and wrinkled on the surface, as wet cloth lies.
    const len = this.t.mastLength - stumpH - 0.2;
    const top = base.clone().add(new THREE.Vector3(0, stumpH, 0));
    const sideSign = down === 'stbd' ? 1 : down === 'port' ? -1 : 0;
    const rail = down === 'aft' ? new THREE.Vector3(0.1, this.t.deckY - 0.02, 2.95) : new THREE.Vector3(sideSign * 0.95, this.t.deckY - 0.08, this.t.mastZ + 0.25);
    const along = down === 'aft' ? new THREE.Vector3(0.12, 0, 1).normalize() : new THREE.Vector3(sideSign, 0, 0.22).normalize();
    const first = top.distanceTo(rail);
    const tip = rail.clone().addScaledVector(along, Math.max(1, len - first)).setY(0.04);
    const segment = (a: THREE.Vector3, b: THREE.Vector3, name: string) => {
      const dir = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.042, dir.length(), 12), spar);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.name = name;
      this.wreck.add(m);
    };
    segment(top, rail, 'mast-fallen');
    segment(rail, tip, 'mast-fallen-water');
    // The cloth: along the spar from the rail to its head, spreading aft (the sails' feet), on the water.
    const sail = new THREE.PlaneGeometry(1, 1, 28, 10);
    const pos = sail.getAttribute('position') as THREE.BufferAttribute;
    const r = rand(0.37);
    const aft = down === 'aft' ? new THREE.Vector3(sideSign || -1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const spanLen = rail.distanceTo(tip);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5;
      const v = pos.getY(i) + 0.5;
      const onSpar = rail.clone().lerp(tip, u * 0.95);
      const width = (2.4 * (1 - 0.75 * u) + 0.3) * v;
      const p = onSpar.addScaledVector(aft, width);
      // Hanging from the rail down to the water, then floating: a few centimetres up, sagging between wrinkles.
      const hang = Math.max(0, 1 - (u * spanLen) / 0.9);
      const wrinkle = 0.035 * Math.sin(u * 31 + v * 7) + 0.025 * Math.sin(v * 19 - u * 11) + 0.015 * (r() - 0.5);
      p.y = hang * (this.t.deckY - 0.1) * (1 - 0.6 * v) + (1 - hang) * (0.025 + wrinkle - 0.04 * v * u);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    sail.computeVertexNormals();
    const cloth = new THREE.Mesh(sail, this.t.sailMaterial ?? new THREE.MeshStandardMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide, roughness: 0.85 }));
    cloth.name = 'sails-down';
    this.wreck.add(cloth);
    // The boom, dropped into the cockpit.
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, this.t.boomLength, 10), spar);
    boom.rotation.x = Math.PI / 2 - 0.12;
    boom.rotation.z = 0.08;
    boom.position.set(0.15, this.t.deckY - 0.05, this.t.mastZ + this.t.boomLength / 2 + 0.2);
    boom.name = 'boom-down';
    this.wreck.add(boom);
    this.wreck.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
  }

  private spawnDebris(s: Scar): void {
    const hit = this.surfaceAt(s);
    if (!hit) return;
    const r = rand(s.seed + 0.5);
    const n = s.kind === 'hole' ? 36 : s.kind === 'crack' ? 18 : 8;
    for (let i = 0; i < n && this.debris.length < 64; i++) {
      const v = hit.n.clone().multiplyScalar(1 + 2.5 * r()).add(new THREE.Vector3((r() - 0.5) * 2, 0.8 + 2 * r(), (r() - 0.5) * 2));
      this.debris.push({ p: hit.p.clone(), v, life: 0.8 + 0.8 * r() });
    }
  }

  /** Bring the picture up to the damage; `dt` (s) moves the flying chips. */
  update(d: DamageLook | undefined, dt: number): void {
    const damaged = !!d && (d.scars.length > 0 || d.rigParts.down !== '' || d.rudder > 0 || d.state !== 'afloat');
    if (!damaged) {
      if (this.applied) this.restore();
      this.stepDebris(dt);
      return;
    }
    this.applied = true;
    if (d.version !== this.version) {
      this.version = d.version;
      if (d.scars.length > this.scarCount) for (const s of d.scars.slice(this.scarCount)) if (s.kind !== 'scuff') this.spawnDebris(s);
      this.scarCount = d.scars.length;
      this.rebuildDecals(d);
      this.rebuildWreck(d);
    }
    const down = !!d.rigParts.down;
    for (const o of this.t.rig) o.visible = !down;
    // The rudder: bent (the blade swung aside), or gone.
    this.t.rudder.visible = d.rudder < 1;
    if (this.t.rudderBlade) this.t.rudderBlade.rotation.z = d.rudder < 1 ? 0.3 * d.rudder : 0;
    // Awash or going down: the sea over her deck (the hull no longer keeps it out of the picture).
    if (this.t.waterMask) this.t.waterMask.visible = d.state === 'afloat' || d.state === 'low';
    this.stepDebris(dt);
    this.stepBubbles(d, dt);
  }

  /** Bubbles breaking at the surface over the hull while she floods awash and as she goes down. */
  private stepBubbles(d: DamageLook, dt: number): void {
    const rate = d.state === 'sinking' ? 40 : d.state === 'awash' && d.sinkage < 0.7 ? 6 : 0;
    this.bubbleClock += dt * rate;
    while (this.bubbleClock >= 1 && this.bubbles.length < 96) {
      this.bubbleClock -= 1;
      // The sea's surface in the model's frame is her sinkage above the design waterline.
      const z = (Math.random() - 0.5) * 5.2;
      const x = (Math.random() - 0.5) * 1.6 * Math.cos((z / 5.2) * Math.PI * 0.5);
      // Trimmed bow down, the surface lies higher on the hull forward (the bow is at negative z).
      const y = Math.min(d.sinkage, 4) - z * Math.sin(d.trim) + 0.02;
      this.bubbles.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(0, 0.05, 0), life: 0.5 + Math.random() * 0.9 });
    }
    if (rate === 0) this.bubbleClock = 0;
    let n = 0;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      b.life -= dt;
      if (b.life <= 0) this.bubbles.splice(i, 1);
    }
    for (const b of this.bubbles) {
      const grow = Math.min(1, 1.6 - b.life) * (0.6 + 0.8 * Math.min(1, b.life));
      this.dummy.position.copy(b.p);
      this.dummy.scale.setScalar(Math.max(0.2, grow));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.bubbleMesh.count = n;
    if (n) this.bubbleMesh.instanceMatrix.needsUpdate = true;
  }

  /** Inside water surface (model y), when it shows above the cockpit floor `soleY`; undefined otherwise. */
  static floodLevel(d: DamageLook | undefined, soleY: number): number | undefined {
    if (!d || d.water.main <= 0 || d.state === 'awash' || d.state === 'sinking' || d.state === 'sunk') return undefined;
    const k = FLOOD.compartments.main;
    const y = k.floorZ + d.water.main / (FLOOD.rho * k.area);
    return y > soleY ? y : undefined;
  }

  private stepDebris(dt: number): void {
    let n = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const q = this.debris[i]!;
      q.life -= dt;
      if (q.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      q.v.y -= 9.81 * dt;
      q.p.addScaledVector(q.v, dt);
    }
    for (const q of this.debris) {
      this.dummy.position.copy(q.p);
      this.dummy.rotation.set(q.life * 9, q.life * 7, 0);
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.debrisMesh.count = n;
    if (n) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  private restore(): void {
    for (const c of this.decals.children) (c as THREE.Mesh).geometry.dispose();
    this.decals.clear();
    for (const c of this.wreck.children) (c as THREE.Mesh).geometry?.dispose();
    this.wreck.clear();
    for (const o of this.t.rig) o.visible = true;
    this.t.rudder.visible = true;
    if (this.t.rudderBlade) this.t.rudderBlade.rotation.z = 0;
    if (this.t.waterMask) this.t.waterMask.visible = true;
    this.bubbles.length = 0;
    this.bubbleMesh.count = 0;
    this.version = -1;
    this.scarCount = 0;
    this.applied = false;
  }

  dispose(): void {
    this.restore();
    this.debrisMesh.geometry.dispose();
    (this.debrisMesh.material as THREE.Material).dispose();
    this.bubbleMesh.geometry.dispose();
    (this.bubbleMesh.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
