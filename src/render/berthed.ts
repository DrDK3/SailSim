import * as THREE from 'three';
import { Kit, VMAT, cabin, hull, place } from './vessels';
import { vaneYaw, windexGeometry } from './vane';

/**
 * Boats lying still: in the marinas, alongside the river's pontoons and on the trot moorings. Hundreds of
 * them, so a few reduced-detail models - sloops with their sails furled and covered, motor cruisers - each
 * drawn as one instanced mesh per material and scaled to each boat's length. Near the camera, the detailed
 * models; further off, a plain hull with a mast or a cabin. Visual only; colours and models are estimates (E).
 */

export interface BoatSlot {
  n: number;
  e: number;
  heading: number;
  length: number;
  kind: 'yacht' | 'motor';
  /** Picks the model variant (hull and cover colours). */
  seed: number;
  visible: boolean;
}

/** All models are built 10 m long and scaled. */
const REF = 10;
/** The sloop's mast top (model frame): its wind vane stands here. */
const MAST_TOP = { y: 13.5, z: -0.06 * REF - 0.4 * REF * 0.12 };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function yachtVariant(topsides: number, boot: number, cover: number): THREE.Group {
  const kit = new Kit();
  const L = REF;
  const beam = 3.3;
  const h = hull(kit, {
    length: L, beam, freeboard: 1.0, draft: 0.5, sheerBow: 0.18, stemRake: 0.35, entry: 0.45, transom: 0.85, transomRake: -0.35, flare: 0.06,
    deadrise: 0.35, colours: { bottom: 0x1f2a36, boot, topsides, deck: 0xe9e6dc }, stations: 14, sections: 6,
  });
  const cz = -0.06 * L;
  const cl = 0.4 * L;
  const cy = h.deck(cz) - 0.03;
  cabin(kit, { z: cz, y: cy, length: cl, width: beam - 1.1, height: 0.55, rFront: 0.9, rBack: 0.15, rake: 0.3, tumble: 0.15, colour: 0xffffff, windows: [0.35, 0.72], noBackWindows: true, corner: 2 });
  // Sprayhood folded down, the mast, boom with the mainsail under its cover, furled genoa on the forestay.
  const mz = cz - cl * 0.12;
  const top = MAST_TOP.y;
  kit.add(new THREE.CylinderGeometry(0.07, 0.09, top - cy, 6), VMAT.paint, 0xc8ccd0, place(0, (top + cy) / 2, mz));
  const stem = V(0, h.sheer(-L / 2 + 0.2) + 0.05, -L / 2 + 0.25);
  const head = V(0, top - 0.3, mz);
  const fl = stem.distanceTo(head);
  kit.add(new THREE.CylinderGeometry(0.02, 0.07, fl * 0.92, 5), VMAT.canvas, 0xe8e6de, new THREE.Matrix4().compose(stem.clone().lerp(head, 0.48), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), head.clone().sub(stem).normalize()), V(1, 1, 1)));
  kit.rod(V(0, h.sheer(L / 2) + 0.05, L / 2 - 0.1), V(0, top, mz + 0.05), 0.012, VMAT.paint, 0x9aa0a6, 3);
  for (const s of [-1, 1]) kit.rod(V(s * (h.half(mz) - 0.08), h.sheer(mz), mz + 0.2), V(0, top - 0.4, mz), 0.012, VMAT.paint, 0x9aa0a6, 3);
  const boomY = cy + 1.15;
  kit.add(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 5), VMAT.paint, 0xc8ccd0, place(0, boomY, mz + 2.1, 0, Math.PI / 2));
  kit.add(new THREE.CapsuleGeometry(0.22, 3.6, 2, 6).scale(0.9, 1, 1.2), VMAT.canvas, cover, place(0, boomY + 0.25, mz + 2.0, 0, Math.PI / 2));
  // Guard wires as a thin rail each side; fenders over the side.
  for (const s of [-1, 1]) {
    const wire = h.sheerLine(s, 0.1, 0.05, 0.97).map((p) => p.setY(p.y + 0.6));
    const pts = [0, 0.25, 0.5, 0.75, 1].map((f) => wire[Math.round(f * (wire.length - 1))]!);
    for (let k = 1; k < pts.length; k++) kit.rod(pts[k - 1]!, pts[k]!, 0.012, VMAT.paint, 0xb8bcc0, 3);
    for (const z of [-2, 0.5, 3]) kit.add(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 6), VMAT.paint, 0xf4f4f0, place(s * (h.half(z) + 0.1), h.sheer(z) - 0.35, z));
  }
  return kit.build('berthed-yacht');
}

