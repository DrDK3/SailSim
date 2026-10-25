import * as THREE from 'three';
import type { DartGeo } from '../sim/geo/dart';
import type { NE } from '../sim/boat/forces';
import type { DartFeatures, ManifestFull } from '../app/geoLoader';
import { ferryStates } from '../app/ferrySchedule';
import type { RiverTraffic } from '../sim/env/traffic';
import { makeLabel } from './labels';
import { TrafficView } from './traffic';

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
  /** The run's river traffic (ferries crabbing in its stream, Dart Marina boats); else ferries alone. */
  traffic?: RiverTraffic;
}

export class DartScene {
  readonly fixed = new THREE.Group();
  readonly floating = new THREE.Group();
  readonly labels = new THREE.Group();
  private readonly mooredHull?: THREE.InstancedMesh;
  private readonly mooredMast?: THREE.InstancedMesh;
  private readonly mooredCabin?: THREE.InstancedMesh;
  private readonly buoys?: THREE.InstancedMesh;
  private readonly traffic = new TrafficView();
  private readonly markLights: { mesh: THREE.Mesh; period: number; flashes: number }[] = [];
  private lastMooringUpdate = -Infinity;
  private readonly features?: DartFeatures;
  private readonly buildingUniforms = { uNight: { value: 0 } };

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

