/**
 * The rocky coast at the mouth (owner, 17 Nov 2026: "improve the western cliffs and rocks at the mouth"): the shore
 * traced from the terrain south of the towns, with rock faces along it, cliffs where the ground is steep or
 * OpenStreetMap maps a cliff, beaches and the buildings and piers at the water left clear, boulders at the foot,
 * and the faces solid to the boats.
 */
import { describe, expect, it } from 'vitest';
import { raceStructures } from '../../src/sim/race/setup';
import { ROCK_FOOT_ODN, coastRockCover, coastRockStructures, coastRocks, inRockyCoast, openCoast } from '../../src/sim/env/coastRocks';
import { BEACHES, CLIFF_LINES, HEATH } from '../../src/sim/env/coastData';
import { DART_PROJECTION } from '../../src/sim/geo/projection';
import { pointInPolygon } from '../../src/sim/course/geometry';
import { kingswearLightLocal } from '../../src/sim/env/shoreLights';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const bed = (n: number, e: number) => app.geo.bedElevation(n, e);
const rocks = coastRocks(app.geo, bed, app.features as never);
const sections = rocks.runs.flat();
const local = (pts: [number, number][]) => pts.map(([lat, lon]) => DART_PROJECTION.toLocal(lat, lon));
const nearest = (e: number, n: number) => Math.min(...sections.map((s) => Math.hypot(s.e - e, s.n - n)));

