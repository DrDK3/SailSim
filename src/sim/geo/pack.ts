/**
 * Lossless packing of the River Dart Int16 grids for download (docs/GEODATA.md, "Packing"). The values are
 * already integers (centimetres, millimetres per second), so the packing changes the file size only, never a
 * value: the unpacked bytes are identical to the unpacked grid, and the physics is unchanged.
 *
 * Per grid plane (ny rows of nx values): each value is replaced by its difference from the gradient
 * prediction left + up − up-left (missing neighbours count as 0), wrapped to 16 bits; the differences are
 * zigzag-coded (small magnitudes → small numbers), split into a plane of low bytes then a plane of high
 * bytes, and gzipped. Smooth terrain gives small differences, so the result compresses well.
 *
 * Written by tools/geodata/pack.py; unpacked here (the browser and Node share this code).
 */

export const GRID_PACKING = 'i16-gradient-zigzag-planes-gzip/1';

const wrap16 = (x: number) => (x << 16) >> 16;

/** Pack Int16 values (planes of ny rows × nx), before gzip. Used by the tests; the files are written in Python. */
export function encodeGridPlanes(values: Int16Array, nx: number, ny: number): Uint8Array {
  const n = values.length;
  if (n % (nx * ny) !== 0) throw new Error(`grid: ${n} values is not a whole number of ${nx} × ${ny} planes`);
  const out = new Uint8Array(n * 2);
  const plane = nx * ny;
  for (let k = 0; k < n; k++) {
    const p = k % plane;
    const x = p % nx;
    const y = (p - x) / nx;
    const left = x > 0 ? values[k - 1]! : 0;
    const up = y > 0 ? values[k - nx]! : 0;
    const ul = x > 0 && y > 0 ? values[k - nx - 1]! : 0;
    const r = wrap16(values[k]! - (left + up - ul));
    const z = ((r << 1) ^ (r >> 15)) & 0xffff;
    out[k] = z & 0xff;
    out[n + k] = z >>> 8;
  }
  return out;
}

/** Unpack (after gunzip) to the grid's bytes as Int16 little-endian, exactly as the unpacked file would be. */
export function decodeGridPlanes(bytes: Uint8Array, nx: number, ny: number): ArrayBuffer {
  if (bytes.length % 2 !== 0 || (bytes.length / 2) % (nx * ny) !== 0) {
    throw new Error(`grid: ${bytes.length} bytes is not a whole number of ${nx} × ${ny} Int16 planes`);
  }
  const n = bytes.length / 2;
  const plane = nx * ny;
  const v = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    const z = bytes[k]! | (bytes[n + k]! << 8);
    const r = (z >>> 1) ^ -(z & 1);
    const p = k % plane;
    const x = p % nx;
    const y = (p - x) / nx;
    const left = x > 0 ? v[k - 1]! : 0;
    const up = y > 0 ? v[k - nx]! : 0;
    const ul = x > 0 && y > 0 ? v[k - nx - 1]! : 0;
    v[k] = wrap16(r + left + up - ul);
  }
  // Little-endian bytes whatever the platform, as the grid readers expect.
  const out = new ArrayBuffer(n * 2);
  const view = new DataView(out);
  for (let k = 0; k < n; k++) view.setInt16(k * 2, v[k]!, true);
  return out;
}

/** True when the bytes start with the gzip signature (a server may already have undone the gzip layer). */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
