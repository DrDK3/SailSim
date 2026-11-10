/**
 * Boats in their berths are solid (owner, 10 Nov 2026: "the squib sails through boats in the marina areas"): the
 * fleet meets every boat the picture draws lying in a marina or pontoon berth while that berth is taken, and the
 * training boats at the Sandquay pontoon.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { boxOutline, placeOutline, polygonContact } from '../../src/sim/race/hull';
import { buildRiverTraffic } from '../../src/sim/env/traffic';
import { FIXED_BOATS } from '../../src/sim/env/marinas';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const f = app.features as unknown as Parameters<typeof buildRiverTraffic>[0] & { moorings: { n: number; e: number }[] };
const traffic = buildRiverTraffic({ ferries: f.ferries, geo: app.geo, moorings: f.moorings, marinas: f.marinas, piers: f.piers });
const START = Date.parse('2026-07-15T13:00:00Z');

/** Sail at `kn` straight at a point from 25 m off on `headingDeg`, for 12 s; how deep the hull got into the box. */
function sailInto(target: { n: number; e: number; heading: number; length: number; beam: number }, headingDeg: number, kn = 4) {
  const h = (headingDeg * Math.PI) / 180;
  const n = target.n - Math.cos(h) * 25;
  const e = target.e - Math.sin(h) * 25;
  const env = { ...uniformEnvironment({ twsKn: 10, twdDeg: (headingDeg + 90) % 360 }), startEpochMs: START, waterLevel: () => 2 };
  const sim = new Simulation({ params: squibParams(), env, seabed: app.geo, ownsEnvironment: false, initial: { n, e, headingDeg, speedKn: kn }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const fleet = new Fleet(env);
  const b = fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
  fleet.setObstacles({ traffic });
  const box = placeOutline(boxOutline(target.length * 0.95, target.beam * 0.9), target.n, target.e, target.heading);
  let deepest = 0;
  for (let s = 0; s < 1200; s++) {
    fleet.stepOnce();
    const c = polygonContact((fleet as unknown as { body: (x: unknown) => { pts: { n: number; e: number }[] } }).body(b).pts, box);
    if (c) deepest = Math.max(deepest, c.depth);
  }
  return { deepest, events: fleet.events };
}

describe('boats in their berths are solid', () => {
  it('there are berths, and at midday in July most are taken', () => {
    expect(traffic.berths.length).toBeGreaterThan(100);
    const taken = traffic.berthsTaken(START);
    expect([...taken].filter((x) => x).length).toBeGreaterThan(traffic.berths.length / 3);
  });

  it('sailing into a taken berth from abeam: she hits the boat in it and stays out of her', () => {
    const taken = traffic.berthsTaken(START);
    // Taken berths whose boat has open water off her side (her outer berth: nothing within 12 m beyond her beam).
    const outer = traffic.berths.filter((b, i) => taken[i] && traffic.berths.every((o, j) => j === i || Math.hypot(o.n - b.n, o.e - b.e) > 12));
    expect(outer.length).toBeGreaterThan(3);
    let tested = 0;
    for (const b of outer.slice(0, 6)) {
      // Square on to her side, from the side away from the land (try both).
      for (const side of [90, -90]) {
        const hd = (b.heading * 180) / Math.PI + side;
        const r = sailInto(b, hd);
        if (!r.events.some((e) => e.label.startsWith('a boat in her berth'))) continue;
        tested++;
        expect(r.deepest).toBeLessThan(0.6);
        break;
      }
    }
    expect(tested).toBeGreaterThan(2);
  });

  it('an empty berth lets her through; the Sandquay training boats are solid', () => {
    const taken = traffic.berthsTaken(START);
    const i = traffic.berths.findIndex((b, k) => !taken[k] && traffic.berths.every((o, j) => j === k || Math.hypot(o.n - b.n, o.e - b.e) > 12));
    if (i >= 0) {
      const r = sailInto(traffic.berths[i]!, (traffic.berths[i]!.heading * 180) / Math.PI + 90);
      expect(r.events.some((e) => e.label.startsWith('a boat in her berth'))).toBe(false);
    }
    const tb = FIXED_BOATS[1]!;
    const r = sailInto(tb, (tb.heading * 180) / Math.PI + 90);
    expect(r.events.some((e) => e.label === tb.label)).toBe(true);
    expect(r.deepest).toBeLessThan(0.6);
  });
});
