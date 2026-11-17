/**
 * The islets off the mouth of the Dart (owner, 16–17 Nov 2026: "review the mouth of the river dart area and start bay
 * ... including buoys, islands etc."): they were missing (the LIDAR terrain has no survey there, so the water covered
 * them). Their outlines are OpenStreetMap's; these tests hold that they are all there, where the water was, solid to
 * the boats, and clear of the navigation marks; and that the Daymark stands on the hill above Froward Point.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { raceStructures } from '../../src/sim/race/setup';
import { ISLETS, isletOutlines, isletStructures } from '../../src/sim/env/islets';
import { CLUB_MARKS } from '../../src/sim/course/clubMarks';
import { DART_PROJECTION } from '../../src/sim/geo/projection';
import { DAYMARK } from '../../src/render/daymark';
import { pointInPolygon } from '../../src/sim/course/geometry';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const area = (r: [number, number][]) => r.reduce((a, p, i) => a + (p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1]) / 2, 0);
const centre = (r: [number, number][]) => ({ e: r.reduce((a, p) => a + p[0], 0) / r.length, n: r.reduce((a, p) => a + p[1], 0) / r.length });

describe('the islets off the mouth', () => {
  it('are all there: the Mew Stone, Shag Stone, Shooter Rock, Eastern Black Rock, the Western Blackstone, the Dancing Beggars', () => {
    const names = new Set(ISLETS.map((i) => i.name));
    for (const n of ['Mew Stone', 'Shag Stone', 'Shooter Rock', 'Eastern Black Rock', 'Western Blackstone', 'Dancing Beggars']) expect(names.has(n)).toBe(true);
    for (const i of ISLETS) expect(i.height).toBeGreaterThan(0);
  });

  it('their outlines are counter-clockwise, and the Mew Stone is the big one (about 120 m by 100 m)', () => {
    const outs = isletOutlines();
    for (const o of outs) expect(area(o.ring)).toBeGreaterThan(0);
    const mew = outs.find((o) => o.name === 'Mew Stone')!;
    expect(area(mew.ring)).toBeGreaterThan(4000);
    expect(area(mew.ring)).toBeLessThan(7000);
    for (const o of outs.filter((x) => x.name !== 'Mew Stone')) expect(area(o.ring)).toBeLessThan(area(mew.ring));
  });

  it('stand where the sim had open water (that is why they were missing)', () => {
    for (const o of isletOutlines()) {
      const c = centre(o.ring);
      if (!app.geo.inDomain(c.n, c.e)) continue;
      expect(app.geo.bedElevation(c.n, c.e)).toBeLessThan(0.5);
    }
  });

  it('are solid to the boats on the river data, and only there', () => {
    const solid = raceStructures(app.features as never, app.geo);
    for (const s of isletStructures()) {
      const x = solid.find((p) => p.name === s.name);
      expect(x).toBeDefined();
      expect(x!.floating).toBe(false);
    }
    expect(raceStructures(app.features as never, undefined).some((s) => s.name === 'the Mew Stone')).toBe(false);
  });

  it('no navigation or club mark lies on an islet; the Mewstone and West Rock cardinals lie clear to the south', () => {
    const outs = isletOutlines();
    for (const m of CLUB_MARKS) {
      const p = DART_PROJECTION.toLocal(m.lat, m.lon);
      for (const o of outs) expect(pointInPolygon(p, o.ring.map(([e, n]) => ({ e, n })))).toBe(false);
    }
    const mew = centre(outs.find((o) => o.name === 'Mew Stone')!.ring);
    for (const id of ['M', 'R']) {
      const cm = CLUB_MARKS.find((m) => m.id === id)!;
      const p = DART_PROJECTION.toLocal(cm.lat, cm.lon);
      expect(p.n).toBeLessThan(mew.n);
    }
  });

  it('a Squib sailed straight at the Mew Stone meets it and stays out', () => {
    const mew = isletOutlines().find((o) => o.name === 'Mew Stone')!;
    const c = centre(mew.ring);
    // From the south-west, 80 m off the middle, heading for it.
    const headingDeg = 45;
    const h = (headingDeg * Math.PI) / 180;
    const env = { ...uniformEnvironment({ twsKn: 10, twdDeg: 135 }), startEpochMs: Date.parse('2026-07-15T13:00:00Z'), waterLevel: () => 2 };
    const sim = new Simulation({ params: squibParams(), env, seabed: app.geo, ownsEnvironment: false, initial: { n: c.n - Math.cos(h) * 90, e: c.e - Math.sin(h) * 90, headingDeg, speedKn: 4 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    const fleet = new Fleet(env);
    const b = fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
    fleet.setObstacles({ piers: raceStructures(app.features as never, app.geo) });
    const shape = mew.ring.map(([e, n]) => ({ e, n }));
    // The rock is not convex: measure how far any point of her hull gets inside its outline (to the nearest edge).
    const toEdge = (q: { e: number; n: number }) =>
      Math.min(
        ...mew.ring.map(([e0, n0], i) => {
          const [e1, n1] = mew.ring[(i + 1) % mew.ring.length]!;
          const le = e1 - e0;
          const ln = n1 - n0;
          const t = Math.max(0, Math.min(1, ((q.e - e0) * le + (q.n - n0) * ln) / (le * le + ln * ln || 1)));
          return Math.hypot(e0 + le * t - q.e, n0 + ln * t - q.n);
        }),
      );
    let deepest = 0;
    for (let s = 0; s < 2400; s++) {
      fleet.stepOnce();
      const pts = (fleet as unknown as { body: (x: unknown) => { pts: { n: number; e: number }[] } }).body(b).pts;
      for (const q of pts) if (pointInPolygon(q, shape)) deepest = Math.max(deepest, toEdge(q));
    }
    expect(fleet.events.some((e) => e.label === 'the Mew Stone')).toBe(true);
    // Contact gives a little at the moment she strikes (as at the pontoons and the ferries): no deeper than that.
    expect(deepest).toBeLessThan(0.6);
  });
});

describe('the Daymark', () => {
  it('stands on the hill above Froward Point, east of the mouth', () => {
    const p = DART_PROJECTION.toLocal(DAYMARK.lat, DAYMARK.lon);
    expect(app.geo.bedElevation(p.n, p.e)).toBeGreaterThan(100);
    // East of Kingswear Castle and north of Froward Point.
    expect(p.e).toBeGreaterThan(1500);
    expect(p.n).toBeGreaterThan(-1100);
    expect(DAYMARK.height).toBe(24);
  });
});
