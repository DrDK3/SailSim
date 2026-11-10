import { withBayardsFort } from '../render/bayards';
import { withClubMarks, type FeatureMark } from '../sim/course/clubMarks';
import { DartGeo, type DartManifest } from '../sim/geo/dart';
import { GRID_PACKING, decodeGridPlanes, isGzip } from '../sim/geo/pack';
import type { RoadsData } from '../render/population';
import { rdycForeshore, rdycPlatformAt } from '../render/rdyc';
import { fillBehindQuays, quayWalls, type QuayWall, type TownGrid } from '../sim/env/quays';
import { layPads } from './pads';

/** public/geo/features.json (written by tools/geodata/build.py); local metres, rounded to 0.1 m. */
export interface DartFeatures {
  landmarks: { name: string; group: 'reference' | 'extra'; e: number; n: number; lat: number; lon: number }[];
  /**
   * Buildings: base and top (m ODN), footprint ring [e, n][], name, OSM class; roof shape (g gable, h hip,
   * f flat), eaves height (m ODN) and ridge bearing (deg) for pitched roofs, party walls (a 0/1 flag per edge),
   * floors (when the data has them). Older data has none of the roof fields (flat roofs).
   */
  buildings: { b: number; t: number; r: [number, number][]; n: string | null; c: string | null; s?: 'g' | 'h' | 'f'; e?: number; d?: number; w?: string; f?: number }[];
  /** Piers: a centre line and width, or an outline; a floating one may name its gangway (shore and pontoon ends, e, n). */
  piers: ({ name: string | null; floating: boolean; gangway?: { shore: [number, number]; pontoon: [number, number] } } & ({ line: [number, number][]; width: number } | { poly: [number, number][] }))[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  /** Provisional moorings: position, boat kind, length (m), initial heading (deg), area name. */
  moorings: { e: number; n: number; k: 'yacht' | 'motor' | 'keelboat'; l: number; h: number; a: string }[];
  /** Marinas (OSM leisure=marina, or a named place centred on its pontoons): name and centre; absent from data built before the hi-fi work. */
  marinas?: { name: string; n: number; e: number }[];
  /**
   * Railway lines (OSM, clipped to the domain; name, polyline, inferred tunnel) and stations with their
   * platforms and buildings (rings). Absent from data built before the station work.
   */
  railway?: {
    lines: { name: string; line: [number, number][]; tunnel: boolean }[];
    stations: { name: string; e: number; n: number; platforms: [number, number][][]; buildings: [number, number][][] }[];
  };
  ferries: {
    name: string;
    label: string;
    route: [number, number][];
    length_m: number;
    interval_min: number;
    crossing_min: number;
    length: number;
    beam: number;
    ram: boolean;
    units: number;
    note: string;
  }[];
  marks: FeatureMark[];
  marksNotPlaced: { name: string; kind: string; light: string; reason: string }[];
}

/** The finer ground over Dartmouth and Kingswear, for the picture (town.i16z). */
export interface TownGridSpec {
  file: string;
  packing?: string;
  scale: number;
  cell: number;
  nx: number;
  ny: number;
  e0: number;
  n0: number;
}

export interface ManifestFull extends DartManifest {
  generated: string;
  town?: TownGridSpec;
  drape: { file: string; nx: number; ny: number; cell: number; e0: number; n0: number };
  minimap: { file: string; cell: number; e0: number; n0: number };
  /** Signed distance to the tidal water outline, for where the picture draws the water (watermask.png). */
  waterMask?: WaterMaskSpec;
  /** Roads and footways (roads.json); absent from data built before the street-life work. */
  roads?: { file: string; classes: Record<string, string> };
}

export interface WaterMaskSpec {
  file: string;
  cell: number;
  nx: number;
  ny: number;
  e0: number;
  n0: number;
}

/** Everything loaded for the River Dart, with what failed (the app keeps running with what it has). */
export interface DartData {
  manifest?: ManifestFull;
  geo?: DartGeo;
  features?: DartFeatures;
  drape?: ImageBitmap | HTMLImageElement;
  /** Town ground (m ODN), row-major from the south-west, when the data has it. */
  town?: { spec: TownGridSpec; values: Float32Array };
  minimapUrl?: string;
  /** Where the water may be drawn (decoded: distance in m = (value - 128) / 2, > 0 in the water). */
  waterMask?: { spec: WaterMaskSpec; image: HTMLImageElement };
  /** Roads and footways (roads.json, written by tools/geodata/roads.py), when the data has them. */
  roads?: RoadsData;
  /** The towns' quay walls (src/sim/env/quays.ts), from the town ground and the buildings: drawn and solid. */
  quays?: QuayWall[];
  issues: { asset: string; message: string; effect: string }[];
}

const BASE = 'geo/';

/** A grid file as raw Int16 little-endian bytes: unpacked when the manifest says it is packed. */
async function fetchGrid(base: string, spec: { file: string; packing?: string; nx: number; ny: number }): Promise<ArrayBuffer> {
  const buf = await (await fetchOk(base + spec.file)).arrayBuffer();
  if (!spec.packing) return buf;
  if (spec.packing !== GRID_PACKING) throw new Error(`unknown packing ${spec.packing}`);
  let bytes = new Uint8Array(buf);
  // A server that sent the file with Content-Encoding: gzip has already undone the gzip layer.
  if (isGzip(bytes)) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the data (no DecompressionStream)');
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return decodeGridPlanes(bytes, spec.nx, spec.ny);
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'}`);
  return res;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image'));
    img.src = url;
  });
}

