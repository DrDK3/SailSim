/**
 * Trot moorings from Dart Haven Marina up to the Higher Ferry (owner, 17 Nov 2026): the boats there lie fore and
 * aft in rows along the river and do not swing; the boats above the Higher Ferry keep their swinging moorings. The
 * trot boats are solid, in water, and clear of the ferries, the river traffic, the ship buoys and Mosaique, the
 * pontoons and each other (src/sim/env/trots.ts; positions and bearings E).
 */
import { describe, expect, it } from 'vitest';
import { MEAN_LEVEL_CD, Simulation, squibParams, uniformEnvironment, type Environment } from '../../src/sim/index';
import { TROT_AREAS, TROT_BUOY_OFF, isTrotArea, trotBuoys, trotHeading } from '../../src/sim/env/trots';
import { mooredBoatPose, mooringSwingDeg } from '../../src/sim/race/anchored';
import { Fleet } from '../../src/sim/race/fleet';
import { boxOutline, placeOutline, polygonContact, type Vec } from '../../src/sim/race/hull';
import { raceStructures } from '../../src/sim/race/setup';
import { buildRiverTraffic } from '../../src/sim/env/traffic';
import { pointInPolygon } from '../../src/sim/course/geometry';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const geo = app.geo;
type Mooring = { e: number; n: number; l: number; h: number; a: string; k: string };
const f = app.features as unknown as {
  moorings: Mooring[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  marinas: { name: string; n: number; e: number }[];
  ferries: { name: string; route: [number, number][] }[];
  piers: { name: string | null; poly?: [number, number][]; line?: [number, number][] }[];
};
const DEG = Math.PI / 180;
const trots = f.moorings.filter((m) => isTrotArea(m.a));
const swinging = f.moorings.filter((m) => !isTrotArea(m.a));
const higherFerry = f.ferries.find((x) => /Higher Ferry/.test(x.name))!.route;
const dartHaven = f.marinas.find((m) => m.name === 'Dart Haven Marina')!;
const env = (windFromDeg: number, setDeg: number, kn: number): Environment => uniformEnvironment({ twsKn: 10, twdDeg: windFromDeg, currentSetDeg: setDeg, currentRateKn: kn });
/** A trot boat's hull as the physics meets it (src/sim/race/fleet.ts: a box l × 0.33 l). */
const hull = (m: Mooring): Vec[] => {
  const p = mooredBoatPose({ ...m, area: m.a }, env(0, 0, 0), 0);
  return placeOutline(boxOutline(m.l, m.l * 0.33), p.n, p.e, p.heading);
};

/** Distance (m) from a point to a segment. */
function toSegment(p: Vec, a: Vec, b: Vec): number {
  const ln = b.n - a.n;
  const le = b.e - a.e;
  const t = Math.max(0, Math.min(1, ((p.n - a.n) * ln + (p.e - a.e) * le) / (ln * ln + le * le || 1)));
  return Math.hypot(a.n + ln * t - p.n, a.e + le * t - p.e);
}
/** Least distance (m) between two polylines or polygons (closed when `closeA`/`closeB`); 0 if they cross. */
function between(A: Vec[], B: Vec[], closeA = true, closeB = true): number {
  const segs = (P: Vec[], close: boolean) => P.map((p, i) => [p, P[(i + 1) % P.length]!] as const).slice(0, close ? P.length : P.length - 1);
  if (closeA && B.some((p) => pointInPolygon(p, A))) return 0;
  if (closeB && A.some((p) => pointInPolygon(p, B))) return 0;
  let best = Infinity;
  for (const [a0, a1] of segs(A, closeA)) for (const [b0, b1] of segs(B, closeB)) {
    best = Math.min(best, toSegment(a0, b0, b1), toSegment(a1, b0, b1), toSegment(b0, a0, a1), toSegment(b1, a0, a1));
  }
  return best;
}
const ne = (pts: [number, number][]): Vec[] => pts.map(([e, n]) => ({ n, e }));

describe('trot moorings from Dart Haven Marina to the Higher Ferry', () => {
  it('are the two mapped areas in that stretch; the areas above the Higher Ferry keep swinging moorings', () => {
    expect(Object.keys(TROT_AREAS).sort()).toEqual(['Kingswear Trots', 'Mooring area (DHNA)']);
    for (const a of f.mooringAreas) {
      // Signed side of the Higher Ferry's crossing (its line, extended): below it is the stretch.
      const [p, q] = [higherFerry[0]!, higherFerry[higherFerry.length - 1]!];
      const below = a.ring.every(([e, n]) => (q[0] - p[0]) * (n - p[1]) - (q[1] - p[1]) * (e - p[0]) < 0);
      const fromMarina = a.ring.some(([, n]) => n > dartHaven.n - 50);
      expect(isTrotArea(a.name), a.name).toBe(below && fromMarina);
    }
    expect(trots.length).toBe(292);
    expect(swinging.length).toBeGreaterThan(100);
    expect(new Set(swinging.map((m) => m.a))).toEqual(new Set(['Noss Trots', 'Distins Trots']));
  });

  it('lie fore and aft along their rows: the same pose whatever the wind and stream', () => {
    for (const m of trots.slice(0, 40)) {
      const poses = [env(0, 0, 0), env(90, 0, 0), env(225, 180, 2), env(300, 10, 1.5)].map((e) => mooredBoatPose({ ...m, area: m.a, swingDeg: mooringSwingDeg(m.h) }, e, 0));
      for (const p of poses) {
        expect(p.n).toBe(m.n);
        expect(p.e).toBe(m.e);
        expect(p.heading).toBeCloseTo(trotHeading(m.a)!, 12);
      }
    }
  });

  it('boats outside the stretch still swing to the wind and the stream', () => {
    const m = swinging[0]!;
    const a = mooredBoatPose({ ...m, area: m.a }, env(0, 0, 0), 0);
    const b = mooredBoatPose({ ...m, area: m.a }, env(90, 0, 0), 0);
    expect(Math.abs(a.heading - b.heading)).toBeGreaterThan(80 * DEG);
  });

  it('the rows are the layout\'s rows (boats nose to tail, 16 m apart) and run with the modelled ebb (within 30°)', () => {
    for (const [area, { headingDeg }] of Object.entries(TROT_AREAS)) {
      const ms = trots.filter((m) => m.a === area);
      let rowPairs = 0;
      for (let i = 1; i < ms.length; i++) {
        const de = ms[i]!.e - ms[i - 1]!.e;
        const dn = ms[i]!.n - ms[i - 1]!.n;
        if (Math.abs(Math.hypot(de, dn) - 16) > 0.3) continue;
        rowPairs++;
        // Along the row, either way (within the layout's 0.1 m rounding).
        const along = Math.atan2(de, dn) / DEG;
        expect(Math.abs(Math.sin((along - headingDeg) * DEG))).toBeLessThan(Math.sin(0.6 * DEG));
      }
      expect(rowPairs).toBeGreaterThan(ms.length * 0.8);
    }
    let worst = 0;
    for (const m of trots) {
      const s = geo.streamPattern(m.n, m.e).tidal;
      if (Math.hypot(s.n, s.e) < 0.15) continue; // eddies and slack corners: no meaningful axis
      const up = Math.atan2(-s.e, -s.n); // head to the ebb
      worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(up - trotHeading(m.a)!), Math.cos(up - trotHeading(m.a)!))) / DEG);
    }
    expect(worst).toBeLessThan(30);
  });

  it('are in water, hull and both buoys, at 0.5 m above chart datum, and at mean level', () => {
    for (const level of [0.5 - geo.cdBelowOdn, MEAN_LEVEL_CD - geo.cdBelowOdn]) {
      for (const m of trots) {
        for (const p of [...hull(m), ...trotBuoys(m, trotHeading(m.a)!)]) expect(geo.depth(p.n, p.e, level)).toBeGreaterThan(1.5);
      }
    }
  });

  it('do not touch each other, their neighbours\' buoys, or a swinging boat\'s circle', () => {
    for (let i = 0; i < trots.length; i++) {
      const a = trots[i]!;
      const ha = hull(a);
      for (let j = i + 1; j < trots.length; j++) {
        const b = trots[j]!;
        if (Math.hypot(a.n - b.n, a.e - b.e) > 30) continue;
        expect(polygonContact(ha, hull(b))).toBeNull();
        for (const q of trotBuoys(b, trotHeading(b.a)!)) expect(pointInPolygon(q, ha)).toBe(false);
        expect(between(ha, hull(b))).toBeGreaterThan(1.5);
      }
      for (const s of swinging) expect(Math.hypot(a.n - s.n, a.e - s.e)).toBeGreaterThan(a.l / 2 + s.l + 2 + 5);
      // The buoys are clear of the boat itself.
      for (const q of trotBuoys(a, trotHeading(a.a)!)) expect(Math.hypot(q.n - a.n, q.e - a.e)).toBeCloseTo(a.l / 2 + TROT_BUOY_OFF, 9);
    }
  });

  it('are clear of the ferries\' crossings, the pontoons, the ship buoys, Mosaique and her lines', () => {
    for (const fy of f.ferries) {
      for (const m of trots) expect(between(hull(m), ne(fy.route), true, false), `${fy.name}`).toBeGreaterThan(15);
    }
    // Every solid structure the boats meet: piers and pontoons, buildings in the water, the ship buoys, Mosaique,
    // her tender and her mooring lines.
    const solid = raceStructures(app.features as never, geo);
    let nearest = Infinity;
    for (const s of solid) {
      const shape = 'poly' in s && s.poly ? { pts: ne(s.poly as [number, number][]), closed: true } : 'line' in s && s.line ? { pts: ne(s.line as [number, number][]), closed: false } : undefined;
      if (!shape || shape.pts.length < 2) continue;
      for (const m of trots) {
        if (shape.pts.every((p) => Math.hypot(p.n - m.n, p.e - m.e) > 400)) continue;
        nearest = Math.min(nearest, between(hull(m), shape.pts, true, shape.closed));
      }
    }
    expect(nearest).toBeGreaterThan(5);
  });

  it('the river traffic never runs through a trot boat over a summer day', () => {
    const traffic = buildRiverTraffic({ ferries: f.ferries as never, geo, moorings: f.moorings, marinas: f.marinas, piers: f.piers as never });
    const t0 = Date.parse('2026-07-15T06:00:00Z');
    const hulls = trots.map((m) => ({ m, h: hull(m) }));
    let checked = 0;
    for (let t = t0; t < t0 + 15 * 3600_000; t += 20_000) {
      for (const v of traffic.states(t)) {
        for (const p of v.parts) {
          for (const { m, h } of hulls) {
            if (Math.hypot(p.n - m.n, p.e - m.e) > p.length / 2 + m.l / 2 + 2) continue;
            checked++;
            expect(polygonContact(placeOutline(boxOutline(p.length, p.beam), p.n, p.e, p.heading), h), `${v.name} at ${new Date(t).toISOString()}`).toBeNull();
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('are solid: a Squib sailed square at a trot boat\'s side meets her and does not pass through', () => {
    const m = trots.find((x) => x.a === 'Kingswear Trots' && x.l > 9)!;
    const heading = trotHeading(m.a)!;
    const P = squibParams();
    // From 20 m off her starboard side, square on, at 3 kn, in slack water.
    const toward = heading - Math.PI / 2;
    const e0 = uniformEnvironment({ twsKn: 8, twdDeg: ((toward / DEG + 90) % 360 + 360) % 360 });
    const start = { n: m.n - Math.cos(toward) * 20, e: m.e - Math.sin(toward) * 20 };
    const s = new Simulation({ params: P, env: e0, ownsEnvironment: false, initial: { ...start, headingDeg: toward / DEG, speedKn: 3 }, input: { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, autoCrew: false }, lockHeading: true, logInputs: false });
    const fleet = new Fleet(e0);
    fleet.add({ id: 'a', name: 'A', sailNumber: '1', colour: 0, kind: 'human', sim: s });
    fleet.setObstacles({ moored: [{ n: m.n, e: m.e, l: m.l, area: m.a, swingDeg: mooringSwingDeg(m.h) }] });
    let hit = false;
    for (let i = 0; i < 1500; i++) if (fleet.stepOnce().some((ev) => ev.kind === 'moored')) hit = true;
    expect(hit).toBe(true);
    // She has not come out on the far side of the moored boat's centre line.
    const st = s.state;
    const across = (st.n - m.n) * Math.cos(toward) + (st.e - m.e) * Math.sin(toward);
    expect(across).toBeLessThan(0);
  });
});
