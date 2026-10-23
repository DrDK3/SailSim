import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DartGeo, type DartManifest } from '../../src/sim/geo/dart';
import { GRID_PACKING, decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';

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