/**
 * Load the River Dart data set. Each file is independent: a missing or broken file is reported in `issues`
 * with its effect, and the app degrades (open water without the manifest or elevation grid; plain-coloured
 * terrain without the drape; no buildings or ferries without the features; no channel stream without the
 * current grid).
 */
export async function loadDartData(base = BASE): Promise<DartData> {
  const out: DartData = { issues: [] };
  const issue = (asset: string, err: unknown, effect: string) => out.issues.push({ asset, message: (err as Error).message ?? String(err), effect });
  try {
    out.manifest = (await (await fetchOk(base + 'manifest.json')).json()) as ManifestFull;
  } catch (err) {
    issue('manifest.json', err, 'River Dart unavailable: sailing on open water.');
    return out;
  }
  const m = out.manifest;
  const [elev, cur, feat, drape, town, mask, roads] = await Promise.allSettled([
    fetchGrid(base, m.elevation),
    fetchGrid(base, m.current),
    fetchOk(base + 'features.json').then((r) => r.json() as Promise<DartFeatures>),
    loadImage(base + m.drape.file),
    m.town ? fetchGrid(base, m.town) : Promise.resolve(undefined),
    m.waterMask ? loadImage(base + m.waterMask.file) : Promise.resolve(undefined),
    m.roads ? fetchOk(base + m.roads.file).then((r) => r.json() as Promise<RoadsData>) : Promise.resolve(undefined),
  ]);
  if (elev.status === 'rejected') {
    issue(m.elevation.file, elev.reason, 'No terrain or depths: sailing on open water.');
  } else {
    const expected = m.elevation.nx * m.elevation.ny * 2;
    if (elev.value.byteLength !== expected) {
      issue(m.elevation.file, new Error(`size ${elev.value.byteLength} bytes, expected ${expected}`), 'No terrain or depths: sailing on open water.');
    } else {
      // Without the current grid, use an all-zero pattern (no channel stream) but keep terrain and depths.
      const curBuf = cur.status === 'fulfilled' && cur.value.byteLength === m.current.nx * m.current.ny * 2 * m.current.components.length ? cur.value : undefined;
      if (!curBuf) issue(m.current.file, cur.status === 'rejected' ? cur.reason : new Error('wrong size'), 'Channel-following stream unavailable.');
      out.geo = new DartGeo(m, elev.value, curBuf);
    }
  }
  // The club's racing marks and the buoys its courses use (RDYC Sailing Programme 2026), with the geodata's marks.
  if (feat.status === 'fulfilled') {
    out.features = withClubMarks(feat.value, out.geo ? (n, e) => out.geo!.inDomain(n, e) : undefined);
    // Bayard's Cove Fort is not in the building data (an open ruin): its footprint, so boats meet its wall where
    // it stands in the water, and the renderer draws it as itself (src/render/bayards.ts).
    out.features = withBayardsFort(out.features);
  }
  else issue('features.json', feat.reason, 'No buildings, piers, moorings, ferries, marks or landmark labels.');
  if (drape.status === 'fulfilled') out.drape = drape.value;
  else issue(m.drape.file, drape.reason, 'Terrain drawn in plain colours (no satellite colour).');
  if (town.status === 'fulfilled' && town.value && m.town) {
    const t = m.town;
    if (town.value.byteLength === t.nx * t.ny * 2) {
      const raw = new Int16Array(town.value);
      out.town = { spec: t, values: Float32Array.from(raw, (v) => v * t.scale) };
    } else issue(t.file, new Error('wrong size'), 'Town ground drawn from the 8 m grid.');
  } else if (town.status === 'rejected' && m.town) issue(m.town.file, town.reason, 'Town ground drawn from the 8 m grid.');
  if (mask.status === 'fulfilled' && mask.value && m.waterMask) out.waterMask = { spec: m.waterMask, image: mask.value };
  else if (mask.status === 'rejected' && m.waterMask) issue(m.waterMask.file, mask.reason, 'Water drawn wherever the ground is below the tide, inland hollows included.');
  if (roads.status === 'fulfilled') out.roads = roads.value;
  else if (m.roads) issue(m.roads.file, roads.reason, 'No roads, cars or people.');
  if (out.town && out.features) out.quays = townQuays(out.town, out.features);
  // The picture and the physics stand on the same ground: the LIDAR's river surface out of the towns' grid, and the
  // physics' bed raised to the rocks, banks and quays the picture draws there.
  if (out.town && out.geo) out.town = { ...out.town, values: townWithoutWater(out.town, out.geo) };
  // Hardstandings under the waterfront buildings, in the grid each is drawn on (src/app/pads.ts).
  if (out.geo && out.features) {
    const pads = layPads(out.features, out.town, out.geo, out.quays ?? []);
    if (out.town && pads.town) out.town = { ...out.town, values: pads.town };
  }
  if (out.town && out.geo) out.geo.setFinerGround(physicsGround(out.town, out.quays ?? []));
  out.minimapUrl = base + m.minimap.file;
  return out;
}

