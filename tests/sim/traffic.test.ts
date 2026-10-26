import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEG, buildConditions } from '../../src/sim/index';
import { HARBOUR_LIMIT, RiverTraffic, buildRiverTraffic, ukOffsetHours, type VesselPart, type VesselState } from '../../src/sim/env/traffic';
import type { FerryRoute } from '../../src/sim/env/ferries';
import { loadDartGeo } from './helpers';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as { ferries: FerryRoute[]; moorings: { n: number; e: number }[] };
const ferries = features.ferries;
const geo = loadDartGeo();
const lower = (s: VesselState[]) => s.filter((v) => v.name === 'Dartmouth Lower Ferry');
const ms = (iso: string) => Date.parse(iso);

/** Do two hull outlines (oriented rectangles) overlap? Separating-axis test. */
function overlap(p: VesselPart, q: VesselPart): boolean {
  const corners = (r: VesselPart) => {
    const [c, s] = [Math.cos(r.heading), Math.sin(r.heading)];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([x, y]) => [r.e + s * x! * r.length / 2 + c * y! * r.beam / 2, r.n + c * x! * r.length / 2 - s * y! * r.beam / 2] as const);
  };
  const [A, B] = [corners(p), corners(q)];
  for (const r of [p, q]) {
    for (const ax of [[Math.sin(r.heading), Math.cos(r.heading)], [Math.cos(r.heading), -Math.sin(r.heading)]]) {
      const proj = (P: (readonly [number, number])[]) => P.map(([e, n]) => e * ax[0]! + n * ax[1]!);
      const [pa, pb] = [proj(A), proj(B)];
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

describe('UK local time', () => {
  it('British Summer Time from the last Sunday in March to the last Sunday in October (01:00 UTC)', () => {
    expect(ukOffsetHours(ms('2026-07-15T12:00:00Z'))).toBe(1);
    expect(ukOffsetHours(ms('2026-12-01T12:00:00Z'))).toBe(0);
    expect(ukOffsetHours(ms('2026-03-29T00:59:00Z'))).toBe(0);
    expect(ukOffsetHours(ms('2026-03-29T01:00:00Z'))).toBe(1);
    expect(ukOffsetHours(ms('2026-10-25T00:59:00Z'))).toBe(1);
    expect(ukOffsetHours(ms('2026-10-25T01:00:00Z'))).toBe(0);
  });
});

describe('the Lower Ferry (tug and float)', () => {
  const traffic = new RiverTraffic(ferries);
  const route = ferries.find((f) => f.name === 'Dartmouth Lower Ferry')!.route;
  const [dartmouth, kingswear] = [route[0]!, route[route.length - 1]!];
  const at = (iso: string) => lower(traffic.states(ms(iso)));

  it('waits at its slips before the first departures (Kingswear 07:00, Dartmouth 07:10 BST on a weekday)', () => {
    // Wednesday 15 July 2026, 06:50 BST = 05:50 UTC.
    const [u0] = at('2026-07-15T05:50:00Z');
    expect(u0!.moving).toBe(false);
    // Afloat just off the top of the slip (without the bed: half its length and 2 m).
    expect(Math.hypot(u0!.e - kingswear[0], u0!.n - kingswear[1])).toBeLessThan(19);
    // 07:00 BST: unit 0 leaves Kingswear (clearing the slip first).
    expect(at('2026-07-15T06:00:10Z')[0]!.phase).toBe('clearing');
    expect(at('2026-07-15T06:00:30Z')[0]!.phase).toBe('swinging');
  });

  it('a crossing: astern off the slip, the tug swings end for end, then across with the ramps up; ramps down at the far slip', () => {
    const t0 = ms('2026-07-15T06:00:00Z');
    const phases: string[] = [];
    let swingStart: number | undefined;
    let swingEnd: number | undefined;
    let maxSog = 0;
    let arrived: VesselState | undefined;
    let loading: VesselState | undefined;
    for (let s = 0; s < 600; s += 1) {
      const v = lower(traffic.states(t0 + s * 1000))[0]!;
      if (phases[phases.length - 1] !== v.phase) {
        phases.push(v.phase);
        if (v.phase === 'berthed' && !arrived) {
          arrived = v;
          loading = lower(traffic.states(t0 + (s + 10) * 1000))[0]!;
        }
      }
      const rel = Math.atan2(Math.sin(v.tug!.heading - v.heading), Math.cos(v.tug!.heading - v.heading));
      if (v.phase === 'swinging' && swingStart === undefined) swingStart = Math.abs(rel);
      if (v.phase === 'underway' && swingEnd === undefined) swingEnd = Math.abs(rel);
      if (v.phase === 'underway') expect(v.ramp).toBe(1);
      maxSog = Math.max(maxSog, v.sog);
    }
    expect(phases.slice(0, 4)).toEqual(['clearing', 'swinging', 'underway', 'berthed']);
    expect(swingStart!).toBeGreaterThan(2.8); // tug facing back at the slip
    expect(swingEnd!).toBeLessThan(0.2); // and now facing the far bank
    expect(maxSog).toBeLessThanOrEqual(2.0 + 1e-9);
    // At Dartmouth after the crossing, the ramps start to come down for loading.
    expect(Math.hypot(arrived!.e - dartmouth[0], arrived!.n - dartmouth[1])).toBeLessThan(19);
    expect(arrived!.ramp).toBe(1);
    expect(loading!.ramp).toBe(0);
  });

  it('two units in the day, passing mid-stream; one during the autumn 2026 refit (operator notice)', () => {
    let both = 0;
    let passed = false;
    for (let m = 0; m < 120; m++) {
      const s = lower(traffic.states(ms('2026-07-15T10:00:00Z') + m * 30_000));
      const moving = s.filter((v) => v.moving);
      if (moving.length === 2) {
        both++;
        if (Math.hypot(moving[0]!.e - moving[1]!.e, moving[0]!.n - moving[1]!.n) < 60) passed = true;
      }
    }
    expect(both).toBeGreaterThan(5);
    expect(passed).toBe(true);
    for (let m = 0; m < 120; m++) {
      const s = lower(traffic.states(ms('2026-11-04T11:00:00Z') + m * 30_000));
      expect(s.filter((v) => v.moving).length).toBeLessThanOrEqual(1);
    }
  });

  it('two units meeting mid-river each alter to starboard and pass port to port, never touching', () => {
    let closest = Infinity;
    let portToPort = 0;
    for (let s = 0; s < 3 * 3600; s += 2) {
      const [a, b] = lower(traffic.states(ms('2026-07-15T09:00:00Z') + s * 1000));
      if (!a || !b) continue;
      for (const p of a.parts) for (const q of b.parts) expect(overlap(p, q)).toBe(false);
      const d = Math.hypot(a.e - b.e, a.n - b.n);
      if (a.moving && b.moving && d < 60) {
        // Each sees the other on its port hand (bearing relative to the heading is negative).
        for (const [x, y] of [[a, b], [b, a]] as const) expect(Math.sin(Math.atan2(y.e - x.e, y.n - x.n) - x.heading)).toBeLessThan(0);
        portToPort++;
      }
      closest = Math.min(closest, d);
    }
    expect(portToPort).toBeGreaterThan(5);
    expect(closest).toBeGreaterThan(30);
  });

  it('the tug is solid too: two parts for the fleet physics', () => {
    const v = at('2026-07-15T10:00:00Z')[0]!;
    expect(v.parts).toHaveLength(2);
    expect(v.parts[1]!.length).toBeGreaterThan(8);
  });
});

describe('the stream', () => {
  it('a ferry crabs up into a cross-stream to hold its track; the cable ferry does not', () => {
    // A uniform stream running north (up-river) across the east-west ferry routes.
    const traffic = new RiverTraffic(ferries, { current: () => ({ n: 0.8, e: 0 }) });
    const still = new RiverTraffic(ferries);
    const t = ms('2026-07-15T10:03:00Z');
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const now = t + k * 20_000;
      const a = traffic.states(now).find((v) => v.name === 'Dartmouth Lower Ferry' && v.phase === 'underway');
      if (!a) continue;
      const track = ferries.find((f) => f.name === 'Dartmouth Lower Ferry')!.route;
      const dir = Math.atan2(track[1]![0] - track[0]![0], track[1]![1] - track[0]![1]);
      const off = Math.atan2(Math.sin(a.heading - dir), Math.cos(a.heading - dir));
      // Track roughly east (or west on the way back); the stream sets north, so she heads south of the track.
      const eastbound = Math.cos(a.heading - dir) > 0;
      expect(Math.abs(off) > 2 * DEG || Math.abs(Math.abs(off) - Math.PI) > 2 * DEG).toBe(true);
      const southOf = Math.cos(a.heading) < Math.cos(eastbound ? dir : dir + Math.PI);
      expect(southOf).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
    const bridge = traffic.states(t).filter((v) => v.name === 'Dartmouth Higher Ferry');
    const bridgeStill = still.states(t).filter((v) => v.name === 'Dartmouth Higher Ferry');
    for (let i = 0; i < bridge.length; i++) expect(bridge[i]!.heading).toBeCloseTo(bridgeStill[i]!.heading, 9);
  });
});

describe('Dart Marina traffic', () => {
  const conditions = buildConditions(
    {
      startTime: '2026-07-15T06:00:00Z',
      weather: { source: 'manual', twsKn: 10, twdDeg: 225 },
      gusts: { preset: 'steady', seed: 1 },
      tide: { mode: 'manual', hwTime: '2026-07-15T12:00:00Z', hwHeightM: 4.8, lwHeightM: 0.9 },
      current: { mode: 'dart', stream: { floodSetDeg: 0, peakFloodKn: 1.5, peakEbbKn: 2, riverEbbKn: 0 } },
    },
    geo,
  ).env;
  const start = ms('2026-07-15T06:00:00Z');
  const make = () => buildRiverTraffic({ ferries, current: (t, n, e) => conditions.current((t - start) / 1000, n, e), geo, moorings: features.moorings });
  const traffic = make();

  it('finds routes from the marina through deep water to the sea and up-river', () => {
    expect(traffic.fairways.map((f) => f.name)).toEqual(['Dart Marina → sea', 'Dart Marina → upriver']);
    for (const f of traffic.fairways) {
      const [e0, n0] = f.route[0]!;
      expect(Math.hypot(e0 + 251, n0 - 1151)).toBeLessThan(5);
      // Deep water all the way (at about low water springs), except close to the marina berths and the ends,
      // which the provisional bathymetry does not resolve.
      const [e1, n1] = f.route[f.route.length - 1]!;
      for (const [e, n] of f.route) {
        if (Math.hypot(e - e0, n - n0) < 80 || Math.hypot(e - e1, n - n1) < 80) continue;
        expect(-2.0 - geo.bedElevation(n, e)).toBeGreaterThan(1.0);
      }
    }
    const sea = traffic.fairways[0]!.route;
    // Through the entrance between the castles.
    expect(sea.some(([e, n]) => Math.hypot(e - 755, n + 680) < 220)).toBe(true);
  });

  it('a summer day brings boats in and out; in the harbour they keep to 6 knots over the water', () => {
    let seen = 0;
    const kinds = new Set<string>();
    let holdingNearFerry = 0;
    for (let m = 0; m < 13 * 60; m += 2) {
      const now = ms('2026-07-15T07:00:00Z') + m * 60_000;
      const all = traffic.states(now);
      const boats = all.filter((v) => v.name === 'Dart Marina');
      seen = Math.max(seen, boats.length);
      for (const b of boats) {
        kinds.add(b.kind);
        const c = conditions.current((now - start) / 1000, b.n, b.e);
        if (b.n > -1700) expect(b.sog).toBeLessThanOrEqual(HARBOUR_LIMIT + Math.hypot(c.n, c.e) + 1e-6);
        if (b.phase === 'holding') {
          holdingNearFerry++;
          expect(all.some((v) => v.ram && v.moving && Math.hypot(v.n - b.n, v.e - b.e) < 260)).toBe(true);
        }
      }
    }
    console.log(`[traffic] most marina boats at once: ${seen}; kinds ${[...kinds].join(', ')}; samples holding for a ferry: ${holdingNearFerry}`);
    expect(seen).toBeGreaterThan(0);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('the Lower Ferry berths with the tide: further down its slips at low water, its tug always afloat', () => {
    const lf = buildRiverTraffic({ ferries, current: (t, n, e) => conditions.current((t - start) / 1000, n, e), waterLevel: (t) => conditions.waterLevel!((t - start) / 1000), geo });
    const dartmouth = ferries.find((f) => f.name === 'Dartmouth Lower Ferry')!.route[0]!;
    let shallowest = Infinity;
    const offSlip: { level: number; d: number }[] = [];
    for (let s = 0; s < 16 * 3600; s += 3) {
      const now = ms('2026-07-15T06:00:00Z') + s * 1000;
      const level = conditions.waterLevel!((now - start) / 1000);
      const units = lower(lf.states(now));
      for (const v of units) {
        for (const k of [-0.4, 0, 0.4]) {
          const n = v.tug!.n + Math.cos(v.tug!.heading) * k * 9.5;
          const e = v.tug!.e + Math.sin(v.tug!.heading) * k * 9.5;
          shallowest = Math.min(shallowest, level - geo.bedElevation(n, e));
        }
        expect(level - geo.bedElevation(v.n, v.e)).toBeGreaterThan(1.0);
        if (v.phase === 'berthed' && Math.hypot(v.e - dartmouth[0], v.n - dartmouth[1]) < 60) offSlip.push({ level, d: Math.hypot(v.e - dartmouth[0], v.n - dartmouth[1]) });
      }
      if (units.length === 2) for (const p of units[0]!.parts) for (const q of units[1]!.parts) expect(overlap(p, q)).toBe(false);
    }
    // The tug (about 1.3 m draft, E) has water under it all day, at the slips and swinging off them.
    expect(shallowest).toBeGreaterThan(1.3);
    // Lower water, further out: the berth at low water is well down the slip from the one at high water.
    const lo = offSlip.reduce((a, b) => (b.level < a.level ? b : a));
    const hi = offSlip.reduce((a, b) => (b.level > a.level ? b : a));
    expect(lo.d - hi.d).toBeGreaterThan(8);
  });

  it('every marina: boats leave their berths astern, go out by the lanes, and come back to them; berths empty while they are out', () => {
    const all = buildRiverTraffic({ ferries, current: (t, n, e) => conditions.current((t - start) / 1000, n, e), geo, moorings: features.moorings, marinas: features.marinas, piers: features.piers });
    expect(all.fairways.map((f) => f.name.split(' → ')[0])).toEqual(expect.arrayContaining(['Dart Haven Marina', 'Dart Marina', 'Noss on Dart Marina']));
    const from = new Map<string, number>();
    let samples = 0;
    let brushes = 0;
    let leftEmpty = 0;
    for (let m = 0; m < 13 * 60; m += 1) {
      const now = ms('2026-07-15T07:00:00Z') + m * 60_000;
      const taken = all.berthsTaken(now);
      for (const v of all.states(now).filter((x) => /Marina/.test(x.name))) {
        from.set(v.name, (from.get(v.name) ?? 0) + 1);
        samples++;
        // Never through a berthed boat (an occasional brush passing close, at most).
        for (let i = 0; i < all.berths.length; i++) {
          const b = all.berths[i]!;
          if (taken[i] && Math.hypot(b.n - v.n, b.e - v.e) < 25 && overlap({ ...b, heading: b.heading }, { n: v.n, e: v.e, heading: v.heading, length: v.length * 0.9, beam: v.beam * 0.9 })) brushes++;
        }
      }
      // A boat that has just left: its berth stands empty.
      for (const v of all.states(now).filter((x) => /leaving/.test(x.label))) {
        const b = all.berths.find((x) => Math.hypot(x.n - v.n, x.e - v.e) < 1 && x.length === v.length);
        if (b) {
          expect(taken[b.id]).toBe(0);
          leftEmpty++;
        }
      }
    }
    console.log(`[traffic] marina boat samples by marina: ${[...from].map(([k, n]) => `${k} ${n}`).join(', ')}; brushes ${brushes}/${samples}; just left ${leftEmpty}`);
    for (const name of ['Dart Haven Marina', 'Dart Marina', 'Noss on Dart Marina']) expect(from.get(name) ?? 0).toBeGreaterThan(20);
    expect(brushes / samples).toBeLessThan(0.01);
    expect(leftEmpty).toBeGreaterThan(0);
  });

  it('is deterministic: two models agree at any moment, whatever was asked before', () => {
    const other = make();
    const t = ms('2026-07-15T14:37:12Z');
    other.states(t - 3_600_000);
    expect(JSON.stringify(other.states(t))).toBe(JSON.stringify(traffic.states(t)));
  });
});
