import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadDartGeo, readGreyPng } from './helpers';

/** The picture's water mask (public/geo/watermask.png): where the water surface may be drawn. */

describe('the water mask', () => {
  const m = JSON.parse(readFileSync(new URL('../../public/geo/manifest.json', import.meta.url), 'utf8')) as { waterMask: { file: string; cell: number; nx: number; ny: number; e0: number; n0: number } };
  const spec = m.waterMask;
  const png = readGreyPng(readFileSync(new URL(`../../public/geo/${spec.file}`, import.meta.url)));
  /** Signed distance (m) to tidal water at (n, e), > 0 in the water. */
  const dist = (n: number, e: number) => {
    const i = Math.floor((e - spec.e0) / spec.cell);
    const j = png.h - 1 - Math.floor((n - spec.n0) / spec.cell);
    return (png.px[j * png.w + i]! - 128) / 2;
  };
  const geo = loadDartGeo();

  it('covers the domain on the 8 m grid', () => {
    expect([png.w, png.h]).toEqual([spec.nx, spec.ny]);
  });

  it('the river is water; the town and the hills are not', () => {
    // Mid-river off the club, the entrance between the castles, the Kingswear moorings.
    for (const [n, e] of [[0, -200], [-680, 755], [300, -150]] as const) expect(dist(n, e)).toBeGreaterThan(20);
    // The club (on land in Kingswear) and the hill above Dartmouth.
    expect(dist(0, 0)).toBeLessThan(0);
    expect(dist(250, -560)).toBeLessThan(-24);
  });

  it('low ground inland in Dartmouth (below high water springs, not connected) is far from tidal water', () => {
    // The valley behind the town centre: ground about 1.3-1.9 m ODN, under the tide at high water springs
    // (2.28 m ODN), so a flat water surface would flood it.
    for (const [n, e] of [[350, -600], [350, -640], [400, -560]] as const) {
      expect(geo.bedElevation(n, e)).toBeLessThan(2.28);
      expect(dist(n, e)).toBeLessThan(-24);
    }
  });
});
