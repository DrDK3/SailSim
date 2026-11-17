/**
 * The minimap's chart (owner, 17 Nov 2026: "improve the mini map"), drawn in the browser from the sim's own ground
 * rather than the pipeline's 16 m picture: 5 m to the pixel, the water shaded by depth as a chart shades it (deeper
 * darker), the ground that dries at low water and the foreshore in their own colours, a crisp line at the water's
 * edge, the land hill-shaded from the north-west and tinted by height; then the roads, the buildings and the islets
 * off the mouth drawn over it. The depths are the sim's (the provisional bathymetry: not for navigation).
 */
/** The chart's grid: its north-west corner, size and cell (m). Rows run north to south. */
import { isletOutlines } from '../sim/env/islets';
import { DART_PROJECTION } from '../sim/geo/projection';
import { DAYMARK } from '../render/daymark';
import { TOWNS } from '../render/population';

export interface ChartSpec {
  e0: number;
  nTop: number;
  nx: number;
  ny: number;
  cell: number;
}

export const CHART_CELL = 5;

export function chartSpec(domain: { eMin: number; eMax: number; nMin: number; nMax: number }, cell = CHART_CELL): ChartSpec {
  return { e0: domain.eMin, nTop: domain.nMax, nx: Math.ceil((domain.eMax - domain.eMin) / cell), ny: Math.ceil((domain.nMax - domain.nMin) / cell), cell };
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
};

/** The water's edge (m ODN) as the chart draws it, and the top of the foreshore (about high water springs, E). */
export const COAST_ODN = 0.8;
const FORESHORE_TOP_ODN = 2.4;

const DEEP: Rgb = [24, 66, 102];
const MID: Rgb = [38, 96, 140];
const SHOAL: Rgb = [78, 140, 182];
const DRYING: Rgb = [128, 140, 102];
const FORESHORE: Rgb = [164, 152, 118];
const LOW: Rgb = [104, 132, 84];
const HIGH: Rgb = [146, 150, 104];
const EDGE: Rgb = [22, 40, 52];

/**
 * The colour of ground at `z` (m ODN) lit by `shade` (0 dark … 1 full, the hill-shading; water ignores it).
 * Water: darker with depth below chart datum; ground that dries at low water (between chart datum and the
 * water's edge) olive; the foreshore sand; land green, browner high up.
 */
export function chartColour(z: number, shade: number, cdOdn: number): Rgb {
  if (z < cdOdn) {
    const d = cdOdn - z;
    return d < 5 ? mix(SHOAL, MID, d / 5) : mix(MID, DEEP, (d - 5) / 15);
  }
  if (z < COAST_ODN) return DRYING;
  if (z < FORESHORE_TOP_ODN) return FORESHORE;
  const base = mix(LOW, HIGH, (z - FORESHORE_TOP_ODN) / 160);
  const k = 0.62 + 0.55 * shade;
  return [base[0] * k, base[1] * k, base[2] * k];
}

/** The chart's pixels (RGBA, rows north to south) from the ground `bed(n, e)` (m ODN), chart datum at `cdOdn`. */
export function chartPixels(bed: (n: number, e: number) => number, s: ChartSpec, cdOdn: number): Uint8ClampedArray {
  const z = new Float32Array((s.nx + 1) * (s.ny + 1));
  for (let j = 0; j <= s.ny; j++) {
    const n = s.nTop - (j + 0.5) * s.cell;
    for (let i = 0; i <= s.nx; i++) z[j * (s.nx + 1) + i] = bed(n, s.e0 + (i + 0.5) * s.cell);
  }
  const at = (i: number, j: number) => z[Math.min(j, s.ny) * (s.nx + 1) + Math.min(i, s.nx)]!;
  const out = new Uint8ClampedArray(s.nx * s.ny * 4);
  // Light from the north-west, 45° up.
  const lx = -Math.SQRT1_2 * Math.SQRT1_2;
  const ly = Math.SQRT1_2 * Math.SQRT1_2;
  const lz = Math.SQRT1_2;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const h = at(i, j);
      // Slope: east and north rises over a cell (rows run south).
      const dzE = (at(i + 1, j) - at(Math.max(0, i - 1), j)) / (2 * s.cell);
      const dzN = (at(i, Math.max(0, j - 1)) - at(i, j + 1)) / (2 * s.cell);
      const len = Math.hypot(dzE, dzN, 1);
      const shade = Math.max(0, (-dzE * lx - dzN * ly + lz) / len);
      let c = chartColour(h, shade, cdOdn);
      // The water's edge: where the ground crosses it between this cell and the next east or south.
      const wet = h < COAST_ODN;
      if (wet !== at(i + 1, j) < COAST_ODN || wet !== at(i, j + 1) < COAST_ODN) c = mix(c, EDGE, 0.75);
      const k = (j * s.nx + i) * 4;
      out[k] = c[0];
      out[k + 1] = c[1];
      out[k + 2] = c[2];
      out[k + 3] = 255;
    }
  }
  return out;
}