  /**
   * Buildings from the OSM footprints and heights (GEODATA.md). Detail added here is illustrative, not data:
   * hipped roofs on house-sized footprints, windows drawn by the material on every wall (some lit after dark),
   * and painted-render wall colours like those of the Dartmouth and Kingswear waterfronts.
   */
  private buildBuildings(f: DartFeatures): void {
    const tiles = new Map<string, { pos: number[]; nor: number[]; col: number[]; wall: number[] }>();
    // Colours are sRGB (painted render, stone; slate and tile roofs), converted to linear for lighting.
    const lin = (hex: number) => {
      const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      return [c.r, c.g, c.b];
    };
    // Off-white and pastel render, ochre, sandstone and grey stone; mostly slate roofs, some clay tile.
    // Scaled to a painted wall's albedo (about 0.5–0.7): the sun, sky and environment light together would
    // otherwise drive pale render to white.
    const wallPalette = [0xe4ddcc, 0xddc394, 0xd4a49b, 0xa3bccf, 0xdcc56f, 0xafc39b, 0xc4ae90, 0xd2cbbc, 0x9ea4a6, 0xe8e3d8].map((h) => lin(h).map((c) => c * 0.72));
    const roofPalette = [0x2f3338, 0x363a41, 0x3d4148, 0x2b2e33, 0x7f4532, 0x45403c].map(lin);
    const stone = lin(0x9a948a);
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    f.buildings.forEach((b, idx) => {
      const ring = b.r;
      if (ring.length < 3) return;
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cn = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const key = `${Math.floor(cx / 800)},${Math.floor(cn / 800)}`;
      let t = tiles.get(key);
      if (!t) tiles.set(key, (t = { pos: [], nor: [], col: [], wall: [] }));
      const landmark = /castle|church|petrox|saviour|college|chapel/i.test(b.n ?? '') || b.c === 'church' || b.c === 'chapel';
      const wall = landmark ? stone : wallPalette[(idx * 7919) % wallPalette.length]!;
      const roof = landmark ? lin(0x7d786f) : roofPalette[(idx * 104729) % roofPalette.length]!;
      // Windows on ordinary buildings (flag > 0.5; its fraction seeds which windows are lit at night).
      const winFlag = landmark || b.c === 'garage' ? 0 : 1 + ((idx * 37) % 97) / 100;
      const height = b.t - b.b;
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
        // Window bays are centred on each wall (a wall narrower than a bay gets one centred window).
        const u0 = len < WINDOW_BAY_M ? (WINDOW_BAY_M - len) / 2 : -(len % WINDOW_BAY_M) / 2;
        const quad: [number, number, number, number, number][] = [
          [e0, b.b, -n0, u0, 0], [e1, b.b, -n1, u0 + len, 0], [e1, b.t, -n1, u0 + len, height],
          [e0, b.b, -n0, u0, 0], [e1, b.t, -n1, u0 + len, height], [e0, b.t, -n0, u0, height],
        ];
        for (const [x, y, z, u, h] of quad) {
          t.pos.push(x, y, z);
          t.nor.push(nx, 0, nz);
          t.col.push(...wall);
          t.wall.push(u, h, height, winFlag);
        }
      }
      const tri = (a: number[], b2: number[], c: number[]) => {
        // Flat-shaded roof triangle, wound to face up.
        v.set(b2[0]! - a[0]!, b2[1]! - a[1]!, b2[2]! - a[2]!);
        w.set(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!);
        const nrm = v.cross(w);
        if (nrm.lengthSq() < 1e-10) return;
        nrm.normalize();
        const verts = nrm.y >= 0 ? [a, b2, c] : [a, c, b2];
        if (nrm.y < 0) nrm.negate();
        for (const p of verts) {
          t.pos.push(p[0]!, p[1]!, p[2]!);
          t.nor.push(nrm.x, nrm.y, nrm.z);
          t.col.push(...roof);
          t.wall.push(0, 0, 0, 0);
        }
      };
      const ridge = !landmark && pts.length <= 8 && Math.abs(area) / 2 <= 400 && height >= 3.5 && b.c !== 'garage' ? hipRidge(pts) : undefined;
      if (ridge) {
        // Hipped roof: every eave edge rises to its nearest point on the ridge (E: pitch about 30°).
        const rise = Math.min(3.5, Math.max(1.0, 0.55 * ridge.halfWidth));
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i]!;
          const p1 = pts[(i + 1) % pts.length]!;
          const r0 = ridge.at(p0);
          const r1 = ridge.at(p1);
          const a = [p0[0], b.t, -p0[1]];
          const c = [p1[0], b.t, -p1[1]];
          const ra = [r0[0], b.t + rise, -r0[1]];
          const rc = [r1[0], b.t + rise, -r1[1]];
          tri(a, c, rc);
          tri(a, rc, ra);
        }
      } else {
        const contour = pts.map(([e, n]) => new THREE.Vector2(e, n));
        for (const tr of THREE.ShapeUtils.triangulateShape(contour, [])) {
          const [p0, p1, p2] = [pts[tr[0]!]!, pts[tr[1]!]!, pts[tr[2]!]!];
          tri([p0[0], b.t, -p0[1]], [p1[0], b.t, -p1[1]], [p2[0], b.t, -p2[1]]);
        }
      }
    });
    const mat = buildingMaterial(this.buildingUniforms);
    for (const t of tiles.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setAttribute('aWall', new THREE.Float32BufferAttribute(t.wall, 4));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'buildings';
      this.fixed.add(mesh);
    }
  }

  /** 0 by day … 1 at night: lights some windows (src/render/scene.ts passes the sun's daylight). */
  setDaylight(day: number): void {
    this.traffic.setDaylight(day);
    const x = Math.min(1, Math.max(0, (0.55 - day) / 0.4));
    this.buildingUniforms.uNight.value = x * x * (3 - 2 * x);
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

  /** Vessels are drawn by the traffic view; the Higher Ferry's guide cables are fixed, just under the surface. */
  private buildFerries(f: DartFeatures): void {
    this.floating.add(this.traffic.group);
    const cable = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.6, metalness: 0.4 });
    for (const fr of f.ferries.filter((x) => /Higher Ferry/.test(x.name))) {
      const [a, b] = [fr.route[0]!, fr.route[fr.route.length - 1]!];
      const dx = b[0] - a[0];
      const dn = b[1] - a[1];
      const len = Math.hypot(dx, dn);
      const off = { e: (-dn / len) * 5, n: (dx / len) * 5 };
      for (const s of [-1, 1]) {
        const pts = [0, 0.15, 0.5, 0.85, 1].map((t) => new THREE.Vector3(a[0] + dx * t + s * off.e, t === 0 || t === 1 ? 0.2 : -0.08, -(a[1] + dn * t + s * off.n)));
        this.floating.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.06, 5, false), cable));
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
      lab.userData.priority = 0;
      this.labels.add(lab);
    }
  }

  private buildLabels(f: DartFeatures): void {
    for (const l of f.landmarks) {
      const s = makeLabel(l.name, '#ffffff');
      const h = this.input.geo.bedElevation(l.n, l.e);
      s.position.set(l.e, h + 25, -l.n);
      s.userData.fixedToLand = true;
      s.userData.priority = 1;
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
      const states = u.traffic ? u.traffic.states(u.epochMs) : ferryStates(this.features.ferries, u.epochMs);
      this.traffic.update(states, u.time, u.camera, u.showLabels);
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

    if (u.showLabels) this.declutter(u.camera);
  }

  /**
   * Hide labels that would overlap one already shown on screen: navigation marks first, then landmarks, then
   * ferries; nearer before farther. Sprites are drawn at a fixed screen size (sizeAttenuation off), so their
   * extent in normalised device coordinates is ½·scale·P (P = the projection's x or y scale).
   */
  private declutter(camera: THREE.Camera): void {
    const shown: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const cand: { s: THREE.Object3D; pri: number; d: number; p: THREE.Vector3 }[] = [];
    const sprites = [...this.labels.children, ...this.traffic.labels()];
    for (const s of sprites) {
      if (!s.visible) continue;
      const p = s.getWorldPosition(new THREE.Vector3());
      cand.push({ s, pri: (s.userData.priority as number | undefined) ?? 1, d: p.distanceToSquared(camera.position), p });
    }
    cand.sort((a, b) => a.pri - b.pri || a.d - b.d);
    const P = camera.projectionMatrix.elements;
    for (const c of cand) {
      const ndc = c.p.project(camera);
      if (ndc.z > 1 || ndc.z < -1) continue; // behind the camera or beyond the far plane: not drawn anyway
      const hw = 0.5 * c.s.scale.x * P[0]! + 0.004;
      const hh = 0.5 * c.s.scale.y * P[5]! + 0.004;
      const r = { x0: ndc.x - hw, x1: ndc.x + hw, y0: ndc.y - hh, y1: ndc.y + hh };
      if (shown.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) c.s.visible = false;
      else shown.push(r);
    }
  }
}

