import * as THREE from 'three';
import type { DartGeo } from '../sim/geo/dart';
import type { NE } from '../sim/boat/forces';
import type { DartFeatures, ManifestFull } from '../app/geoLoader';
import { ferryStates } from '../app/ferrySchedule';
import { makeLabel } from './labels';

/**
 * The River Dart scene, built from public/geo (see docs/GEODATA.md). Vertical frame: the water surface stays
 * at y = 0 (the boat, wake and waves are unchanged), so everything fixed to the land is drawn at
 * y = elevation(ODN) − water level: the `fixed` group moves down as the tide rises. Floating things
 * (pontoons, moorings, ferries, buoys) are in the `floating` group at the surface.
 */
const CHUNK = 64;
const FAR_LOD_M = 1400;
const SUBMERGED_ODN = -3.6; // chunks entirely below this never show (below the lowest tides)
const FIXED_DECK_ODN = 3.0; // E: deck level of fixed jetties and quays
const LABEL_RANGE_M = 1600;
const FERRY_LABEL_RANGE_M = 900;

export interface DartSceneInput {
  manifest: ManifestFull;
  geo: DartGeo;
  features?: DartFeatures;
  drape?: TexImageSource;
}

export interface DartUpdate {
  waterLevel: number;
  epochMs: number;
  time: number;
  camera: THREE.Camera;
  stream: (n: number, e: number) => NE;
  windFromDir: number;
  showLabels: boolean;
}

export class DartScene {
  readonly fixed = new THREE.Group();
  readonly floating = new THREE.Group();
  readonly labels = new THREE.Group();
  private readonly mooredHull?: THREE.InstancedMesh;
  private readonly mooredMast?: THREE.InstancedMesh;
  private readonly mooredCabin?: THREE.InstancedMesh;
  private readonly buoys?: THREE.InstancedMesh;
  private readonly ferryMeshes: { mesh: THREE.Group; label?: THREE.Sprite }[] = [];
  private readonly markLights: { mesh: THREE.Mesh; period: number; flashes: number }[] = [];
  private lastMooringUpdate = -Infinity;
  private readonly features?: DartFeatures;

  constructor(private readonly input: DartSceneInput) {
    this.fixed.name = 'dart-fixed';
    this.floating.name = 'dart-floating';
    this.features = input.features;
    this.buildTerrain();
    const f = input.features;
    if (f) {
      this.buildBuildings(f);
      this.buildPiers(f);
      const m = this.buildMoorings(f);
      this.mooredHull = m.hull;
      this.mooredMast = m.mast;
      this.mooredCabin = m.cabin;
      this.buoys = m.buoys;
      this.buildFerries(f);
      this.buildMarks(f);
      this.buildLabels(f);
    }
  }

  // ------------------------------------------------------------------ terrain

