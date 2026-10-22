/**
 * Regular cell-centred grids in the local frame (rows south to north). Values at cell centres
 * (e0 + (i + ½)·cell, n0 + (j + ½)·cell); bilinear interpolation between them; clamped at the edges.
 */
export interface Grid {
  e0: number;
  n0: number;
  cell: number;
  nx: number;
  ny: number;
  values: Float32Array;
}

export function sampleGrid(g: Grid, n: number, e: number): number {
  const x = Math.min(Math.max((e - g.e0) / g.cell - 0.5, 0), g.nx - 1.000001);
  const y = Math.min(Math.max((n - g.n0) / g.cell - 0.5, 0), g.ny - 1.000001);
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const v = g.values;
  const k = j * g.nx + i;
  return (v[k]! * (1 - fx) + v[k + 1]! * fx) * (1 - fy) + (v[k + g.nx]! * (1 - fx) + v[k + g.nx + 1]! * fx) * fy;
}

/** Gradient (∂/∂n, ∂/∂e) by central differences over ±h metres. */
export function gridGradient(g: Grid, n: number, e: number, h = g.cell / 2): { n: number; e: number } {
  return {
    n: (sampleGrid(g, n + h, e) - sampleGrid(g, n - h, e)) / (2 * h),
    e: (sampleGrid(g, n, e + h) - sampleGrid(g, n, e - h)) / (2 * h),
  };
}

/** Decode a little-endian Int16 grid (optionally one component of several stacked grids). */
export function int16Grid(buf: ArrayBuffer, spec: { e0: number; n0: number; cell: number; nx: number; ny: number }, scale: number, component = 0): Grid {
  const count = spec.nx * spec.ny;
  const view = new DataView(buf, component * count * 2, count * 2);
  const values = new Float32Array(count);
  for (let k = 0; k < count; k++) values[k] = view.getInt16(k * 2, true) * scale;
  return { ...spec, values };
}
