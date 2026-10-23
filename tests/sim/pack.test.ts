import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GRID_PACKING, decodeGridPlanes, encodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { GEO_DIR, readGrid } from '../../tools/lib/dartGeoNode';

/**
 * The River Dart grids are shipped packed (tools/geodata/pack.py) and unpacked by the app. The packing must
 * be lossless: the unpacked bytes are the raw grids the physics was built and tested on.
 */

/** SHA-256 of the raw grids (elevation.bin, current.bin) as built on 22 Oct 2026, before packing. */
const RAW_SHA256 = {
  elevation: 'd88ccccb37b4e8902f4a2c1e3bf0efe6542b74b69077310dea0901f1ddf8c209',
  current: 'c640419486a771d778acad2ed88d0a5400ba76d49e16c1b3046e111cd021bae8',
};

const sha = (b: ArrayBuffer) => createHash('sha256').update(new Uint8Array(b)).digest('hex');

describe('packed River Dart grids', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', GEO_DIR), 'utf8')) as {
    elevation: { file: string; packing?: string; nx: number; ny: number };
    current: { file: string; packing?: string; nx: number; ny: number; components: string[] };
  };

  it('unpack to exactly the raw grids (same SHA-256), in Node as in the browser', () => {
    for (const key of ['elevation', 'current'] as const) {
      const spec = manifest[key];
      expect(spec.packing).toBe(GRID_PACKING);
      const raw = readGrid(GEO_DIR, spec);
      expect(sha(raw), key).toBe(RAW_SHA256[key]);
    }
    expect(manifest.current.components).toHaveLength(4);
  });

  it('are a fraction of the raw size', () => {
    const size = (f: string) => readFileSync(new URL(f, GEO_DIR)).byteLength;
    expect(size(manifest.elevation.file)).toBeLessThan(0.3 * 850 * 1220 * 2);
    expect(size(manifest.current.file)).toBeLessThan(0.05 * 425 * 610 * 2 * 4);
  });

  it('round-trips any Int16 data, including the extremes and several planes', () => {
    const nx = 7;
    const ny = 5;
    const v = new Int16Array(nx * ny * 3);
    let seed = 12345;
    for (let i = 0; i < v.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      v[i] = i % 11 === 0 ? 32767 : i % 13 === 0 ? -32768 : (seed >>> 16) - 32768;
    }
    const packed = gzipSync(encodeGridPlanes(v, nx, ny));
    expect(isGzip(packed)).toBe(true);
    const out = new DataView(decodeGridPlanes(gunzipSync(packed), nx, ny));
    for (let i = 0; i < v.length; i++) expect(out.getInt16(i * 2, true)).toBe(v[i]);
    expect(() => decodeGridPlanes(new Uint8Array(10), nx, ny)).toThrow(/whole number/);
  });
});
