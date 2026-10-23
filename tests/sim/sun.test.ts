import { describe, expect, it } from 'vitest';
import { daylight, sunPosition } from '../../src/sim/env/sun';

// Reference: NREL SPA via pvlib 0.16.1 (spa_python) at RDYC, 50.34801 N 3.57339 W, 23 Oct 2026.
const REF = [
  { t: '2026-06-21T12:00:00Z', el: 62.9149, az: 171.8653 },
  { t: '2026-12-21T12:00:00Z', el: 16.2186, az: 177.0488 },
  { t: '2026-10-23T14:00:00Z', el: 22.7191, az: 212.4469 },
  { t: '2026-10-23T07:30:00Z', el: 5.3197, az: 114.908 },
  { t: '2026-03-20T18:10:00Z', el: 2.1872, az: 267.7918 },
  { t: '2026-07-15T13:00:00Z', el: 60.0895, az: 198.7541 },
  { t: '2026-01-05T08:15:00Z', el: -0.0787, az: 126.0271 },
  { t: '2026-09-01T19:45:00Z', el: -7.8205, az: 292.7773 },
];

describe('sun position (lights the scene)', () => {
  it('matches NREL SPA (pvlib) at RDYC across the year', () => {
    for (const r of REF) {
      const p = sunPosition(Date.parse(r.t), 50.34801, -3.57339);
      // Near or below the horizon the two refraction models differ by up to ~0.2°; above it by < 0.01°.
      expect(Math.abs(p.elevationDeg - r.el)).toBeLessThan(r.el < 3 ? 0.25 : 0.015);
      expect(Math.abs(p.azimuthDeg - r.az)).toBeLessThan(0.05);
    }
  });

  it('daylight fades through civil twilight', () => {
    expect(daylight(-10)).toBe(0);
    expect(daylight(30)).toBe(1);
    expect(daylight(2)).toBeGreaterThan(0.4);
    expect(daylight(2)).toBeLessThan(0.6);
  });
});
