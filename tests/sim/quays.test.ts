/** The towns' quay walls (src/sim/env/quays.ts): found on the waterfronts the photographs show, drawn, and solid. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeGridPlanes, isGzip } from '../../src/sim/geo/pack';
import { QUAY_FILL_M, QUAY_TOP_MAX, QUAY_TOP_MIN, fillBehindQuays, gridGround, quayPiers, quayWalls, type TownGrid } from '../../src/sim/env/quays';
import { townQuays, type DartFeatures } from '../../src/app/geoLoader';
import { PierGrid, pierPieces } from '../../src/sim/race/piers';

const dir = new URL('../../public/geo/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const features = JSON.parse(readFileSync(new URL('features.json', dir), 'utf8')) as DartFeatures;

function loadTown(): TownGrid {
  let buf: Uint8Array = readFileSync(new URL(manifest.town.file, dir));
  if (isGzip(buf)) buf = gunzipSync(buf);
  const t = manifest.town;
  const raw = new Int16Array(decodeGridPlanes(buf, t.nx, t.ny));
  return { spec: t, values: Float32Array.from(raw, (v) => v * t.scale) };
}
const town = loadTown();
const walls = townQuays(town, features);
const length = (l: [number, number][]) => l.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - l[k]![0], p[1] - l[k]![1]), 0);
const nearest = (e: number, n: number) => Math.min(...walls.flatMap((w) => w.line.map(([we, wn]) => Math.hypot(we - e, wn - n))));

describe('quay walls', () => {
  it('line the town waterfronts (Dartmouth embankment and South Town, Kingswear), about 2 km in all', () => {
    const total = walls.reduce((a, w) => a + length(w.line), 0);
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(3500);
    // Dartmouth's South Embankment, Bayard's Cove and South Town, and the Kingswear shore (from the photographs).
    expect(nearest(-250, 470)).toBeLessThan(40);
    expect(nearest(-260, 130)).toBeLessThan(40);
    expect(nearest(-10, -460)).toBeLessThan(40);
    for (const w of walls) {
      expect(w.top).toBeGreaterThanOrEqual(QUAY_TOP_MIN);
      expect(w.top).toBeLessThanOrEqual(QUAY_TOP_MAX);
    }
  });

  it('leave the ferry slipways, the yacht club and the castles on their rocks alone', () => {
    for (const r of features.ferries.filter((f) => /lower ferry|higher ferry/i.test(f.name))) {
      for (const end of [r.route[0]!, r.route[r.route.length - 1]!]) expect(nearest(end[0], end[1]), r.name).toBeGreaterThan(10);
    }
    expect(nearest(-10, 0)).toBeGreaterThan(8);
    for (const l of features.landmarks.filter((x) => /^(dartmouth|kingswear) castle$|st petrox/i.test(x.name))) expect(nearest(l.e, l.n), l.name).toBeGreaterThan(60);
  });

  it('stand with the land on their left: the quay behind is filled level to the top, the water in front untouched', () => {
    const filled = fillBehindQuays(town, walls);
    const t2 = { spec: town.spec, values: filled };
    let checked = 0;
    for (const w of walls) {
      for (let k = 1; k < w.line.length; k++) {
        const [ae, an] = w.line[k - 1]!;
        const [be, bn] = w.line[k]!;
        const len = Math.hypot(be - ae, bn - an);
        if (len < 4) continue;
        const me = (ae + be) / 2;
        const mn = (an + bn) / 2;
        const le = -(bn - an) / len;
        const ln = (be - ae) / len;
        const behind = gridGround(t2, me + le * (QUAY_FILL_M / 2), mn + ln * (QUAY_FILL_M / 2));
        const front = gridGround(t2, me - le * 6, mn - ln * 6);
        const frontBefore = gridGround(town, me - le * 6, mn - ln * 6);
        if (behind === undefined || front === undefined) continue;
        expect(behind).toBeGreaterThan(w.top - 0.6);
        expect(front).toBeCloseTo(frontBefore!, 5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('are solid to the boats, as fixed walls', () => {
    const grid = new PierGrid(pierPieces(quayPiers(walls)));
    const w = walls.reduce((a, b) => (length(b.line) > length(a.line) ? b : a));
    const [ae, an] = w.line[0]!;
    const [be, bn] = w.line[1]!;
    const len = Math.hypot(be - ae, bn - an);
    // Just behind the face (inside the wall) is solid; 5 m out in front is open water.
    const me = (ae + be) / 2;
    const mn = (an + bn) / 2;
    const le = -(bn - an) / len;
    const ln = (be - ae) / len;
    // A point inside a convex piece (Vec is { n, e }): on the same side of every edge.
    const inPiece = (n: number, e: number) =>
      grid.pieces.some((pc) =>
        pc.pts.every((a, k) => {
          const b = pc.pts[(k + 1) % pc.pts.length]!;
          return (b.e - a.e) * (n - a.n) - (b.n - a.n) * (e - a.e) <= 1e-9;
        }) ||
        pc.pts.every((a, k) => {
          const b = pc.pts[(k + 1) % pc.pts.length]!;
          return (b.e - a.e) * (n - a.n) - (b.n - a.n) * (e - a.e) >= -1e-9;
        }),
      );
    expect(inPiece(mn + ln * 0.6, me + le * 0.6)).toBe(true);
    expect(inPiece(mn - ln * 5, me - le * 5)).toBe(false);
  });

  it('are found from the ground and the buildings alone (no houses, no walls)', () => {
    expect(quayWalls(town, [])).toEqual([]);
  });
});