function motorVariant(topsides: number, stripe: number, flybridge: boolean): THREE.Group {
  const kit = new Kit();
  const L = REF;
  const beam = 3.6;
  const h = hull(kit, {
    length: L, beam, freeboard: 1.35, draft: 0.75, sheerBow: 0.3, sheerStern: -0.05, stemRake: 1.3, entry: 0.42, transom: 0.95, transomRake: 0.25,
    deadrise: 0.33, chine: true, flare: 0.14, colours: { bottom: 0x1f2a36, boot: 0x2b2e33, topsides, deck: 0xf4f3ef, stripe }, bootTop: 0.1, stripe: [0.75, 0.55],
    stations: 14, sections: 6,
  });
  const cz = -0.04 * L;
  const cl = 0.44 * L;
  const cy = h.deck(cz);
  cabin(kit, { z: cz, y: cy, length: cl, width: beam - 0.7, height: 1.15, rFront: 1.1, rBack: 0.2, rake: 1.0, tumble: 0.22, colour: 0xffffff, windows: [0.22, 0.9], front: [0.12, 0.96], noBackWindows: true, roof: { overhang: 0.06, thickness: 0.06 }, corner: 2 });
  if (flybridge) {
    // Flybridge on the cabin roof: helm console, windscreen, bimini.
    const fy = cy + 1.15 + 0.06;
    kit.box(beam - 1.1, 0.35, cl * 0.62, VMAT.paint, 0xffffff, 0, fy + 0.17, cz + cl * 0.12);
    kit.add(new THREE.BoxGeometry(beam - 1.2, 0.3, 0.04), VMAT.glass, undefined, place(0, fy + 0.5, cz - cl * 0.17, 0, -0.5));
    kit.box(beam - 1.0, 0.05, cl * 0.5, VMAT.canvas, 0x2b3a4a, 0, fy + 1.45, cz + cl * 0.15);
    for (const s of [-1, 1]) kit.rod(V(s * (beam / 2 - 0.6), fy + 0.35, cz + cl * 0.38), V(s * (beam / 2 - 0.6), fy + 1.45, cz + cl * 0.38), 0.025, VMAT.steel, undefined, 4);
  }
  kit.box(beam * 0.8, 0.08, 0.9, VMAT.paint, 0xb08a5a, 0, 0.35, L / 2 + 0.45);
  for (const s of [-1, 1]) for (const z of [-1.5, 1.5]) kit.add(new THREE.CylinderGeometry(0.12, 0.12, 0.55, 6), VMAT.paint, 0xf4f4f0, place(s * (h.half(z) + 0.12), h.sheer(z) - 0.4, z));
  return kit.build('berthed-motor');
}