describe('the rocky coast', () => {
  it('runs along both shores of the mouth and the open coast, and only south of the towns', () => {
    expect(sections.length).toBeGreaterThan(3000);
    for (const s of sections) expect(inRockyCoast(s.e, s.n)).toBe(true);
    // The west shore by Compass Cove and Blackstone Point, the cliffs at Little Dartmouth, the Kingswear shore.
    const compass = local(BEACHES.find((b) => b.name === 'Compass Cove')!.pts);
    expect(Math.min(...compass.map((p) => nearest(p.e, p.n)))).toBeLessThan(40);
    const cliff = local(CLIFF_LINES.find((c) => Math.abs(c.pts[0]![0] - 50.327) < 0.002 && Math.abs(c.pts[0]![1] + 3.5714) < 0.003)!.pts);
    expect(Math.min(...cliff.map((p) => nearest(p.e, p.n)))).toBeLessThan(60);
    expect(sections.some((s) => s.e > 900 && s.n < -500 && s.n > -1400)).toBe(true);
  });

  it('each section stands at the shore, faces the sea, and its top meets the hillside behind', () => {
    // On the traced contour: the 5 m grid's interpolation of the ground, which steps at the water's edge in a few
    // places (where the survey of the bed meets the land's), so a few sections sit a little off it.
    const off = sections.map((s) => Math.abs(bed(s.n, s.e) - ROCK_FOOT_ODN)).sort((a, b) => a - b);
    expect(off[Math.floor(off.length / 2)]!).toBeLessThan(0.5);
    expect(off[Math.floor(off.length * 0.95)]!).toBeLessThan(2);
    expect(off[off.length - 1]!).toBeLessThan(8);
    // Inland is uphill and seaward lower (all but a few, at the knots of the contour round single rocks).
    const uphill = sections.filter((s) => bed(s.n + s.un * 6, s.e + s.ue * 6) > bed(s.n - s.un * 6, s.e - s.ue * 6));
    expect(uphill.length / sections.length).toBeGreaterThan(0.97);
    for (const s of sections) {
      expect(s.face).toBeGreaterThan(0.2);
      expect(s.face).toBeLessThanOrEqual(24);
      expect(s.shelf).toBeGreaterThan(0);
      expect(s.shelf).toBeLessThanOrEqual(14);
    }
  });

  it('is cliff where OpenStreetMap maps a cliff, and low ledges where the shore is gentle', () => {
    const lines = CLIFF_LINES.map((c) => local(c.pts));
    const atCliff = sections.filter((s) => lines.some((l) => l.some((p) => Math.hypot(p.e - s.e, p.n - s.n) < 25)));
    expect(atCliff.length).toBeGreaterThan(20);
    const mean = atCliff.reduce((a, s) => a + s.face, 0) / atCliff.length;
    expect(mean).toBeGreaterThan(5);
    expect(atCliff.every((s) => s.cliff)).toBe(true);
    expect(sections.some((s) => s.face < 2)).toBe(true);
  });

  it('leaves the beaches clear (Blackpool Sands, Compass Cove …), and the buildings, piers and the Kingswear light', () => {
    for (const b of BEACHES) {
      const ring = local(b.pts);
      for (const s of sections) expect(pointInPolygon({ e: s.e, n: s.n }, ring)).toBe(false);
    }
    const kl = kingswearLightLocal();
    for (const s of sections) expect(Math.hypot(s.e - kl.e, s.n - kl.n)).toBeGreaterThan(9);
    const cells = new Map<string, [number, number][]>();
    for (const [e, n] of (app.features.buildings ?? []).flatMap((b) => b.r)) {
      const k = `${Math.floor(e / 10)},${Math.floor(n / 10)}`;
      cells.set(k, [...(cells.get(k) ?? []), [e, n]]);
    }
    for (const s of sections) {
      const ci = Math.floor(s.e / 10);
      const cj = Math.floor(s.n / 10);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const [e, n] of cells.get(`${i},${j}`) ?? []) expect(Math.hypot(e - s.e, n - s.n)).toBeGreaterThan(5);
    }
  });

  it('has boulders at the foot, between low and high water (and on the rock OpenStreetMap maps)', () => {
    expect(rocks.boulders.length).toBeGreaterThan(500);
    for (const b of rocks.boulders) {
      expect(b.size).toBeGreaterThan(0.4);
      expect(b.size).toBeLessThan(4);
      expect(Number.isFinite(b.base)).toBe(true);
    }
  });

  it('is the same every time (worked out once for each ground)', () => {
    expect(coastRocks(app.geo, bed, app.features as never)).toBe(rocks);
    const again = coastRocks({}, bed, app.features as never);
    expect(again.runs.flat().length).toBe(sections.length);
    expect(again.boulders.length).toBe(rocks.boulders.length);
  });

  it('its faces are solid to the boats at their foot', () => {
    const solid = raceStructures(app.features as never, app.geo).filter((s) => s.name === 'the rocks');
    expect(solid.length).toBe(coastRockStructures(rocks).length);
    expect(solid.every((s) => !s.floating && 'poly' in s)).toBe(true);
    // The foot of the sections lies in the pieces (the second of each of the first runs: inside its piece, not on an edge).
    const polys = solid.map((p) => ('poly' in p ? p.poly! : []).map(([e, n]) => ({ e, n })));
    for (const run of rocks.runs.slice(0, 20)) {
      const s = run[1]!;
      const foot = { e: s.e - s.ue * 0.5, n: s.n - s.un * 0.5 };
      expect(polys.some((p) => pointInPolygon(foot, p))).toBe(true);
    }
    expect(raceStructures(app.features as never, undefined).some((p) => p.name === 'the rocks')).toBe(false);
  });

  it('no trees on the rock or the open heath and beaches', () => {
    const cover = coastRockCover(rocks);
    const s = sections[100]!;
    expect(cover(s.e + s.ue, s.n + s.un)).toBe(true);
    const open = openCoast();
    const heath = local(HEATH[0]!.pts);
    const c = heath.reduce((a, p) => ({ e: a.e + p.e / heath.length, n: a.n + p.n / heath.length }), { e: 0, n: 0 });
    expect(pointInPolygon(c, heath) ? open(c.e, c.n) : true).toBe(true);
    // Nowhere in the towns.
    expect(open(0, 300)).toBe(false);
  });
});