export interface ChartLayers {
  buildings?: readonly { r: readonly (readonly [number, number])[] }[];
  roads?: readonly { c: string; l: readonly (readonly [number, number])[] }[];
  /** Rock above the water: the islets and the Kingswear light's rock (local e, n rings). */
  rocks?: readonly (readonly (readonly [number, number])[])[];
}

/** The chart on a canvas: the ground, then the roads, buildings and rocks over it. */
export function drawChart(bed: (n: number, e: number) => number, s: ChartSpec, cdOdn: number, layers: ChartLayers): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.nx;
  c.height = s.ny;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(chartPixels(bed, s, cdOdn) as Uint8ClampedArray<ArrayBuffer>, s.nx, s.ny), 0, 0);
  const x = (e: number) => (e - s.e0) / s.cell;
  const y = (n: number) => (s.nTop - n) / s.cell;
  const ring = (r: readonly (readonly [number, number])[]) => {
    ctx.beginPath();
    r.forEach(([e, n], k) => (k ? ctx.lineTo(x(e), y(n)) : ctx.moveTo(x(e), y(n))));
    ctx.closePath();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of layers.roads ?? []) {
    const major = 'pstu'.includes(r.c);
    if (r.c === 'f' || r.c === 'x') continue;
    ctx.strokeStyle = major ? 'rgba(236,222,186,0.9)' : 'rgba(214,206,186,0.75)';
    ctx.lineWidth = major ? 1.3 : 0.8;
    ctx.beginPath();
    r.l.forEach(([e, n], k) => (k ? ctx.lineTo(x(e), y(n)) : ctx.moveTo(x(e), y(n))));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgb(92,82,76)';
  for (const b of layers.buildings ?? []) {
    ring(b.r);
    ctx.fill();
  }
  ctx.fillStyle = 'rgb(120,114,104)';
  ctx.strokeStyle = 'rgb(22,40,52)';
  ctx.lineWidth = 0.8;
  for (const r of layers.rocks ?? []) {
    ring(r);
    ctx.fill();
    ctx.stroke();
  }
  return c;
}

/**
 * Names on the map, and the zoom steps (indices into SPANS) they show at: the towns, the islets off the mouth, the
 * Daymark and Start Bay. Placed in the towns (src/render/population.ts: Dartmouth west of its middle, Kingswear east
 * of its, so the two names stand apart across the river), below the islets, above the Daymark, and in the open water
 * of the bay.
 */
export function minimapLabels(): { text: string; e: number; n: number; zooms: number[] }[] {
  const mid = (t: (typeof TOWNS)[number]) => ({ e: (t.eMin + t.eMax) / 2 + (t.name === 'Dartmouth' ? -120 : 160), n: (t.nMin + t.nMax) / 2 });
  const islet = (name: string) => {
    const r = isletOutlines().find((o) => o.name === name)!.ring;
    return { e: r.reduce((a, p) => a + p[0], 0) / r.length, n: r.reduce((a, p) => a + p[1], 0) / r.length - 70 };
  };
  const dm = DART_PROJECTION.toLocal(DAYMARK.lat, DAYMARK.lon);
  return [
    // Furthest out the two towns' names would run together: Dartmouth's alone.
    ...TOWNS.map((t) => ({ text: t.name, ...mid(t), zooms: t.name === 'Dartmouth' ? [1, 2, 3] : [1, 2] })),
    { text: 'Mew Stone', ...islet('Mew Stone'), zooms: [1, 2, 3] },
    { text: 'Daymark', e: dm.e, n: dm.n + 60, zooms: [1, 2] },
    { text: 'Start Bay', e: -1600, n: -4400, zooms: [2, 3] },
  ];
}