  private buildTerrain(): void {
    const g = this.input.geo.elevation;
    const d = this.input.manifest.drape;
    let material: THREE.Material;
    if (this.input.drape) {
      const tex = new THREE.Texture(this.input.drape);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      // The satellite colours already contain sunlight: scale the albedo down so the scene's lights don't double it.
      material = new THREE.MeshStandardMaterial({ map: tex, color: 0x8a8a8a, roughness: 1, metalness: 0, envMapIntensity: 0.25 });
    } else {
      material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    }
    const z = (i: number, j: number) => g.values[Math.min(j, g.ny - 1) * g.nx + Math.min(i, g.nx - 1)]!;
    const width = d.nx * d.cell;
    const height = d.ny * d.cell;
    for (let j0 = 0; j0 < g.ny - 1; j0 += CHUNK) {
      for (let i0 = 0; i0 < g.nx - 1; i0 += CHUNK) {
        const i1 = Math.min(i0 + CHUNK, g.nx - 1);
        const j1 = Math.min(j0 + CHUNK, g.ny - 1);
        let max = -Infinity;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) max = Math.max(max, z(i, j));
        if (max < SUBMERGED_ODN) continue;
        const lod = new THREE.LOD();
        for (const [step, dist] of [[1, 0], [4, FAR_LOD_M]] as const) {
          lod.addLevel(new THREE.Mesh(this.chunkGeometry(i0, j0, i1, j1, step, width, height, !this.input.drape), material), dist);
        }
        lod.name = 'terrain';
        this.fixed.add(lod);
      }
    }
  }

  private chunkGeometry(i0: number, j0: number, i1: number, j1: number, step: number, width: number, height: number, colours: boolean): THREE.BufferGeometry {
    const g = this.input.geo.elevation;
    const d = this.input.manifest.drape;
    const zi = (i: number, j: number) => g.values[Math.max(0, Math.min(j, g.ny - 1)) * g.nx + Math.max(0, Math.min(i, g.nx - 1))]!;
    const is: number[] = [];
    for (let i = i0; i < i1; i += step) is.push(i);
    is.push(i1);
    const js: number[] = [];
    for (let j = j0; j < j1; j += step) js.push(j);
    js.push(j1);
    const cols = is.length;
    const rows = js.length;
    // Grid vertices, then a skirt ring (hangs 20 m down) that hides cracks between LOD levels.
    const count = cols * rows + 2 * (cols + rows);
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const col = colours ? new Float32Array(count * 3) : undefined;
    let k = 0;
    const put = (i: number, j: number, drop: number) => {
      const e = g.e0 + (i + 0.5) * g.cell;
      const n = g.n0 + (j + 0.5) * g.cell;
      const h = zi(i, j);
      pos.set([e, h - drop, -n], k * 3);
      const dzde = (zi(i + 1, j) - zi(i - 1, j)) / (2 * g.cell);
      const dzdn = (zi(i, j + 1) - zi(i, j - 1)) / (2 * g.cell);
      const nv = new THREE.Vector3(-dzde, 1, dzdn).normalize();
      nor.set([nv.x, nv.y, nv.z], k * 3);
      uv.set([(e - d.e0) / width, (n - d.n0) / height], k * 2);
      if (col) {
        const c = h < -2 ? [0.25, 0.4, 0.45] : h < 2.5 ? [0.6, 0.55, 0.42] : [0.38 + Math.min(h, 120) / 600, 0.48, 0.3];
        col.set(c, k * 3);
      }
      return k++;
    };
    for (const j of js) for (const i of is) put(i, j, 0);
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    const skirt = (edge: number[]) => {
      const start = k;
      for (const v of edge) {
        const i = is[v % cols]!;
        const j = js[Math.floor(v / cols)]!;
        put(i, j, 20);
      }
      for (let q = 0; q < edge.length - 1; q++) {
        const a = edge[q]!;
        const b = edge[q + 1]!;
        idx.push(a, start + q, b, b, start + q, start + q + 1);
        idx.push(a, b, start + q, b, start + q + 1, start + q);
      }
    };
    skirt(Array.from({ length: cols }, (_, c) => c));
    skirt(Array.from({ length: cols }, (_, c) => (rows - 1) * cols + c));
    skirt(Array.from({ length: rows }, (_, r) => r * cols));
    skirt(Array.from({ length: rows }, (_, r) => r * cols + cols - 1));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, k * 2), 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // ---------------------------------------------------------------- buildings

  private buildBuildings(f: DartFeatures): void {
    const tiles = new Map<string, { pos: number[]; nor: number[]; col: number[] }>();
    // Colours are sRGB (rendered, painted and stone walls; slate and tile roofs), converted to linear for lighting.
    const lin = (hex: number) => {
      const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      return [c.r, c.g, c.b];
    };
    const wallPalette = [0xc4bdae, 0xd0cbc0, 0xb3ada2, 0xc2b69f, 0xa9adae, 0xcabea8, 0xa49a89].map(lin);
    const roofPalette = [0x4a4f57, 0x55565c, 0x7a4a3a, 0x4d4542, 0x5f5a55].map(lin);
    const stone = lin(0x9a948a);
    f.buildings.forEach((b, idx) => {
      const ring = b.r;
      if (ring.length < 3) return;
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cn = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const key = `${Math.floor(cx / 800)},${Math.floor(cn / 800)}`;
      let t = tiles.get(key);
      if (!t) tiles.set(key, (t = { pos: [], nor: [], col: [] }));
      const landmark = /castle|church|petrox|saviour|college|chapel/i.test(b.n ?? '') || b.c === 'church' || b.c === 'chapel';
      const wall = landmark ? stone : wallPalette[(idx * 7919) % wallPalette.length]!;
      const roof = landmark ? lin(0x7d786f) : roofPalette[(idx * 104729) % roofPalette.length]!;
      // Counter-clockwise check (in e,n) so that wall normals face out.
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [e0, n0] = ring[i]!;
        const [e1, n1] = ring[(i + 1) % ring.length]!;
        area += e0 * n1 - e1 * n0;
      }
      const pts = area >= 0 ? ring : [...ring].reverse();
      for (let i = 0; i < pts.length; i++) {
        const [e0, n0] = pts[i]!;
        const [e1, n1] = pts[(i + 1) % pts.length]!;
        const len = Math.hypot(e1 - e0, n1 - n0);
        if (len < 1e-6) continue;
        // Outward normal of a CCW ring edge in (e, n) is (dn, −de); in three.js (x = e, z = −n).
        const nx = (n1 - n0) / len;
        const nz = (e1 - e0) / len;
        const quad = [[e0, b.b, -n0], [e1, b.b, -n1], [e1, b.t, -n1], [e0, b.b, -n0], [e1, b.t, -n1], [e0, b.t, -n0]];
        for (const q of quad) {
          t.pos.push(...q);
          t.nor.push(nx, 0, nz);
          t.col.push(...wall);
        }
      }
      const contour = pts.map(([e, n]) => new THREE.Vector2(e, n));
      for (const tri of THREE.ShapeUtils.triangulateShape(contour, [])) {
        // CCW in (e, n) seen from above is CCW in three.js seen from +y (x = e, z = −n): faces up.
        for (const vi of [tri[0]!, tri[1]!, tri[2]!]) {
          const p = pts[vi]!;
          t.pos.push(p[0], b.t, -p[1]);
          t.nor.push(0, 1, 0);
          t.col.push(...roof);
        }
      }
    });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 });
    for (const t of tiles.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'buildings';
      this.fixed.add(mesh);
    }
  }

  // ------------------------------------------------------------- piers etc.

  private buildPiers(f: DartFeatures): void {
    const deck = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
    const pontoon = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.8 });
    const fixedBoxes: THREE.Matrix4[] = [];
    const floatBoxes: THREE.Matrix4[] = [];
    for (const p of f.piers) {
      if ('line' in p) {
        for (let i = 0; i < p.line.length - 1; i++) {
          const [e0, n0] = p.line[i]!;
          const [e1, n1] = p.line[i + 1]!;
          const len = Math.hypot(e1 - e0, n1 - n0);
          if (len < 0.5) continue;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3((e0 + e1) / 2, p.floating ? 0.2 : FIXED_DECK_ODN - 0.3, -(n0 + n1) / 2),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(e1 - e0, n1 - n0)),
            new THREE.Vector3(p.width, p.floating ? 0.5 : 0.6, len + p.width * 0.5),
          );
          (p.floating ? floatBoxes : fixedBoxes).push(m);
        }
      } else {
        const shape = new THREE.Shape(p.poly.map(([e, n]) => new THREE.Vector2(e, n)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: p.floating ? 0.5 : 0.8, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // (e, n, depth) -> (x = e, y = depth, z = -n)
        const mesh = new THREE.Mesh(geo, p.floating ? pontoon : deck);
        mesh.position.y = p.floating ? -0.1 : FIXED_DECK_ODN - 0.8;
        mesh.name = 'pier';
        (p.floating ? this.floating : this.fixed).add(mesh);
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const [list, mat, group] of [[fixedBoxes, deck, this.fixed], [floatBoxes, pontoon, this.floating]] as const) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(box, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.name = 'pontoons';
      group.add(im);
    }
  }

  private buildMoorings(f: DartFeatures) {
    const count = f.moorings.length;
    const hullGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1);
    hullGeo.rotateX(Math.PI / 2); // along z
    hullGeo.scale(0.33, 0.9, 1); // unit length, ~1/3 beam
    const mastGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 5);
    mastGeo.translate(0, 0.5, 0);
    const cabinGeo = new THREE.BoxGeometry(0.28, 0.25, 0.35);
    const hull = new THREE.InstancedMesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.5 }), count);
    const mast = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.4, roughness: 0.4 }), count);
    const cabin = new THREE.InstancedMesh(cabinGeo, new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 }), count);
    const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }), count);
    for (const m of [hull, mast, cabin, buoys]) {
      m.name = 'moorings';
      m.frustumCulled = false;
      this.floating.add(m);
    }
    return { hull, mast, cabin, buoys };
  }

  private updateMoorings(stream: (n: number, e: number) => NE, windFromDir: number): void {
    const f = this.features;
    if (!f || !this.mooredHull || !this.mooredMast || !this.mooredCabin || !this.buoys) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let masts = 0;
    let cabins = 0;
    f.moorings.forEach((b, i) => {
      // Boats on a mooring lie head to the stream; in slack water, head to the wind.
      const c = stream(b.n, b.e);
      const sp = Math.hypot(c.n, c.e);
      const bowTo = sp > 0.08 ? Math.atan2(-c.e, -c.n) : windFromDir + ((b.h % 30) - 15) * (Math.PI / 180);
      q.setFromAxisAngle(up, -bowTo);
      // The buoy is at the bow end of the chain; the boat lies downstream of it.
      const back = new THREE.Vector3(-Math.sin(bowTo), 0, Math.cos(bowTo)).multiplyScalar(b.l * 0.5 + 2);
      const pos = new THREE.Vector3(b.e, 0.15, -b.n).add(back);
      m.compose(pos, q, new THREE.Vector3(b.l, b.l * 0.12, b.l));
      this.mooredHull!.setMatrixAt(i, m);
      if (b.k !== 'motor') {
        m.compose(pos, q, new THREE.Vector3(1, b.l * 1.25, 1));
        this.mooredMast!.setMatrixAt(masts++, m);
      } else {
        const cab = pos.clone().add(new THREE.Vector3(0, b.l * 0.12, 0));
        m.compose(cab, q, new THREE.Vector3(b.l, b.l, b.l));
        this.mooredCabin!.setMatrixAt(cabins++, m);
      }
      m.makeTranslation(b.e, 0.05, -b.n);
      this.buoys!.setMatrixAt(i, m);
    });
    this.mooredMast.count = masts;
    this.mooredCabin.count = cabins;
    for (const im of [this.mooredHull, this.mooredMast, this.mooredCabin, this.buoys]) im.instanceMatrix.needsUpdate = true;
  }

  private buildFerries(f: DartFeatures): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x24426b, roughness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    for (const fr of f.ferries) {
      for (let u = 0; u < fr.units; u++) {
        const g = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(fr.beam, 1.4, fr.length), hullMat);
        hull.position.y = 0.3;
        const house = new THREE.Mesh(new THREE.BoxGeometry(Math.min(3, fr.beam * 0.5), 2.2, Math.min(4, fr.length * 0.25)), topMat);
        house.position.set(fr.beam * 0.25, 2.0, 0);
        g.add(hull, house);
        g.name = 'ferry';
        this.floating.add(g);
        const label = makeLabel(`${fr.label}${fr.ram ? ' · RAM' : ''}`, fr.ram ? '#ffd28a' : '#ffffff');
        label.position.y = 6;
        g.add(label);
        this.ferryMeshes.push({ mesh: g, label });
      }
    }
  }

  private buildMarks(f: DartFeatures): void {
    for (const mk of f.marks) {
      const green = /starboard/i.test(mk.kind);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 16), new THREE.MeshStandardMaterial({ color: green ? 0x1f8f3a : 0xc0282d, roughness: 0.6 }));
      body.position.y = 1.0;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: green ? 0x33ff66 : 0xff3333, emissiveIntensity: 0 }));
      light.position.y = 2.35;
      g.add(body, light);
      g.position.set(mk.e, 0, -mk.n);
      g.name = 'mark';
      this.floating.add(g);
      const m = /Fl(?:\((\d+)\))?\s*\w*\s*(\d+)s/.exec(mk.light);
      this.markLights.push({ mesh: light, flashes: m?.[1] ? Number(m[1]) : 1, period: m?.[2] ? Number(m[2]) : 5 });
      const lab = makeLabel(`${mk.name} (${mk.light})`, '#bff5c8');
      lab.position.set(mk.e, 5, -mk.n);
      this.labels.add(lab);
    }
  }

  private buildLabels(f: DartFeatures): void {
    for (const l of f.landmarks) {
      const s = makeLabel(l.name, '#ffffff');
      const h = this.input.geo.bedElevation(l.n, l.e);
      s.position.set(l.e, h + 25, -l.n);
      s.userData.fixedToLand = true;
      this.labels.add(s);
    }
  }

  // ------------------------------------------------------------------ update

  update(u: DartUpdate): void {
    this.fixed.position.y = -u.waterLevel;
    for (const l of this.labels.children) l.position.y = (l.userData.baseY ??= l.position.y) - (l.userData.fixedToLand ? u.waterLevel : 0);
    if (u.time - this.lastMooringUpdate > 2) {
      this.lastMooringUpdate = u.time;
      this.updateMoorings(u.stream, u.windFromDir);
    }
    if (this.features) {
      const states = ferryStates(this.features.ferries, u.epochMs);
      states.forEach((s, i) => {
        const fm = this.ferryMeshes[i];
        if (!fm) return;
        fm.mesh.position.set(s.e, 0, -s.n);
        fm.mesh.rotation.y = -s.heading;
      });
    }
    // Lights: flash groups within the period (e.g. Fl G 5s: one 0.5 s flash every 5 s).
    for (const ml of this.markLights) {
      const ph = (u.epochMs / 1000) % ml.period;
      const on = ph < ml.flashes * 1.0 && ph % 1.0 < 0.5;
      (ml.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0;
    }
    const cam = u.camera.position;
    this.labels.visible = u.showLabels;
    for (const l of this.labels.children) l.visible = u.showLabels && l.position.distanceTo(cam) < LABEL_RANGE_M;
    for (const fm of this.ferryMeshes) if (fm.label) fm.label.visible = u.showLabels && fm.mesh.position.distanceTo(cam) < FERRY_LABEL_RANGE_M;
  }
}
