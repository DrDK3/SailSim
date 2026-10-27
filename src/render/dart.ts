import * as THREE from 'three';
import type { DartGeo } from '../sim/geo/dart';
import type { NE } from '../sim/boat/forces';
import type { DartFeatures, ManifestFull } from '../app/geoLoader';
import { ferryStates } from '../app/ferrySchedule';
import { berthOccupancy, type Berth } from '../sim/env/marinas';
import { BerthedFleet } from './berthed';
import { RailwayView } from './railway';
import { dartBerths, type RiverTraffic } from '../sim/env/traffic';
import { makeLabel } from './labels';
import { TrafficView } from './traffic';
import { Woodland } from './trees';
import { BUMP_GLSL, bumpBlock } from './bump';
import { StreetLife, TOWNS, buildRoadSurfaces, type RoadsData } from './population';
import { Kit, NOSS, WIN, battlements, buildExtra, corniceBalustrade, insetRingAdaptive, landmarkFor, longAxisDeg, simplifyRing, type Look } from './landmarks';

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
  /** Finer ground over the towns (4 m), drawn in place of the 8 m grid there. */
  town?: { spec: { cell: number; nx: number; ny: number; e0: number; n0: number }; values: Float32Array };
  /** Signed distance to tidal water (watermask.png): the water surface is drawn only near tidal water. */
  waterMask?: { spec: { cell: number; nx: number; ny: number; e0: number; n0: number }; image: TexImageSource };
  /** 'low' (a software renderer): detailed boats nearer the camera, sleepers only at the station. */
  detail?: 'high' | 'low';
  /** Roads and footways: their surfaces, and cars and people on them (illustrative). */
  roads?: RoadsData;
}

/** Where the water surface may be drawn: a distance texture over a box (e0, n0, width, height in m). */
export interface WaterMask {
  texture: THREE.Texture;
  box: THREE.Vector4;
}

export interface DartUpdate {
  waterLevel: number;
  epochMs: number;
  time: number;
  camera: THREE.Camera;
  stream: (n: number, e: number) => NE;
  windFromDir: number;
  /** True wind speed at the surface (m/s), for the flags and vanes. */
  windSpeed?: number;
  showLabels: boolean;
  /** The run's river traffic (ferries crabbing in its stream, Dart Marina boats); else ferries alone. */
  traffic?: RiverTraffic;
}

export class DartScene {
  readonly fixed = new THREE.Group();
  readonly floating = new THREE.Group();
  readonly labels = new THREE.Group();
  /** Boats on the trot moorings (first) and in the marinas and on the pontoons (after). */
  private readonly boats?: BerthedFleet;
  private readonly berths: readonly Berth[] = [];
  private readonly buoys?: THREE.InstancedMesh;
  private readonly traffic = new TrafficView();
  private readonly markLights: { mesh: THREE.Mesh; period: number; flashes: number }[] = [];
  private lastMooringUpdate = -Infinity;
  private readonly features?: DartFeatures;
  private readonly buildingUniforms = { uNight: { value: 0 } };
  /** For the water surface (scene.ts): tidal water and its banks, so low ground inland stays dry. */
  readonly waterMask?: WaterMask;
  private readonly woodland?: Woodland;
  private readonly railway?: RailwayView;
  private readonly street?: StreetLife;

  constructor(private readonly input: DartSceneInput) {
    this.fixed.name = 'dart-fixed';
    this.floating.name = 'dart-floating';
    this.features = input.features;
    const wm = input.waterMask;
    if (wm) {
      const texture = new THREE.Texture(wm.image);
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      const s = wm.spec;
      this.waterMask = { texture, box: new THREE.Vector4(s.e0, s.n0, s.nx * s.cell, s.ny * s.cell) };
    }
    this.buildTerrain();
    const f = input.features;
    if (f) {
      this.buildBuildings(f);
      this.buildPiers(f);
      this.berths = dartBerths({ piers: f.piers, marinas: f.marinas ?? [], geo: input.geo });
      const low = input.detail === 'low';
      this.boats = new BerthedFleet(f.moorings.length + this.berths.length, low ? 150 : 420, low ? 1500 : 3000);
      this.floating.add(this.boats.group);
      this.buoys = this.buildMoorings(f);
      const month = new Date().getUTCMonth();
      this.berths.forEach((b, i) =>
        this.boats!.set(f.moorings.length + i, { n: b.n, e: b.e, heading: b.heading, length: b.length, kind: b.kind, seed: b.id * 7 + 3, visible: b.u < berthOccupancy(b.style, month) }),
      );
      this.buildFerries(f);
      if (f.railway) {
        this.railway = new RailwayView(f.railway, (e, n) => this.groundAt(e, n), input.detail);
        this.fixed.add(this.railway.group);
      }
      this.buildMarks(f);
      this.buildLabels(f);
    }
    if (input.roads) {
      this.fixed.add(buildRoadSurfaces(input.roads, (e, n) => this.groundAt(e, n)));
      this.street = new StreetLife({ roads: input.roads, groundAt: (e, n) => this.groundAt(e, n), standing: f ? standingSpots(f) : [], detail: input.detail });
      this.fixed.add(this.street.fixed);
      this.floating.add(this.street.floating);
    }
    const pixels = input.drape ? drapePixels(input.drape) : undefined;
    if (pixels) {
      this.woodland = new Woodland({ pixels, drape: input.manifest.drape, groundAt: (e, n) => this.groundAt(e, n), buildings: f?.buildings.map((b) => b.r) });
      this.fixed.add(this.woodland.group);
    }
  }

  // ------------------------------------------------------------------ terrain

