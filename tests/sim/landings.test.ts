/** River boats lie alongside their landings (not across the pier), clear of each other; moored ships and buildings in the water are solid. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PADDLE_STEAMER, buildRiverTraffic } from '../../src/sim/env/traffic';
import { landingBerths, type LandingClaim } from '../../src/sim/env/landings';
import { structuresInWater } from '../../src/sim/env/structures';
import { PierGrid, pierPieces } from '../../src/sim/race/piers';
import { boxOutline, placeOutline, polygonContact } from '../../src/sim/race/hull';
import { START_CLEARANCE, startClearWater } from '../../src/sim/race/setup';
import { shipOnFootprint } from '../../src/render/traffic';
import type { PierFeature } from '../../src/sim/env/marinas';
import { loadDartGeo } from './helpers';

const geo = loadDartGeo();
const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8'));
const DEG = Math.PI / 180;

describe('landings', () => {
  // A jetty 30 m long running north from (0, 0), 3 m wide; boats come in from the east.
  const jetty: PierFeature = { name: 'test jetty', floating: false, width: 3, line: [[0, 0], [0, 30]] };
  const claim = (key: string, n: number, length: number, beam = 4): LandingClaim => ({ key, at: [1.5, n], from: [40, n - 20], length, beam });

  it('lays boats alongside the edge facing their approach, in order, and rafts the one that does not fit', () => {
    const out = landingBerths([claim('a', 5, 12), claim('b', 15, 12), claim('c', 20, 12)], [jetty]);
    const a = out.get('a')!;
    const b = out.get('b')!;
    const c = out.get('c')!;
    // a and b lie on the east side, parallel to the jetty, heading the way they came in (north), clear of it.
    for (const p of [a, b]) {
      expect(p.e).toBeGreaterThan(1.5 + 2);
      expect(p.e).toBeLessThan(1.5 + 3.5);
      expect(Math.abs(Math.sin(p.heading))).toBeLessThan(1e-9);
      expect(Math.cos(p.heading)).toBeGreaterThan(0);
    }
    expect(b.n - a.n).toBeGreaterThanOrEqual(12 + 2 - 1e-9);
    // c does not fit on the 30 m edge: it lies outside the boat nearest its place, a beam and fenders further out.
    expect(c.e - b.e).toBeGreaterThan(4);
    expect(c.n).toBeCloseTo(b.n, 6);
  });

  it('leaves out a claim with no pier edge within reach', () => {
    expect(landingBerths([{ key: 'far', at: [100, 100], from: [140, 80], length: 10, beam: 3 }], [jetty]).size).toBe(0);
  });

  it('on the Dart, no river boat at rest lies across a pier or on top of another, all day', () => {
    const traffic = buildRiverTraffic({ ferries: features.ferries, geo, moorings: features.moorings, marinas: features.marinas, piers: features.piers });
    const grid = new PierGrid(pierPieces(features.piers));
    const kinds = new Set(['passenger-ferry', 'launch', 'river-cruiser', 'paddle-steamer']);
    let worstPier = 0;
    let worstPair = 0;
    for (let m = 6 * 60; m <= 22 * 60; m += 10) {
      const st = traffic.states(Date.parse('2026-07-15T00:00:00Z') + m * 60_000).filter((s) => kinds.has(s.kind) && !s.moving);
      const boxes = st.map((s) => placeOutline(boxOutline(s.length, s.beam), s.n, s.e, s.heading));
      st.forEach((s, i) => {
        for (const k of grid.near(s.n, s.e, s.length)) worstPier = Math.max(worstPier, polygonContact(boxes[i]!, grid.pieces[k]!.pts)?.depth ?? 0);
        for (let j = i + 1; j < st.length; j++) worstPair = Math.max(worstPair, polygonContact(boxes[i]!, boxes[j]!)?.depth ?? 0);
      });
    }
    expect(worstPier).toBeLessThan(0.05);
    expect(worstPair).toBeLessThan(0.05);
  });

  it('PS Kingswear Castle lies alongside the Town Jetty, parallel to it, between cruises', () => {
    const traffic = buildRiverTraffic({ ferries: features.ferries, geo, moorings: features.moorings, marinas: features.marinas, piers: features.piers });
    // 15 July, 11:05 local (10:05 UTC): before the 11:15 cruise.
    const s = traffic.states(Date.parse('2026-07-15T10:05:00Z')).find((v) => v.kind === 'paddle-steamer')!;
    expect(s.moving).toBe(false);
    expect(Math.hypot(s.e - PADDLE_STEAMER.berth.e, s.n - PADDLE_STEAMER.berth.n)).toBeLessThan(8);
    const dh = Math.abs(Math.atan2(Math.sin(s.heading - PADDLE_STEAMER.berth.heading), Math.cos(s.heading - PADDLE_STEAMER.berth.heading)));
    expect(Math.min(dh, Math.PI - dh)).toBeLessThan(5 * DEG);
  });
});

describe('structures in the water', () => {
  const wet = structuresInWater(features.buildings, (n, e) => geo.bedElevation(n, e));
  const hindostan = wet.find((s) => s.name === 'the Hindostan')!;

  it('include the Hindostan, the moored training ship OSM maps as a building, and leave the towns out', () => {
    expect(hindostan).toBeDefined();
    expect(wet.length).toBeLessThan(features.buildings.length / 20);
  });

  it('keep start slots clear', () => {
    const [ce, cn] = [hindostan.poly.reduce((a, p) => a + p[0], 0) / hindostan.poly.length, hindostan.poly.reduce((a, p) => a + p[1], 0) / hindostan.poly.length];
    const clear = startClearWater(geo, 2.5, 1.0, undefined, [{ name: hindostan.name, floating: false, poly: hindostan.poly }]);
    const open = startClearWater(geo, 2.5, 1.0);
    // 11 m off her centre on the river side (north-east), in deep water: open without structures, refused with them.
    const beside = { n: cn + 0.669 * 11, e: ce + 0.743 * 11 };
    expect(open(beside.n, beside.e)).toBe(true);
    expect(clear(beside.n, beside.e)).toBe(false);
    expect(START_CLEARANCE.structureM).toBeGreaterThanOrEqual(10);
  });

  it('the Hindostan is drawn on her outline: about 52 m by 10 m, bow to the narrow north-west end', () => {
    const p = shipOnFootprint(hindostan.poly);
    expect(p.length).toBeGreaterThan(48);
    expect(p.length).toBeLessThan(58);
    expect(p.beam).toBeGreaterThan(8);
    expect(p.beam).toBeLessThan(12);
    const hdg = ((p.heading / DEG) % 360 + 360) % 360;
    expect(hdg).toBeGreaterThan(300);
    expect(hdg).toBeLessThan(335);
  });
});