/** Width of one window bay along a wall, and storey height (m): typical of the terraces (E). */
const WINDOW_BAY_M = 3.0;
const STOREY_M = 2.8;

/**
 * The ridge of a hipped roof over a footprint: along the footprint's long axis (principal axis of its
 * corners), through its centre, shortened at each end by half the width so the hips slope like the sides.
 */
function hipRidge(pts: [number, number][]): { halfWidth: number; at: (p: [number, number]) => [number, number] } | undefined {
  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p[0], 0) / n;
  const cy = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(ang);
  const ay = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  let wlo = Infinity;
  let whi = -Infinity;
  for (const [x, y] of pts) {
    const u = (x - cx) * ax + (y - cy) * ay;
    const v = -(x - cx) * ay + (y - cy) * ax;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
    wlo = Math.min(wlo, v);
    whi = Math.max(whi, v);
  }
  const halfWidth = (whi - wlo) / 2;
  if (!(halfWidth > 0.5)) return undefined;
  const mu = (lo + hi) / 2;
  const mv = (wlo + whi) / 2;
  const halfRidge = Math.max(0, (hi - lo) / 2 - halfWidth);
  const ox = cx + mu * ax - mv * ay;
  const oy = cy + mu * ay + mv * ax;
  return {
    halfWidth,
    at: ([x, y]) => {
      const u = Math.min(halfRidge, Math.max(-halfRidge, (x - ox) * ax + (y - oy) * ay));
      return [ox + u * ax, oy + u * ay];
    },
  };
}

/**
 * Walls and roofs with vertex colours, plus windows drawn per fragment from each wall's (u along the wall,
 * height above the base) coordinates: a grid of bays and storeys, dark glass by day, some lit warm at night.
 */
function buildingMaterial(uniforms: { uNight: { value: number } }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWall;\nvarying vec4 vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec4 vWall;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float winLit = 0.0;
        if (vWall.w > 0.5) {
          float bay = floor(vWall.x / ${WINDOW_BAY_M.toFixed(1)});
          float storey = floor(vWall.y / ${STOREY_M.toFixed(1)});
          float fu = fract(vWall.x / ${WINDOW_BAY_M.toFixed(1)});
          float fv = fract(vWall.y / ${STOREY_M.toFixed(1)});
          float inWin = step(0.3, fu) * step(fu, 0.7) * step(0.3, fv) * step(fv, 0.8) * step(0.7, vWall.y) * step(vWall.y, vWall.z - 0.5);
          float frame = inWin * (1.0 - step(0.33, fu) * step(fu, 0.67) * step(0.34, fv) * step(fv, 0.76));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.085, 0.1), inWin - frame);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.92, 0.9), frame);
          float seed = fract(vWall.w) * 61.0;
          winLit = (inWin - frame) * step(0.6, fract(sin(dot(vec2(bay + seed, storey + seed * 1.7), vec2(12.9898, 78.233))) * 43758.5453));
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * 1.6 * winLit * uNight;');
  };
  return mat;
}
