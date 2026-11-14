/**
 * The main-stream ship buoys MS1–MS5 and the superyacht Mosaique moored on MS1–MS2 (owner, 14 Nov 2026). Their
 * positions are estimates from the harbour guide's description (src/sim/env/shipBuoys.ts); these tests hold what the
 * description says and what the river needs: numbered south to north, in deep water mid-river with the anchorage on
 * their Kingswear side, clear of the pontoons, the ferries and the moorings; the yacht between her two buoys; all of
 * it solid to the boats; and the river traffic routed round it.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { polygonContact } from '../../src/sim/race/hull';
import { raceStructures } from '../../src/sim/race/setup';
import { buildRiverTraffic } from '../../src/sim/env/traffic';
import { MOSAIQUE, MOSAIQUE_TENDER, SHIP_BUOYS, SHIP_BUOY_SIZE, mooredBerth, shipBuoyAvoidPoints, shipBuoyStructures, tenderOutline, yachtOutline } from '../../src/sim/env/shipBuoys';
import { pointInPolygon } from '../../src/sim/course/geometry';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const f = app.features as unknown as {
  piers: { name: string | null; poly?: [number, number][]; line?: [number, number][] }[];
  ferries: { name: string; route: [number, number][] }[];
  mooringAreas: { name: string; ring: [number, number][] }[];
  moorings: { e: number; n: number; l: number }[];
};

/** Distance (m) from a point to a polyline. */
function toLine(p: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i]!, line[i + 1]!];
    const le = b[0] - a[0];
    const ln = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * le + (p[1] - a[1]) * ln) / (le * le + ln * ln || 1)));
    best = Math.min(best, Math.hypot(a[0] + le * t - p[0], a[1] + ln * t - p[1]));
  }
  return best;
}
const inside = (p: [number, number], ring: [number, number][]) => pointInPolygon({ e: p[0], n: p[1] }, ring.map(([e, n]) => ({ e, n })));

describe('the main-stream ship buoys', () => {
  it('are MS1 to MS5, numbered south to north, in deep water in mid-river', () => {
    expect(SHIP_BUOYS.map((b) => b.id)).toEqual(['MS1', 'MS2', 'MS3', 'MS4', 'MS5']);
    for (let i = 1; i < SHIP_BUOYS.length; i++) expect(SHIP_BUOYS[i]!.n).toBeGreaterThan(SHIP_BUOYS[i - 1]!.n);
    for (const b of SHIP_BUOYS) {
      expect(app.geo.bedElevation(b.n, b.e)).toBeLessThan(-4);
      // Water on both sides for a good way: not near either bank.
      for (const de of [-60, 60]) expect(app.geo.bedElevation(b.n, b.e + de)).toBeLessThan(0);
    }
  });

  it('have the anchorage on their Kingswear (east) side and stand outside it', () => {
    const anchorage = f.mooringAreas.find((a) => a.name.startsWith('Mooring area'))!;
    for (const b of SHIP_BUOYS) expect(inside([b.e, b.n], anchorage.ring)).toBe(false);
    // Where the anchorage spans their latitude, it lies east of them.
    const west = Math.min(...anchorage.ring.map((p) => p[0]));
    for (const b of SHIP_BUOYS.filter((b) => b.n < 437)) expect(b.e).toBeLessThan(west);
  });

  it('are clear of the pontoons, the ferries’ crossings and the moorings', () => {
    for (const b of SHIP_BUOYS) {
      const p: [number, number] = [b.e, b.n];
      for (const pier of f.piers) {
        const pts = pier.poly ?? pier.line ?? [];
        if (pts.length >= 2) expect(toLine(p, pier.poly ? [...pts, pts[0]!] : pts)).toBeGreaterThan(30);
      }
      for (const fy of f.ferries.filter((x) => /Lower|Pedestrian|Higher/.test(x.name))) expect(toLine(p, fy.route)).toBeGreaterThan(30);
      for (const m of f.moorings) expect(Math.hypot(m.e - b.e, m.n - b.n)).toBeGreaterThan(m.l + 12);
    }
  });
});

