import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DartGeo, type DartManifest } from '../../src/sim/geo/dart';
import { GRID_PACKING, decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { physicsGround, townQuays, townWithoutWater, type DartFeatures } from '../../src/app/geoLoader';
import type { QuayWall, TownGrid } from '../../src/sim/env/quays';

/** public/geo, where the River Dart data lives (docs/GEODATA.md). */
export const GEO_DIR = new URL('../../public/geo/', import.meta.url);

/** A grid file as raw Int16 little-endian bytes, unpacked as the app does (src/app/geoLoader.ts). */
export function readGrid(dir: URL, spec: { file: string; packing?: string; nx: number; ny: number }): ArrayBuffer {
  const b = readFileSync(new URL(spec.file, dir));
  if (!spec.packing) return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  if (spec.packing !== GRID_PACKING) throw new Error(`${spec.file}: unknown packing ${spec.packing}`);
  const bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return decodeGridPlanes(isGzip(bytes) ? gunzipSync(bytes) : bytes, spec.nx, spec.ny);
}

/** The River Dart data read from disk, for tests and tools (the app fetches the same files). */
export function loadDartGeoNode(dir: URL = GEO_DIR): DartGeo {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as DartManifest;
  return new DartGeo(manifest, readGrid(dir, manifest.elevation), readGrid(dir, manifest.current));
}

/**
 * The River Dart data as the app sets it up (src/app/geoLoader.ts): the towns' 4 m ground without the LIDAR's river
 * surface, the quay walls, and the physics standing on the ground the picture draws over the towns.
 */
export function loadDartAppNode(dir: URL = GEO_DIR): { geo: DartGeo; town: TownGrid; quays: QuayWall[]; features: DartFeatures } {
  const geo = loadDartGeoNode(dir);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
  const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as DartFeatures;
  const t = manifest.town;
  const raw = new Int16Array(readGrid(dir, t));
  const town0: TownGrid = { spec: t, values: Float32Array.from(raw, (v) => v * t.scale) };
  const quays = townQuays(town0, features);
  const town: TownGrid = { spec: t, values: townWithoutWater(town0, geo) };
  geo.setFinerGround(physicsGround(town, quays));
  return { geo, town, quays, features };
}