/** Far off: a plain hull (a boat-shaped prism) with a mast or a cabin, vertex-coloured, one mesh each. */
function farModel(kind: 'yacht' | 'motor'): THREE.BufferGeometry {
  const kit = new Kit();
  const L = REF;
  const B = kind === 'yacht' ? 1.65 : 1.8;
  const shape = new THREE.Shape([V(0, -L / 2, 0), V(B * 0.75, -L / 4, 0), V(B, 0, 0), V(B * 0.9, L / 2, 0), V(-B * 0.9, L / 2, 0), V(-B, 0, 0), V(-B * 0.75, -L / 4, 0)].map((p) => new THREE.Vector2(p.x, p.y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: kind === 'yacht' ? 1.0 : 1.35, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // (x, y = along, depth) -> (x, y = -depth .. 0, z = along)
  g.translate(0, kind === 'yacht' ? 1.0 : 1.35, 0);
  kit.add(g, VMAT.paint, 0xf2f1ec);
  if (kind === 'yacht') {
    kit.add(new THREE.BoxGeometry(1.8, 0.5, 4), VMAT.paint, 0xf6f5f0, place(0, 1.2, -0.6));
    kit.add(new THREE.CylinderGeometry(0.06, 0.08, 12.5, 4), VMAT.paint, 0xc8ccd0, place(0, 7.2, -1.1));
  } else {
    kit.add(new THREE.BoxGeometry(2.6, 1.2, 4.4), VMAT.paint, 0xf6f5f0, place(0, 1.9, -0.4));
  }
  const grp = kit.build('far');
  return (grp.children[0] as THREE.Mesh).geometry;
}

const VARIANTS: { kind: 'yacht' | 'motor'; make: () => THREE.Group }[] = [
  { kind: 'yacht', make: () => yachtVariant(0xffffff, 0x1b2a4a, 0x24476e) },
  { kind: 'yacht', make: () => yachtVariant(0x1b2a4a, 0xffffff, 0x24476e) },
  { kind: 'yacht', make: () => yachtVariant(0xf2efe6, 0x8a1c1c, 0x2f5a3a) },
  { kind: 'yacht', make: () => yachtVariant(0xffffff, 0x8a1c1c, 0x7a2626) },
  { kind: 'motor', make: () => motorVariant(0xffffff, 0x2b2e33, true) },
  { kind: 'motor', make: () => motorVariant(0x24364e, 0xffffff, false) },
  { kind: 'motor', make: () => motorVariant(0xffffff, 0x24364e, false) },
];

export class BerthedFleet {
  readonly group = new THREE.Group();
  private readonly slots: BoatSlot[] = [];
  /** Per variant: one instanced mesh per material. */
  private readonly near: THREE.InstancedMesh[][] = [];
  private readonly far: Record<'yacht' | 'motor', THREE.InstancedMesh>;
  /** The sloops' masthead vanes (near ones only), pointing into the wind. */
  private readonly vanes: THREE.InstancedMesh;
  private readonly lastCam = new THREE.Vector3(Infinity, 0, 0);
  private dirty = true;
  private windFrom = 0;

  /**
   * @param capacity most boats at once; `nearRange` (m): detailed models within it (fewer on a software
   * renderer), plain ones out to `farRange`.
   */
  constructor(capacity: number, private readonly nearRange = 420, private readonly farRange = 3000) {
    this.group.name = 'berthed-boats';
    for (const [vi, v] of VARIANTS.entries()) {
      const g = v.make();
      const meshes: THREE.InstancedMesh[] = [];
      for (const c of g.children) {
        const m = c as THREE.Mesh;
        const im = new THREE.InstancedMesh(m.geometry, m.material, capacity);
        im.count = 0;
        im.frustumCulled = false;
        im.receiveShadow = true;
        im.name = `berthed-${v.kind}#${vi}`;
        this.group.add(im);
        meshes.push(im);
      }
      this.near.push(meshes);
    }
    const farMesh = (k: 'yacht' | 'motor') => {
      const im = new THREE.InstancedMesh(farModel(k), VMAT.paint, capacity);
      im.count = 0;
      im.frustumCulled = false;
      im.name = `berthed-far-${k}`;
      this.group.add(im);
      return im;
    };
    this.far = { yacht: farMesh('yacht'), motor: farMesh('motor') };
    this.vanes = new THREE.InstancedMesh(windexGeometry(), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, side: THREE.DoubleSide }), capacity);
    this.vanes.count = 0;
    this.vanes.frustumCulled = false;
    this.vanes.name = 'berthed-vanes';
    this.group.add(this.vanes);
  }

  /** Where the wind comes from (rad, compass); the vanes follow it in steps of a few degrees. */
  setWind(fromDir: number): void {
    const d = Math.abs(Math.atan2(Math.sin(fromDir - this.windFrom), Math.cos(fromDir - this.windFrom)));
    if (d < (3 * Math.PI) / 180) return;
    this.windFrom = fromDir;
    this.dirty = true;
  }

  /** Set (or add) slot i; drawn on the next update. */
  set(i: number, s: BoatSlot): void {
    const o = this.slots[i];
    if (o && o.n === s.n && o.e === s.e && o.heading === s.heading && o.visible === s.visible && o.length === s.length) return;
    this.slots[i] = { ...s };
    this.dirty = true;
  }

  setVisible(i: number, visible: boolean): void {
    const o = this.slots[i];
    if (o && o.visible !== visible) {
      o.visible = visible;
      this.dirty = true;
    }
  }

  get size(): number {
    return this.slots.length;
  }

  /** Assign boats to detailed or plain models by distance from the camera (when it has moved or boats changed). */
  update(camera: THREE.Camera): void {
    const cam = camera.position;
    if (!this.dirty && cam.distanceTo(this.lastCam) < 15) return;
    this.dirty = false;
    this.lastCam.copy(cam);
    const counts = this.near.map(() => 0);
    const farCount = { yacht: 0, motor: 0 };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let vaneCount = 0;
    const qv = new THREE.Quaternion().setFromAxisAngle(up, vaneYaw(this.windFrom));
    const top = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const mv = new THREE.Matrix4();
    const variantsOf = { yacht: VARIANTS.flatMap((v, i) => (v.kind === 'yacht' ? [i] : [])), motor: VARIANTS.flatMap((v, i) => (v.kind === 'motor' ? [i] : [])) };
    const r2 = this.nearRange * this.nearRange;
    const f2 = this.farRange * this.farRange;
    for (const s of this.slots) {
      if (!s || !s.visible) continue;
      // Ground plane distance (the camera's own group offsets do not matter at this scale).
      const dx = s.e - cam.x;
      const dz = -s.n - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > f2) continue;
      q.setFromAxisAngle(up, -s.heading);
      pos.set(s.e, 0, -s.n);
      const k = s.length / REF;
      scl.set(k, k, k);
      m.compose(pos, q, scl);
      if (d2 < r2) {
        const list = variantsOf[s.kind];
        const v = list[s.seed % list.length]!;
        for (const im of this.near[v]!) im.setMatrixAt(counts[v]!, m);
        counts[v]!++;
        if (s.kind === 'yacht') {
          top.set(0, MAST_TOP.y, MAST_TOP.z).applyMatrix4(m);
          this.vanes.setMatrixAt(vaneCount++, mv.compose(top, qv, one));
        }
      } else {
        this.far[s.kind].setMatrixAt(farCount[s.kind]++, m);
      }
    }
    this.near.forEach((meshes, v) => {
      for (const im of meshes) {
        im.count = counts[v]!;
        im.instanceMatrix.needsUpdate = true;
      }
    });
    for (const k of ['yacht', 'motor'] as const) {
      this.far[k].count = farCount[k];
      this.far[k].instanceMatrix.needsUpdate = true;
    }
    this.vanes.count = vaneCount;
    this.vanes.instanceMatrix.needsUpdate = true;
  }

  /** Triangles a full detailed model has (for tests and budgets). */
  static trianglesPerVariant(): number[] {
    return VARIANTS.map((v) => {
      let t = 0;
      for (const c of v.make().children) {
        const g = (c as THREE.Mesh).geometry;
        t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
      return t;
    });
  }
}