describe('Mosaique on MS1 and MS2', () => {
  const outline = yachtOutline();
  const berth = mooredBerth();

  it('lies between her buoys, bow to MS2, with room for her lines at each end', () => {
    const [ms1, ms2] = [SHIP_BUOYS[0]!, SHIP_BUOYS[1]!];
    expect(MOSAIQUE.between).toEqual(['MS1', 'MS2']);
    const bearing = Math.atan2(ms2.e - ms1.e, ms2.n - ms1.n);
    expect(Math.abs(berth.heading - bearing)).toBeLessThan(1e-9);
    // Her outline (50 m and her swim platform) does not reach either buoy: 15 m or more for the lines.
    const gap = (b: { e: number; n: number }) => Math.min(...outline.map(([e, n]) => Math.hypot(e - b.e, n - b.n)));
    expect(gap(ms1)).toBeGreaterThan(15);
    expect(gap(ms2)).toBeGreaterThan(15);
    const along = outline.map(([e, n]) => (e - berth.e) * Math.sin(berth.heading) + (n - berth.n) * Math.cos(berth.heading));
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(MOSAIQUE.loa + MOSAIQUE_TENDER.platform, 5);
  });

  it('is clear of the moorings laid out in the anchorage (each boat can swing)', () => {
    const near = (p: [number, number]) => Math.min(...[...outline, ...tenderOutline()].map(([e, n]) => Math.hypot(e - p[0], n - p[1])));
    for (const m of f.moorings) expect(near([m.e, m.n])).toBeGreaterThan(m.l + 5);
  });

  it('she, her tender and the buoys are solid to the boats on the river data, and only there', () => {
    const solid = raceStructures(app.features as never, app.geo);
    for (const s of shipBuoyStructures()) expect(solid.some((x) => x.name === s.name)).toBe(true);
    expect(raceStructures(app.features as never, undefined).some((x) => x.name === 'the superyacht Mosaique')).toBe(false);
  });
});

/** Sail a Squib at `kn` straight at a point from 30 m off on `headingDeg` for 15 s: the contacts and how deep she got. */
function sailInto(target: { e: number; n: number }, headingDeg: number, poly: [number, number][], kn = 4) {
  const h = (headingDeg * Math.PI) / 180;
  const env = { ...uniformEnvironment({ twsKn: 10, twdDeg: (headingDeg + 90) % 360 }), startEpochMs: Date.parse('2026-07-15T13:00:00Z'), waterLevel: () => 2 };
  const sim = new Simulation({ params: squibParams(), env, seabed: app.geo, ownsEnvironment: false, initial: { n: target.n - Math.cos(h) * 30, e: target.e - Math.sin(h) * 30, headingDeg, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const fleet = new Fleet(env);
  const b = fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
  fleet.setObstacles({ piers: raceStructures(app.features as never, app.geo) });
  const shape = poly.map(([e, n]) => ({ e, n }));
  let deepest = 0;
  for (let s = 0; s < 1500; s++) {
    fleet.stepOnce();
    const c = polygonContact((fleet as unknown as { body: (x: unknown) => { pts: { n: number; e: number }[] } }).body(b).pts, shape);
    if (c) deepest = Math.max(deepest, c.depth);
  }
  return { deepest, events: fleet.events };
}

describe('meeting them', () => {
  it('a Squib sailed square into Mosaique’s side meets her and stays out of her', () => {
    const berth = mooredBerth();
    // Her port side amidships, from the west, square on.
    const side = { e: berth.e - Math.cos(berth.heading) * (MOSAIQUE.beam / 2), n: berth.n + Math.sin(berth.heading) * (MOSAIQUE.beam / 2) };
    const r = sailInto(side, (berth.heading * 180) / Math.PI + 90, yachtOutline());
    expect(r.events.some((e) => e.label.includes('Mosaique'))).toBe(true);
    expect(r.deepest).toBeLessThan(0.6);
  });

  it('and into a ship buoy: she meets it', () => {
    const b = SHIP_BUOYS[3]!;
    const r = sailInto(b, 90, Array.from({ length: 10 }, (_, i) => [b.e + (SHIP_BUOY_SIZE.diameter / 2) * Math.cos((i / 10) * Math.PI * 2), b.n + (SHIP_BUOY_SIZE.diameter / 2) * Math.sin((i / 10) * Math.PI * 2)] as [number, number]));
    expect(r.events.some((e) => e.label.includes('ship buoy MS4'))).toBe(true);
    expect(r.deepest).toBeLessThan(0.6);
  });
});

describe('river traffic', () => {
  it('keeps off the buoys and the yacht', () => {
    const avoid = shipBuoyAvoidPoints();
    for (const b of SHIP_BUOYS) expect(avoid.some((p) => p.e === b.e && p.n === b.n)).toBe(true);
    const traffic = buildRiverTraffic({ ferries: f.ferries as never, geo: app.geo, moorings: f.moorings as never, marinas: (app.features as { marinas?: never }).marinas, piers: f.piers as never });
    const start = Date.parse('2026-07-15T08:00:00Z');
    const yacht = yachtOutline();
    let checked = 0;
    for (let t = 0; t < 10 * 3600; t += 20) {
      for (const s of traffic.states(start + t * 1000)) {
        if (s.phase === 'berthed' || /Ferry|ferry/.test(s.name ?? '')) continue;
        checked++;
        expect(inside([s.e, s.n], yacht)).toBe(false);
        for (const b of SHIP_BUOYS) expect(Math.hypot(s.e - b.e, s.n - b.n)).toBeGreaterThan(4);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
