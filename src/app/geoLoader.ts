import { DartGeo, type DartManifest } from '../sim/geo/dart';
import { GRID_PACKING, decodeGridPlanes, isGzip } from '../sim/geo/pack';

/** public/geo/features.json (written by tools/geodata/build.py); local metres, rounded to 0.1 m. */
export interface DartFeatures {
  landmarks: { name: string; group: 'reference' | 'extra'; e: number; n: number; lat: number; lon: number }[];
  /** Buildings: base and top (m ODN), footprint ring [e, n][], name, OSM class. */
  buildings: { b: number; t: number; r: [number, number][]; n: string | null; c: string | null }[];
  piers: ({ name: string | null; floating: boolean } & ({ line: [number, number][]; width: number } | { poly: [number, number][] }))[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  /** Provisional moorings: position, boat kind, length (m), initial heading (deg), area name. */
  moorings: { e: number; n: number; k: 'yacht' | 'motor' | 'keelboat'; l: number; h: number; a: string }[];
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
  marks: { name: string; kind: string; light: string; e: number; n: number; tag: string; source: string }[];
  marksNotPlaced: { name: string; kind: string; light: string; reason: string }[];
}

export interface ManifestFull extends DartManifest {
  generated: string;
  drape: { file: string; nx: number; ny: number; cell: number; e0: number; n0: number };
  minimap: { file: string; cell: number; e0: number; n0: number };
}

/** Everything loaded for the River Dart, with what failed (the app keeps running with what it has). */
export interface DartData {
  manifest?: ManifestFull;
  geo?: DartGeo;
  features?: DartFeatures;
  drape?: ImageBitmap | HTMLImageElement;
  minimapUrl?: string;
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
  const [elev, cur, feat, drape] = await Promise.allSettled([
    fetchGrid(base, m.elevation),
    fetchGrid(base, m.current),
    fetchOk(base + 'features.json').then((r) => r.json() as Promise<DartFeatures>),
    loadImage(base + m.drape.file),
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
  if (feat.status === 'fulfilled') out.features = feat.value;
  else issue('features.json', feat.reason, 'No buildings, piers, moorings, ferries, marks or landmark labels.');
  if (drape.status === 'fulfilled') out.drape = drape.value;
  else issue(m.drape.file, drape.reason, 'Terrain drawn in plain colours (no satellite colour).');
  out.minimapUrl = base + m.minimap.file;
  return out;
}
