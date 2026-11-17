/**
 * The minimap's chart (src/ui/minimapChart.ts; owner, 17 Nov 2026: "improve the mini map"), drawn from the sim's
 * own ground at 5 m to the pixel: water shaded by depth (deeper darker), drying ground, foreshore and hill-shaded
 * land each in their own colours, and a line at the water's edge. Its names stand where they belong.
 */
import { describe, expect, it } from 'vitest';
import { CHART_CELL, COAST_ODN, chartColour, chartPixels, chartSpec, minimapLabels } from '../../src/ui/minimapChart';
import { kingswearLightLocal } from '../../src/sim/env/shoreLights';
import { loadDartApp } from '../sim/helpers';

const app = loadDartApp();
const cd = -app.geo.cdBelowOdn;
const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('the minimap chart', () => {
  it('shades the water darker with depth, and keeps drying ground, foreshore and land apart', () => {
    expect(lum(chartColour(cd - 20, 1, cd))).toBeLessThan(lum(chartColour(cd - 6, 1, cd)));
    expect(lum(chartColour(cd - 6, 1, cd))).toBeLessThan(lum(chartColour(cd - 1, 1, cd)));
    const water = chartColour(cd - 1, 1, cd);
    const drying = chartColour(cd + 1, 1, cd);
    const shore = chartColour(COAST_ODN + 0.5, 1, cd);
    const land = chartColour(40, 0.8, cd);
    expect(water[2]).toBeGreaterThan(water[0] + 40);
    for (const [a, b] of [[water, drying], [drying, shore], [shore, land]] as const) expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(20);
    // Hill-shading: a slope facing the light is brighter than one facing away.
    expect(lum(chartColour(40, 1, cd))).toBeGreaterThan(lum(chartColour(40, 0.2, cd)) + 15);
  });

  it('covers the whole domain at 5 m to the pixel', () => {
    const s = chartSpec(app.geo.domain);
    expect(s.cell).toBe(CHART_CELL);
    expect(s.nx * s.cell).toBeGreaterThanOrEqual(app.geo.domain.eMax - app.geo.domain.eMin);
    expect(s.ny * s.cell).toBeGreaterThanOrEqual(app.geo.domain.nMax - app.geo.domain.nMin);
  });

  it('draws the narrows as water between land, with the water’s edge lined', () => {
    // A strip across the river from Dartmouth's shore east to the Kingswear light, at the water's edge.
    const kl = kingswearLightLocal();
    const s = { e0: kl.e - 1200, nTop: kl.n + 2.5, nx: 238, ny: 1, cell: CHART_CELL };
    const px = chartPixels((n, e) => app.geo.bedElevation(n, e), s, cd);
    const at = (i: number) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!] as const;
    const blue = (i: number) => at(i)[2] > at(i)[0] + 30 && at(i)[2] > at(i)[1];
    const kinds = Array.from({ length: s.nx }, (_, i) => (blue(i) ? 'w' : 'l')).join('');
    // Land, then water, then land (the light stands at the water's edge on the east).
    expect(kinds).toMatch(/^l+.*w{20,}.*l+$/);
    // The water's edge is lined: a dark pixel near each shore (past the drying ground between it and the water).
    const edges = [...kinds].map((k, i) => (i && k !== kinds[i - 1] ? i : -1)).filter((i) => i > 0);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    for (const i of edges) {
      const near = Array.from({ length: 31 }, (_, d) => i - 15 + d).filter((q) => q >= 0 && q < s.nx);
      expect(Math.min(...near.map((q) => lum([...at(q)] as [number, number, number])))).toBeLessThan(70);
    }
  });

  it('names the towns on land, Start Bay on the open water and the Mew Stone by its islet', () => {
    const bed = (e: number, n: number) => app.geo.bedElevation(n, e);
    const labels = minimapLabels();
    for (const t of ['Dartmouth', 'Kingswear']) expect(bed(labels.find((l) => l.text === t)!.e, labels.find((l) => l.text === t)!.n)).toBeGreaterThan(3);
    const bay = labels.find((l) => l.text === 'Start Bay')!;
    expect(bed(bay.e, bay.n)).toBeLessThan(-8);
    expect(labels.find((l) => l.text === 'Mew Stone')).toBeDefined();
    for (const l of labels) expect(l.zooms.length).toBeGreaterThan(0);
  });
});