/**
 * Below this (m ODN) the towns' 4 m LIDAR grid may be the river's surface on the day of the survey (−2.6 to −0.4 m
 * ODN: the flights met different tides), not ground.
 */
export const TOWN_WATER_MAX_ODN = 0;

/**
 * The towns' ground without the river's surface: where the LIDAR is at or below TOWN_WATER_MAX_ODN and the 8 m grid
 * (which carries the bathymetry) is more than a metre deeper, the 8 m grid's bed. Otherwise the LIDAR stands: the
 * land, and the foreshore the 8 m grid already takes from it. Near the Higher Ferry the survey met the water at
 * −0.4 m ODN over 5 m of river, which the picture drew as a dry flat at low tide.
 */
export function townWithoutWater(town: TownGrid, geo: { bedElevation(n: number, e: number): number }): Float32Array {
  const t = town.spec;
  const out = Float32Array.from(town.values);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const k = j * t.nx + i;
      const v = out[k]!;
      if (v > TOWN_WATER_MAX_ODN) continue;
      const bed = geo.bedElevation(t.n0 + (j + 0.5) * t.cell, t.e0 + (i + 0.5) * t.cell);
      if (bed < v - 1) out[k] = bed;
    }
  }
  return out;
}

/**
 * The ground the picture draws over the towns, for the physics (src/sim/geo/dart.ts `setFinerGround`): the town
 * grid with the quays filled behind their walls, the yacht club's terrace on its sea wall, and the bed it draws
 * lowered in front of that wall (src/render/dart.ts draws the same).
 */
export function physicsGround(town: TownGrid, quays: readonly QuayWall[]): TownGrid['spec'] & { values: Float32Array } {
  const t = town.spec;
  const values = quays.length ? fillBehindQuays(town, quays) : Float32Array.from(town.values);
  for (let j = 0; j < t.ny; j++) {
    for (let i = 0; i < t.nx; i++) {
      const e = t.e0 + (i + 0.5) * t.cell;
      const n = t.n0 + (j + 0.5) * t.cell;
      const k = j * t.nx + i;
      values[k] = rdycPlatformAt(e, n) ?? rdycForeshore(e, n, values[k]!);
    }
  }
  return { ...t, values };
}

/**
 * The quay walls, kept off the vehicle ferries' slipways (18 m round each end of their routes), the yacht club's
 * own sea wall (src/render/rdyc.ts, 6 m round it) and the castles' rocks (70 m round Dartmouth and Kingswear
 * castles and St Petrox: the photographs show the castles standing on bare rock).
 */
export function townQuays(town: TownGrid, f: DartFeatures): QuayWall[] {
  const slips = f.ferries
    .filter((r) => /lower ferry|higher ferry|floating bridge/i.test(r.name) && r.route.length >= 2)
    .flatMap((r) => [r.route[0]!, r.route[r.route.length - 1]!]);
  const rocks = (f.landmarks ?? []).filter((l) => /castle$|st petrox/i.test(l.name) && !/hotel/i.test(l.name)).map((l) => [l.e, l.n] as const);
  const club = (e: number, n: number) => [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].some(([de, dn]) => rdycPlatformAt(e + de!, n + dn!) !== undefined);
  return quayWalls(town, f.buildings.map((b) => b.r), (e, n) => club(e, n) || slips.some(([se, sn]) => Math.hypot(e - se, n - sn) < 18) || rocks.some(([le, ln]) => Math.hypot(e - le, n - ln) < 70));
}