  /** Ground (m ODN) as the picture draws it: the towns' 4 m grid where there is one, else the 8 m grid. */
  groundAt(e: number, n: number): number {
    const town = this.input.town;
    if (town) {
      const t = town.spec;
      const x = (e - t.e0) / t.cell - 0.5;
      const y = (n - t.n0) / t.cell - 0.5;
      if (x >= 0 && y >= 0 && x < t.nx - 1 && y < t.ny - 1) {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const fx = x - i;
        const fy = y - j;
        const v = town.values;
        const k = j * t.nx + i;
        return (v[k]! * (1 - fx) + v[k + 1]! * fx) * (1 - fy) + (v[k + t.nx]! * (1 - fx) + v[k + t.nx + 1]! * fx) * fy;
      }
    }
    return this.input.geo.bedElevation(n, e);
  }

  private get townBox(): { eMin: number; eMax: number; nMin: number; nMax: number } | undefined {
    const t = this.input.town?.spec;
    return t ? { eMin: t.e0, eMax: t.e0 + t.nx * t.cell, nMin: t.n0, nMax: t.n0 + t.ny * t.cell } : undefined;
  }

  /** The towns' finer ground (4 m LIDAR), in chunks with a far LOD and skirts, sharing the drape material. */
  private buildTownTerrain(material: THREE.Material): void {
    const town = this.input.town;
    if (!town) return;
    const t = town.spec;
    const d = this.input.manifest.drape;
    const width = d.nx * d.cell;
    const height = d.ny * d.cell;
    const z = (i: number, j: number) => town.values[Math.max(0, Math.min(j, t.ny - 1)) * t.nx + Math.max(0, Math.min(i, t.nx - 1))]!;
    const C = 64;
    for (let j0 = 0; j0 < t.ny - 1; j0 += C) {
      for (let i0 = 0; i0 < t.nx - 1; i0 += C) {
        const i1 = Math.min(i0 + C, t.nx - 1);
        const j1 = Math.min(j0 + C, t.ny - 1);
        const lod = new THREE.LOD();
        // Full 4 m detail only near the camera; 8 m, then 16 m further off.
        for (const [step, dist] of [[1, 0], [2, 450], [4, FAR_LOD_M]] as const) {
          const is: number[] = [];
          for (let i = i0; i < i1; i += step) is.push(i);
          is.push(i1);
          const js: number[] = [];
          for (let j = j0; j < j1; j += step) js.push(j);
          js.push(j1);
          const cols = is.length;
          const rows = js.length;
          const count = cols * rows + 2 * (cols + rows);
          const pos = new Float32Array(count * 3);
          const nor = new Float32Array(count * 3);
          const uv = new Float32Array(count * 2);
          let k = 0;
          const put = (i: number, j: number, drop: number) => {
            const e = t.e0 + (i + 0.5) * t.cell;
            const n = t.n0 + (j + 0.5) * t.cell;
            const h = z(i, j);
            pos.set([e, h - drop, -n], k * 3);
            const nv = new THREE.Vector3(-(z(i + 1, j) - z(i - 1, j)) / (2 * t.cell), 1, (z(i, j + 1) - z(i, j - 1)) / (2 * t.cell)).normalize();
            nor.set([nv.x, nv.y, nv.z], k * 3);
            uv.set([(e - d.e0) / width, (n - d.n0) / height], k * 2);
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
            for (const v of edge) put(is[v % cols]!, js[Math.floor(v / cols)]!, 20);
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
          geo.setIndex(idx);
          geo.computeBoundingSphere();
          lod.addLevel(shadowed(new THREE.Mesh(geo, material)), dist);
        }
        lod.name = 'terrain-town';
        this.fixed.add(lod);
      }
    }
  }

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
      terrainDetail(material as THREE.MeshStandardMaterial, this.waterMask);
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
        // Wholly under the town's finer ground: not drawn at all.
        const tb = this.townBox;
        if (tb && this.input.drape) {
          const e0 = g.e0 + (i0 + 0.5) * g.cell;
          const e1 = g.e0 + (i1 + 0.5) * g.cell;
          const n0 = g.n0 + (j0 + 0.5) * g.cell;
          const n1 = g.n0 + (j1 + 0.5) * g.cell;
          if (e0 > tb.eMin + g.cell && e1 < tb.eMax - g.cell && n0 > tb.nMin + g.cell && n1 < tb.nMax - g.cell) continue;
        }
        const lod = new THREE.LOD();
        for (const [step, dist] of [[1, 0], [4, FAR_LOD_M]] as const) {
          lod.addLevel(shadowed(new THREE.Mesh(this.chunkGeometry(i0, j0, i1, j1, step, width, height, !this.input.drape), material)), dist);
        }
        lod.name = 'terrain';
        this.fixed.add(lod);
      }
    }
    if (this.input.drape) this.buildTownTerrain(material);
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
    const tb = this.townBox;
    const put = (i: number, j: number, drop: number) => {
      const e = g.e0 + (i + 0.5) * g.cell;
      const n = g.n0 + (j + 0.5) * g.cell;
      // Inside the town the finer ground is drawn instead: sink the coarse surface out of sight there.
      const under = tb && e > tb.eMin + g.cell && e < tb.eMax - g.cell && n > tb.nMin + g.cell && n < tb.nMax - g.cell ? 60 : 0;
      const h = zi(i, j) - under;
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
   * Buildings from the OSM footprints, heights and bases (GEODATA.md), with the roofs the data gives or the
   * pipeline infers: gables along a terrace with party walls (no windows on those), hips, flat roofs. Detail
   * added here is illustrative, not data: windows drawn by the material (some lit after dark), chimney stacks,
   * and painted-render wall colours like those of the Dartmouth and Kingswear waterfronts.
   */
  private buildBuildings(f: DartFeatures): void {
    const tiles = new Map<string, { pos: number[]; nor: number[]; col: number[]; wall: number[]; gnd: number[] }>();
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
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    const DEG = Math.PI / 180;
    const kit = new Kit();
    f.buildings.forEach((b0, idx) => {
      let b = b0;
      const ring = b.r;
      if (ring.length < 3) return;
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cn = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const key = `${Math.floor(cx / 800)},${Math.floor(cn / 800)}`;
      let t = tiles.get(key);
      if (!t) tiles.set(key, (t = { pos: [], nor: [], col: [], wall: [], gnd: [] }));
      const T = t;
      // Landmarks as themselves (src/render/landmarks.ts); churches and chapels in stone with tall windows; the
      // marina buildings at Noss; shopfronts on the named buildings of the town streets.
      const spec = landmarkFor(ring);
      const church = !spec && (b.c === 'church' || /\bchurch\b|^st\.? |^saint /i.test(b.n ?? ''));
      const chapel = !spec && !church && (b.c === 'chapel' || /chapel/i.test(b.n ?? ''));
      const ce0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cn0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const noss = !spec && Math.hypot(ce0 - NOSS.centre[0], cn0 - NOSS.centre[1]) < NOSS.radius && b.b < 8;
      const town = TOWNS.some((t) => ce0 >= t.eMin && ce0 <= t.eMax && cn0 >= t.nMin && cn0 <= t.nMax);
      const shop = !spec && !church && !chapel && !!b.n && town && b.b < 8 && (b.c === null || b.c === 'retail' || b.c === 'commercial');
      const look: Look | undefined = spec ?? (noss ? NOSS.look : church || chapel ? { walls: 0x8a8378, roof: 0x3d4148, win: WIN.tall, shape: 'g' } : undefined);
      const landmark = !!look;
      const wall = look ? lin(look.walls).map((c) => c * 0.72) : wallPalette[(idx * 7919) % wallPalette.length]!;
      const roof = look ? lin(look.roof) : roofPalette[(idx * 104729) % roofPalette.length]!;
      // Windows (the integer part is the style, src/render/landmarks.ts WIN; the fraction seeds which are lit).
      const style = look ? look.win : b.c === 'garage' ? WIN.none : shop ? WIN.shopfront : WIN.sash;
      const winFlag = style === WIN.none ? 0 : style + ((idx * 37) % 97) / 100;
      // Roof overrides: a gable along the long axis (churches, chapels: low walls, steep roof, the data's top
      // kept for a tower), flat (castles, modern buildings), or slopes round a flat top (BRNC's ranges).
      const ccwRing = (() => {
        let a = 0;
        for (let i = 0; i < ring.length; i++) a += ring[i]![0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * ring[i]![1];
        return (a >= 0 ? [...ring] : [...ring].reverse()) as [number, number][];
      })();
      if (look?.shape === 'g' && b0.t - b0.b > 3) {
        const bearing = longAxisDeg(ring);
        const t = (bearing * Math.PI) / 180;
        const across = ring.map(([e, n]) => e * Math.cos(t) - n * Math.sin(t));
        const width = Math.max(...across) - Math.min(...across);
        const eavesG = b0.b + Math.min(8, Math.max(4, 0.45 * (b0.t - b0.b)));
        b = { ...b0, s: 'g', d: bearing, e: eavesG, t: Math.min(b0.t, eavesG + 0.35 * width) };
        if (church && b0.r.length >= 4) {
          // A tower at the west end, as most parish churches have (E: position and size).
          const along = ring.map(([e, n]) => e * Math.sin(t) + n * Math.cos(t));
          const lo = Math.min(...along);
          const hi = Math.max(...along);
          const westIsLo = Math.sin(t) > 0;
          const endAlong = westIsLo ? lo + 3 : hi - 3;
          const mid = across.reduce((a, x) => a + x, 0) / across.length;
          const at: [number, number] = [endAlong * Math.sin(t) + mid * Math.cos(t), endAlong * Math.cos(t) - mid * Math.sin(t)];
          const top = b0.b + Math.min(30, Math.max(b0.t - b0.b, 2.2 * (eavesG - b0.b)));
          buildExtra(kit, { kind: 'tower', at, w: 5, d: 5, bearingDeg: bearing, fromM: b0.b, toM: top, top: 'battlements', walls: 0x8a8378, dressing: 0x9d978b });
        }
      } else if (look?.shape === 'f') b = { ...b0, s: 'f' };
      if (look) {
        const top = b.t;
        if (look.parapet === 'battlements' || look.parapet === 'corbelled-battlements') battlements(kit, ccwRing, top, look.walls, look.parapet === 'corbelled-battlements');
        if (spec?.extras) for (const x of spec.extras(b0.b, b0.t, ccwRing)) buildExtra(kit, x);
      }
      // Counter-clockwise (in e, n) so that wall normals face out; party-wall flags follow the ring.
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [e0, n0] = ring[i]!;
        const [e1, n1] = ring[(i + 1) % ring.length]!;
        area += e0 * n1 - e1 * n0;
      }
      const ccw = area >= 0;
      const pts = ccw ? ring : [...ring].reverse();
      const flags = b.w ? (ccw ? [...b.w] : [...b.w].reverse().slice(1).concat([...b.w].reverse()[0]!)) : [];
      const party = (i: number) => flags[i] === '1';
      // Roof: from the data (gable along the ridge bearing, hip, flat), else the older rule (hip on small simple
      // footprints).
      const shape = b.s ?? (!landmark && pts.length <= 8 && Math.abs(area) / 2 <= 400 && b.t - b.b >= 3.5 && b.c !== 'garage' ? 'h' : 'f');
      const eaves = b.s ? (b.e ?? b.t) : b.t;
      const wallH = eaves - b.b;
      // Storeys from the data's floor count when there is one: the window grid is scaled to them.
      const storeyScale = b.f ? STOREY_M / Math.max(2.4, wallH / b.f) : 1;

      const emitWall = (p0: [number, number], p1: [number, number], top0: number, top1: number, windows: boolean) => {
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 1e-6) return;
        const nx = (p1[1] - p0[1]) / len;
        const nz = (p1[0] - p0[0]) / len;
        const u0 = len < WINDOW_BAY_M ? (WINDOW_BAY_M - len) / 2 : -(len % WINDOW_BAY_M) / 2;
        const flag = windows ? winFlag : 0;
        // The ground along the wall (above the base): no window is drawn that would start below it.
        const g0 = Math.max(0, this.groundAt(p0[0], p0[1]) - b.b) * storeyScale;
        const g1 = Math.max(0, this.groundAt(p1[0], p1[1]) - b.b) * storeyScale;
        const quad: [number, number, number, number, number, number][] = [
          [p0[0], b.b, -p0[1], u0, 0, g0], [p1[0], b.b, -p1[1], u0 + len, 0, g1], [p1[0], top1, -p1[1], u0 + len, top1 - b.b, g1],
          [p0[0], b.b, -p0[1], u0, 0, g0], [p1[0], top1, -p1[1], u0 + len, top1 - b.b, g1], [p0[0], top0, -p0[1], u0, top0 - b.b, g0],
        ];
        for (const [x, y, z, u, h, g] of quad) {
          T.pos.push(x, y, z);
          T.nor.push(nx, 0, nz);
          T.col.push(...wall);
          T.wall.push(u, h * storeyScale, wallH * storeyScale, flag);
          T.gnd.push(g);
        }
      };
      const tri = (a: number[], b2: number[], c: number[], colour = roof) => {
        // Flat-shaded triangle, wound to face up (roofs) or out (vertical faces keep their winding).
        v.set(b2[0]! - a[0]!, b2[1]! - a[1]!, b2[2]! - a[2]!);
        w.set(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!);
        const nrm = v.cross(w);
        if (nrm.lengthSq() < 1e-10) return;
        nrm.normalize();
        const flip = nrm.y < -1e-6;
        const verts = flip ? [a, c, b2] : [a, b2, c];
        if (flip) nrm.negate();
        for (const q of verts) {
          T.pos.push(q[0]!, q[1]!, q[2]!);
          T.nor.push(nrm.x, nrm.y, nrm.z);
          T.col.push(...colour);
          T.wall.push(0, 0, 0, 0);
          T.gnd.push(0);
        }
      };
      const flatTop = (poly: [number, number][], height: (p: [number, number]) => number) => {
        const contour = poly.map(([e, n]) => new THREE.Vector2(e, n));
        for (const tr of THREE.ShapeUtils.triangulateShape(contour, [])) {
          const [p0, p1, p2] = [poly[tr[0]!]!, poly[tr[1]!]!, poly[tr[2]!]!];
          tri([p0[0], height(p0), -p0[1]], [p1[0], height(p1), -p1[1]], [p2[0], height(p2), -p2[1]]);
        }
      };
      /** A chimney stack (render or stone, E): a box on the roof with a cap. */
      const chimney = (p: [number, number], along: [number, number], foot: number, top: number) => {
        const [ax, an] = along;
        const [px, pn] = [an, -ax];
        const hw = 0.3;
        const hd = 0.5;
        const c = [
          [p[0] - ax * hw - px * hd, p[1] - an * hw - pn * hd], [p[0] + ax * hw - px * hd, p[1] + an * hw - pn * hd],
          [p[0] + ax * hw + px * hd, p[1] + an * hw + pn * hd], [p[0] - ax * hw + px * hd, p[1] - an * hw + pn * hd],
        ] as [number, number][];
        for (let i = 0; i < 4; i++) {
          const q0 = c[i]!;
          const q1 = c[(i + 1) % 4]!;
          const a0 = [q0[0], foot, -q0[1]];
          const a1 = [q1[0], foot, -q1[1]];
          const b0 = [q0[0], top, -q0[1]];
          const b1 = [q1[0], top, -q1[1]];
          // Side faces, both windings (cheap and always visible).
          for (const [x, y, z] of [a0, a1, b1, a0, b1, b0, a0, b1, a1, a0, b0, b1]) {
            T.pos.push(x!, y!, z!);
            T.nor.push(0, 0.2, 0);
            T.col.push(...wall);
            T.wall.push(0, 0, 0, 0);
            T.gnd.push(0);
          }
        }
        tri([c[0]![0], top, -c[0]![1]], [c[1]![0], top, -c[1]![1]], [c[2]![0], top, -c[2]![1]], lin(0x3a3633));
        tri([c[0]![0], top, -c[0]![1]], [c[2]![0], top, -c[2]![1]], [c[3]![0], top, -c[3]![1]], lin(0x3a3633));
      };

      if (look?.shape === 'p') {
        // Walls to the eaves, then slopes up and in to a flat top at the data's height.
        const drop = look.roofDrop ?? 3;
        const eavesP = b.t - drop;
        // The roof follows the footprint without its small jogs (the walls keep them; the cornice hides the join).
        const outer = simplifyRing(pts);
        let inner: [number, number][] | undefined;
        for (const d of [6, 4, 2.5]) if ((inner = insetRingAdaptive(outer, d))) break;
        for (let i = 0; i < pts.length; i++) emitWall(pts[i]!, pts[(i + 1) % pts.length]!, eavesP, eavesP, !party(i));
        if (look.parapet === 'cornice-balustrade') corniceBalustrade(kit, pts as [number, number][], eavesP, 0xe6e0d0);
        if (inner) {
          flatTop(pts as [number, number][], () => eavesP - 0.05);
          for (let i = 0; i < outer.length; i++) {
            const p0 = outer[i]!;
            const p1 = outer[(i + 1) % outer.length]!;
            const q0 = inner[i]!;
            const q1 = inner[(i + 1) % outer.length]!;
            tri([p0[0], eavesP, -p0[1]], [p1[0], eavesP, -p1[1]], [q1[0], b.t, -q1[1]]);
            tri([p0[0], eavesP, -p0[1]], [q1[0], b.t, -q1[1]], [q0[0], b.t, -q0[1]]);
          }
          flatTop(inner, () => b.t);
        } else flatTop(pts as [number, number][], () => eavesP);
        return;
      }
      if (look?.parapet === 'cornice-balustrade') corniceBalustrade(kit, pts as [number, number][], b.s ? (b.e ?? b.t) : b.t, 0xe6e0d0);
      if (shape === 'g' && b.d !== undefined && eaves < b.t) {
        // Gable: the ridge runs on the bearing b.d across the middle of the footprint; each side slopes down
        // to the eaves; the gable ends are walls that rise to the ridge.
        const d = b.d * DEG;
        const pv: [number, number] = [Math.cos(d), -Math.sin(d)];
        const vOf = (q: [number, number]) => q[0] * pv[0] + q[1] * pv[1];
        const vs = pts.map(vOf);
        const vMid = (Math.min(...vs) + Math.max(...vs)) / 2;
        const half = (Math.max(...vs) - Math.min(...vs)) / 2;
        const rise = b.t - eaves;
        const h = (q: [number, number]) => eaves + rise * Math.max(0, 1 - Math.abs(vOf(q) - vMid) / half);
        // The ring with the ridge's two ends inserted on the gable edges.
        const aug: { p: [number, number]; edge: number; ridge: boolean }[] = [];
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i]!;
          const p1 = pts[(i + 1) % pts.length]!;
          aug.push({ p: p0, edge: i, ridge: Math.abs(vOf(p0) - vMid) < 1e-6 });
          const a = vOf(p0) - vMid;
          const c = vOf(p1) - vMid;
          if (a * c < 0) {
            const f2 = a / (a - c);
            aug.push({ p: [p0[0] + (p1[0] - p0[0]) * f2, p0[1] + (p1[1] - p0[1]) * f2], edge: i, ridge: true });
          }
        }
        const ridgePts = aug.filter((x) => x.ridge);
        if (ridgePts.length === 2) {
          for (let i = 0; i < aug.length; i++) {
            const a = aug[i]!;
            const c = aug[(i + 1) % aug.length]!;
            emitWall(a.p, c.p, h(a.p), h(c.p), !party(a.edge));
          }
          for (const side of [-1, 1]) {
            const poly = aug.filter((x) => x.ridge || Math.sign(vOf(x.p) - vMid) === side).map((x) => x.p);
            if (poly.length >= 3) flatTop(poly, h);
          }
          // Chimneys at the ridge ends on party walls (terraces), or on one gable of a detached house (E).
          const along: [number, number] = [Math.sin(d), Math.cos(d)];
          const [r0, r1] = [ridgePts[0]!, ridgePts[1]!];
          const span = Math.hypot(r1.p[0] - r0.p[0], r1.p[1] - r0.p[1]);
          if (span > 3 && !landmark) {
            const ends = [r0, r1].filter((x, k) => party(x.edge) || (!flags.includes('1') && k === idx % 2));
            for (const x of ends) {
              const other = x === r0 ? r1 : r0;
              const inward: [number, number] = [(other.p[0] - x.p[0]) / span, (other.p[1] - x.p[1]) / span];
              const at: [number, number] = [x.p[0] + inward[0] * 0.35, x.p[1] + inward[1] * 0.35];
              chimney(at, along, b.t - 0.6, b.t + 0.9);
            }
          }
          return;
        }
      }
      const ridge = shape === 'h' ? hipRidge(pts) : undefined;
      if (ridge) {
        // Hipped roof: every eave edge rises to its nearest point on the ridge.
        const rise = b.s ? Math.max(0.8, b.t - eaves) : Math.min(3.5, Math.max(1.0, 0.55 * ridge.halfWidth));
        const top = b.s ? eaves : b.t;
        for (let i = 0; i < pts.length; i++) emitWall(pts[i]!, pts[(i + 1) % pts.length]!, top, top, !party(i));
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i]!;
          const p1 = pts[(i + 1) % pts.length]!;
          const r0 = ridge.at(p0);
          const r1 = ridge.at(p1);
          const a = [p0[0], top, -p0[1]];
          const c = [p1[0], top, -p1[1]];
          const ra = [r0[0], top + rise, -r0[1]];
          const rc = [r1[0], top + rise, -r1[1]];
          tri(a, c, rc);
          tri(a, rc, ra);
        }
        return;
      }
      for (let i = 0; i < pts.length; i++) emitWall(pts[i]!, pts[(i + 1) % pts.length]!, b.t, b.t, !party(i));
      flatTop(pts, () => b.t);
    });
    const mat = buildingMaterial(this.buildingUniforms);
    for (const t of tiles.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setAttribute('aWall', new THREE.Float32BufferAttribute(t.wall, 4));
      geo.setAttribute('aGround', new THREE.Float32BufferAttribute(t.gnd, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = 'buildings';
      this.fixed.add(mesh);
    }
    if (kit.pos.length) this.fixed.add(kit.mesh('landmark-details'));
  }

  /** 0 by day … 1 at night: lights some windows (src/render/scene.ts passes the sun's daylight). */
  setDaylight(day: number): void {
    this.traffic.setDaylight(day);
    this.street?.setDaylight(day);
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

  private buildMoorings(f: DartFeatures): THREE.InstancedMesh {
    const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }), f.moorings.length);
    buoys.name = 'moorings';
    buoys.frustumCulled = false;
    this.floating.add(buoys);
    return buoys;
  }

  private updateMoorings(stream: (n: number, e: number) => NE, windFromDir: number): void {
    const f = this.features;
    if (!f || !this.boats || !this.buoys) return;
    const m = new THREE.Matrix4();
    f.moorings.forEach((b, i) => {
      // Boats on a mooring lie head to the stream; in slack water, head to the wind.
      const c = stream(b.n, b.e);
      const sp = Math.hypot(c.n, c.e);
      const bowTo = sp > 0.08 ? Math.atan2(-c.e, -c.n) : windFromDir + ((b.h % 30) - 15) * (Math.PI / 180);
      // The buoy is at the bow end of the chain; the boat lies downstream of it.
      const back = b.l * 0.5 + 2;
      this.boats!.set(i, { n: b.n - Math.cos(bowTo) * back, e: b.e - Math.sin(bowTo) * back, heading: bowTo, length: b.l, kind: b.k === 'motor' ? 'motor' : 'yacht', seed: b.h, visible: true });
      m.makeTranslation(b.e, 0.05, -b.n);
      this.buoys!.setMatrixAt(i, m);
    });
    this.buoys.instanceMatrix.needsUpdate = true;
  }

  /** Which marina and pontoon berths have a boat in them now (the run's traffic: boats out, visitors in). */
  private updateBerths(taken: Uint8Array): void {
    const off = this.features?.moorings.length ?? 0;
    for (let i = 0; i < this.berths.length && i < taken.length; i++) this.boats?.setVisible(off + i, taken[i] === 1);
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
    this.fixed.add(this.buildSlipways(f));
  }

  /**
   * The vehicle ferries' slipways: a concrete ramp down the last 50 m of each end of the Lower and Higher
   * Ferry routes (OSM), on the ground and into the water, kerbed at the sides. Widths E (Lower 9 m, Higher 12 m).
   */
  private buildSlipways(f: DartFeatures): THREE.Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const fr of f.ferries.filter((x) => /Lower Ferry|Higher Ferry/.test(x.name))) {
      const w = (/Higher/.test(fr.name) ? 12 : 9) / 2;
      for (const fromStart of [true, false]) {
        const r = fromStart ? fr.route : [...fr.route].reverse();
        const a = r[0]!;
        const b = r[Math.min(r.length - 1, 1)]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ue = (b[0] - a[0]) / len;
        const un = (b[1] - a[1]) / len;
        const base = pos.length / 3;
        const steps = 10;
        for (let k = 0; k <= steps; k++) {
          // From 6 m behind the route's end (the top of the slip) to 50 m out, towards the water.
          const d = -6 + (56 * k) / steps;
          const e = a[0] + ue * d;
          const n = a[1] + un * d;
          // Never above the ground there (a ramp laid on it) and on down below low water.
          const y = Math.min(this.groundAt(e, n) + 0.15, 3.2 - 0.12 * Math.max(0, d));
          for (const side of [-1, 1]) pos.push(e - un * w * side, y, -(n + ue * w * side));
          if (k > 0) {
            const i0 = base + (k - 1) * 2;
            idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9c988e, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    mesh.name = 'slipways';
    mesh.receiveShadow = true;
    return mesh;
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
    if (u.time - this.lastMooringUpdate > 2 || u.time < this.lastMooringUpdate) {
      this.lastMooringUpdate = u.time;
      this.updateMoorings(u.stream, u.windFromDir);
      if (u.traffic && u.traffic.berths.length === this.berths.length) this.updateBerths(u.traffic.berthsTaken(u.epochMs));
    }
    this.boats?.setWind(u.windFromDir);
    this.boats?.update(u.camera);
    // Steam trains: smoke drifts downwind (about 3 m/s, E).
    this.railway?.update(u.epochMs, u.time, { e: -Math.sin(u.windFromDir) * 3, n: -Math.cos(u.windFromDir) * 3 });
    if (this.features) {
      const states = u.traffic ? u.traffic.states(u.epochMs) : ferryStates(this.features.ferries, u.epochMs);
      this.traffic.update(states, u.time, u.camera, u.showLabels, u.windSpeed !== undefined ? { fromDir: u.windFromDir, speed: u.windSpeed } : undefined);
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

    this.woodland?.update(u.camera);
    this.street?.update(u.time, u.camera);
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
      .replace('#include <common>', '#include <common>\nattribute vec4 aWall;\nattribute float aGround;\nvarying vec4 vWall;\nvarying float vGround;\nvarying vec3 vBWorld;\nvarying vec3 vBNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall;\nvGround = aGround;\nvBWorld = transformed;\nvBNormal = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec4 vWall;
        varying float vGround;
        varying vec3 vBWorld;
        varying vec3 vBNormal;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float bNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        ${BUMP_GLSL}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vWall.w <= 0.0 && vWall.z <= 0.0 && vBNormal.y > 0.25) {
          // Slates: each course's lower edge stands proud of the next; joints staggered course to course.
          ${bumpBlock('fract(vBWorld.y * 4.2) * 0.7 + 0.25 * step(0.9, fract(dot(vBWorld.xz, vec2(0.7071)) * 3.3 + floor(vBWorld.y * 4.2) * 0.5)) + 0.15 * bNoise(vBWorld.xz * 9.0)', 1.0, 25, 220)}
        } else if (vWall.z > 0.0) {
          // Rough render (or stone) on the walls.
          ${bumpBlock('bNoise(vWall.xy * 7.0) * 0.6 + bNoise(vWall.xy * 23.0) * 0.4', 0.6, 15, 160)}
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float winLit = 0.0;
        if (vWall.w > 0.5) {
          // Window style (src/render/landmarks.ts WIN): 1 sash, 2 tall (churches), 3 slits (castles),
          // 4 brick with stone bands (BRNC), 5 glazed (modern), 6 shopfront on the ground floor.
          float wstyle = floor(vWall.w);
          float bay = floor(vWall.x / ${WINDOW_BAY_M.toFixed(1)});
          float storey = floor(vWall.y / ${STOREY_M.toFixed(1)});
          float fu = fract(vWall.x / ${WINDOW_BAY_M.toFixed(1)});
          float fv = fract(vWall.y / ${STOREY_M.toFixed(1)});
          float seed = fract(vWall.w) * 61.0;
          vec4 r = vec4(0.3, 0.7, 0.3, 0.8);
          float fw = 0.03;
          if (wstyle > 1.5 && wstyle < 2.5) { r = vec4(0.4, 0.6, 0.12, 0.92); fw = 0.025; }
          else if (wstyle > 2.5 && wstyle < 3.5) { r = vec4(0.47, 0.53, 0.35, 0.72); fw = 0.0; }
          else if (wstyle > 4.5 && wstyle < 5.5) { r = vec4(0.06, 0.94, 0.12, 0.92); fw = 0.015; }
          bool shopFloor = wstyle > 5.5 && storey < 0.5;
          if (shopFloor) { r = vec4(0.08, 0.92, 0.08, 0.66); fw = 0.02; }
          // Whole windows only, starting at least 0.4 m above the ground along the wall (hillside walls).
          float sill = (storey + 0.3) * ${STOREY_M.toFixed(1)};
          float lowest = shopFloor ? 0.2 : 0.7;
          float inWin = step(r.x, fu) * step(fu, r.y) * step(r.z, fv) * step(fv, r.w) * step(lowest, vWall.y) * step(vWall.y, vWall.z - 0.5) * step(vGround + (shopFloor ? 0.0 : 0.4), sill);
          float frame = fw > 0.0 ? inWin * (1.0 - step(r.x + fw, fu) * step(fu, r.y - fw) * step(r.z + fw * 1.4, fv) * step(fv, r.w - fw * 1.4)) : 0.0;
          // A door on some ground-floor bays where the ground is level (painted: blue, green, red, black).
          float doorHash = fract(sin(dot(vec2(bay + seed * 3.1, seed), vec2(41.3, 289.1))) * 43758.5453);
          float door = (wstyle < 1.5 || wstyle > 3.5 && wstyle < 4.5) ? step(doorHash, 0.16) * step(storey, 0.5) * step(abs(vGround), 0.35) * step(0.36, fu) * step(fu, 0.64) * step(fv, 0.72) * step(vWall.y, vWall.z - 0.5) : 0.0;
          inWin *= 1.0 - door;
          frame *= 1.0 - door;
          vec3 stoneCol = vec3(0.62, 0.6, 0.55);
          vec3 frameCol = wstyle > 3.5 && wstyle < 4.5 ? stoneCol : (wstyle > 4.5 && wstyle < 5.5 ? vec3(0.18, 0.19, 0.2) : vec3(0.92, 0.92, 0.9));
          // BRNC: stone string courses at each floor and a stone band at the eaves.
          if (wstyle > 3.5 && wstyle < 4.5) {
            float band = (1.0 - step(0.07, fv)) + step(vWall.z - 0.6, vWall.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, stoneCol, clamp(band, 0.0, 1.0) * step(0.5, vWall.y));
          }
          // Shopfront: a painted fascia board over the window, in one of a few colours.
          if (shopFloor) {
            float fascia = step(0.72, fv) * step(fv, 0.9);
            vec3 board = mix(vec3(0.12, 0.2, 0.32), vec3(0.45, 0.12, 0.12), step(0.5, fract(seed * 7.3)));
            board = mix(board, vec3(0.16, 0.28, 0.2), step(0.75, fract(seed * 3.7)));
            diffuseColor.rgb = mix(diffuseColor.rgb, board, fascia);
          }
          vec3 doorCol = mix(vec3(0.09, 0.16, 0.3), vec3(0.32, 0.07, 0.07), step(0.5, fract(doorHash * 13.0)));
          doorCol = mix(doorCol, vec3(0.08, 0.2, 0.12), step(0.7, fract(doorHash * 29.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, doorCol, door);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.085, 0.1), inWin - frame);
          diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, frame);
          winLit = (inWin - frame) * step(shopFloor ? 0.2 : 0.6, fract(sin(dot(vec2(bay + seed, storey + seed * 1.7), vec2(12.9898, 78.233))) * 43758.5453));
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * 1.6 * winLit * uNight;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vWall.w <= 0.0 && vWall.z <= 0.0 && vBNormal.y > 0.25) {
          // Roofs: courses of slates or tiles (lines across the slope) and a little weathering.
          float course = fract(vBWorld.y * 4.2);
          diffuseColor.rgb *= 0.86 + 0.14 * smoothstep(0.0, 0.12, course) + 0.06 * (bHash(floor(vBWorld.xz * 2.5)) - 0.5);
        } else if (vWall.z > 0.0) {
          // Walls: the render's texture, darker towards the foot (splash and shade).
          diffuseColor.rgb *= 0.94 + 0.08 * bHash(floor(vBWorld.xz * 6.0 + vBWorld.y * 3.0));
          diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(max(vGround, 0.0) - 0.1, max(vGround, 0.0) + 1.6, vWall.y);
        }`,
      );
  };
  return mat;
}

/** The drape image's RGBA pixels (rows north to south), or undefined outside a browser. */
function drapePixels(img: TexImageSource): Uint8ClampedArray | undefined {
  if (typeof document === 'undefined') return undefined;
  const w = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
  const h = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
  if (!w || !h) return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return undefined;
  g.drawImage(img as CanvasImageSource, 0, 0);
  return g.getImageData(0, 0, w, h).data;
}

/**
 * Detail the 10 m satellite colours cannot show: a fine variation of the ground (two octaves of noise), bare
 * rock where the slope is steep (the cliffs at the entrance), and mud and shingle below high water, which the
 * picture taken at an unknown tide shows as water or weed. Illustrative (E).
 */
function terrainDetail(m: THREE.MeshStandardMaterial, mask?: WaterMask): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: mask?.texture ?? null };
    shader.uniforms.uMaskBox = { value: mask?.box ?? new THREE.Vector4(0, 0, 0, 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;\nvarying float vUpright;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = transformed;\nvUpright = objectNormal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGround;
        varying float vUpright;
        uniform sampler2D uMask;
        uniform vec4 uMaskBox;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        ${BUMP_GLSL}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Grass tussocks and bare rock where it is steep.
        ${bumpBlock('tNoise(vGround.xz * 1.6) * 0.55 + tNoise(vGround.xz * 5.5) * 0.3 + smoothstep(0.8, 0.58, vUpright) * tNoise(vGround.xz * 0.7 + vGround.y) * 1.5', 1.2, 30, 260)}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float tn = tNoise(vGround.xz * 0.21) * 0.55 + tNoise(vGround.xz * 0.9) * 0.3 + tNoise(vGround.xz * 3.1) * 0.15;
        // Satellite colour is hazy and flat: a little more saturation and depth, as the eye sees fields (a grade).
        float tl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(mix(vec3(tl), diffuseColor.rgb, 1.4) * 0.9, 0.0);
        diffuseColor.rgb *= 0.84 + 0.32 * tn;
        float rock = smoothstep(0.8, 0.58, vUpright);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.17) * (0.75 + 0.5 * tn), rock * 0.7);
        // Mud only on the tidal foreshore (near tidal water), not on low ground inland.
        float tidal = 1.0;
        if (uMaskBox.z > 0.0) {
          vec2 muv = (vec2(vGround.x, -vGround.z) - uMaskBox.xy) / uMaskBox.zw;
          tidal = smoothstep(-24.0, -6.0, (texture2D(uMask, muv).r * 255.0 - 128.0) * 0.5);
        }
        float mud = smoothstep(2.6, 1.6, vGround.y) * smoothstep(-4.0, -2.5, vGround.y) * tidal;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.27, 0.24, 0.2), vec3(0.42, 0.39, 0.34), step(0.62, tn)) * (0.8 + 0.4 * tn), mud * 0.8);`,
      );
  };
}

/** Ground casts and receives the sun's shadows (hills shade the river at a low sun; houses and trees shade it). */
function shadowed(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * Where people stand (E): on the quays and jetties and on the pontoons in the two towns, about one person per
 * 60 m² of deck (fewer on long pontoons), never more than 40 on one. Seeded, so the same each time.
 */
export function standingSpots(f: DartFeatures): { e: number; n: number; floating: boolean; deck: number }[] {
  const out: { e: number; n: number; floating: boolean; deck: number }[] = [];
  let seed = 991;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const town = (e: number, n: number) => TOWNS.some((t) => e >= t.eMin && e <= t.eMax && n >= t.nMin && n <= t.nMax);
  const deck = (floating: boolean) => (floating ? 0.4 : FIXED_DECK_ODN);
  for (const p of f.piers) {
    if ('line' in p) {
      const [a, b] = [p.line[0]!, p.line[p.line.length - 1]!];
      if (!town(a[0], a[1])) continue;
      let len = 0;
      for (let i = 1; i < p.line.length; i++) len += Math.hypot(p.line[i]![0] - p.line[i - 1]![0], p.line[i]![1] - p.line[i - 1]![1]);
      const count = Math.min(40, Math.floor((len * p.width) / 60 * (p.floating ? 0.5 : 1)));
      for (let k = 0; k < count; k++) {
        const t = rnd();
        // Along the line at a random point, within its width.
        let s = t * len;
        for (let i = 1; i < p.line.length; i++) {
          const q0 = p.line[i - 1]!;
          const q1 = p.line[i]!;
          const l = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
          if (s <= l || i === p.line.length - 1) {
            const f2 = l > 0 ? Math.min(1, s / l) : 0;
            const w = (rnd() - 0.5) * p.width * 0.6;
            const ue = l > 0 ? (q1[0] - q0[0]) / l : 0;
            const un = l > 0 ? (q1[1] - q0[1]) / l : 0;
            out.push({ e: q0[0] + (q1[0] - q0[0]) * f2 - un * w, n: q0[1] + (q1[1] - q0[1]) * f2 + ue * w, floating: p.floating, deck: deck(p.floating) });
            break;
          }
          s -= l;
        }
      }
      void b;
    } else {
      const xs = p.poly.map((q) => q[0]);
      const ys = p.poly.map((q) => q[1]);
      const [e0, e1, n0, n1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (!town((e0 + e1) / 2, (n0 + n1) / 2)) continue;
      let area = 0;
      for (let i = 0; i < p.poly.length; i++) {
        const [x0, y0] = p.poly[i]!;
        const [x1, y1] = p.poly[(i + 1) % p.poly.length]!;
        area += x0 * y1 - x1 * y0;
      }
      const count = Math.min(40, Math.floor(Math.abs(area / 2) / 60 * (p.floating ? 0.5 : 1)));
      for (let k = 0, tries = 0; k < count && tries < count * 20; tries++) {
        const e = e0 + (e1 - e0) * rnd();
        const n = n0 + (n1 - n0) * rnd();
        if (!insideRing(p.poly, e, n)) continue;
        out.push({ e, n, floating: p.floating, deck: deck(p.floating) });
        k++;
      }
    }
  }
  return out;
}

function insideRing(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
