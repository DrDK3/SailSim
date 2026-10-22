import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DART_PROJECTION, RDYC_ORIGIN, createLocalProjection, haversine } from '../../src/sim/index';

interface Fixture { source: string; points: { lat: number; lon: number; n: number; e: number }[] }
const fx = JSON.parse(readFileSync(new URL('../fixtures/projection-pyproj.json', import.meta.url), 'utf8')) as Fixture;

describe('local projection (Transverse Mercator about RDYC)', () => {
  it('matches PROJ to within 1 mm across and beyond the simulation area', () => {
    let worst = 0;
    for (const p of fx.points) {
      const q = DART_PROJECTION.toLocal(p.lat, p.lon);
      const near = Math.abs(p.lat - RDYC_ORIGIN.lat) < 0.2 && Math.abs(p.lon - RDYC_ORIGIN.lon) < 0.2;
      const err = Math.hypot(q.n - p.n, q.e - p.e);
      if (near) worst = Math.max(worst, err);
      expect(err).toBeLessThan(near ? 0.001 : 0.01); // 50–100 km away: still under 1 cm
    }
    console.log(`[projection] worst difference from ${fx.source} over the area: ${(worst * 1000).toFixed(3)} mm`);
  });

  it('round-trips (inverse) to better than 1 mm', () => {
    for (const p of fx.points) {
      const back = DART_PROJECTION.toLatLon(p.n, p.e);
      expect(Math.abs(back.lat - p.lat) * 111_000).toBeLessThan(0.001);
      expect(Math.abs(back.lon - p.lon) * 71_000).toBeLessThan(0.001);
    }
  });

  it('origin maps to (0, 0); distances agree with the great circle to the sphere/ellipsoid difference', () => {
    const o = createLocalProjection(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon).toLocal(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon);
    expect(Math.hypot(o.n, o.e)).toBeLessThan(1e-9);
    for (const p of fx.points.slice(1, 5)) {
      const d = Math.hypot(p.n, p.e);
      expect(Math.abs(d - haversine(RDYC_ORIGIN.lat, RDYC_ORIGIN.lon, p.lat, p.lon)) / d).toBeLessThan(0.003);
    }
  });
});
