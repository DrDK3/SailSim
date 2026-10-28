/** PS Kingswear Castle: her cruises from the South Embankment on the published times, in deep water, at the harbour's speed. */
import { describe, expect, it } from 'vitest';
import { buildConditions } from '../../src/sim/index';
import { HARBOUR_LIMIT, PADDLE_STEAMER, buildRiverTraffic, steamerSailings } from '../../src/sim/env/traffic';
import { loadDartGeo } from './helpers';
import { readFileSync } from 'node:fs';

const geo = loadDartGeo();
const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8'));
const ms = (iso: string) => Date.parse(iso);

describe('the paddle steamer', () => {
  it('sails four cruises a day in season, none on Fridays or out of season, and goes to Totnes on 8 September 2026', () => {
    expect(steamerSailings('2026-07-15', 3, 6).map((s) => s.dep)).toEqual(PADDLE_STEAMER.departures);
    expect(steamerSailings('2026-07-17', 5, 6)).toEqual([]);
    expect(steamerSailings('2026-05-01', 5, 4)).toEqual([]);
    expect(steamerSailings('2026-10-20', 2, 9)).toEqual([]);
    const totnes = steamerSailings('2026-09-08', 2, 8);
    expect(totnes.filter((s) => s.to === 'cruise')).toHaveLength(3);
    expect(totnes.find((s) => s.to === 'totnes')).toEqual({ dep: 15 * 60 + 30, to: 'totnes', back: 19 * 60 + 30 });
  });

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
  const traffic = buildRiverTraffic({ ferries: features.ferries, current: (t, n, e) => conditions.current((t - start) / 1000, n, e), geo, moorings: features.moorings });
  const steamer = (iso: string) => traffic.states(ms(iso)).find((s) => s.kind === 'paddle-steamer');

  it('lies at the embankment between cruises, takes about an hour round, and is away in the evening', () => {
    // 15 July (BST): 11:15 local is 10:15 UTC.
    const before = steamer('2026-07-15T10:05:00Z')!;
    expect(before.moving).toBe(false);
    expect(Math.hypot(before.e - PADDLE_STEAMER.berth.e, before.n - PADDLE_STEAMER.berth.n)).toBeLessThan(1);
    expect(steamer('2026-07-15T10:30:00Z')!.moving).toBe(true);
    // Back alongside before the next sailing (12:30), after 45 minutes or more.
    let back = 0;
    for (let m = 10; m < 75; m++) {
      const s = steamer(new Date(ms('2026-07-15T10:15:00Z') + m * 60_000).toISOString())!;
      if (!s.moving) {
        back = m;
        break;
      }
    }
    expect(back).toBeGreaterThan(45);
    expect(back).toBeLessThan(75);
    expect(steamer('2026-07-15T18:30:00Z')).toBeUndefined();
    expect(steamer('2026-07-17T10:30:00Z')).toBeUndefined();
  });

  it('keeps to deep water, down to the castle and up towards Greenway, within the harbour limit', () => {
    let south = Infinity;
    let north = -Infinity;
    let fastest = 0;
    for (let m = 0; m < 70; m++) {
      const s = steamer(new Date(ms('2026-07-15T10:15:00Z') + m * 60_000).toISOString());
      if (!s || !s.moving) continue;
      south = Math.min(south, s.n);
      north = Math.max(north, s.n);
      fastest = Math.max(fastest, s.sog);
      // Clear of the berth, in at least 2 m of water at low water springs (she draws 1.2 m).
      if (Math.hypot(s.e - PADDLE_STEAMER.berth.e, s.n - PADDLE_STEAMER.berth.n) > 80) expect(-2.0 - geo.bedElevation(s.n, s.e), `${m} min`).toBeGreaterThan(0.8);
    }
    expect(south).toBeLessThan(-400);
    expect(north).toBeGreaterThan(3000);
    // The harbour limit over the ground, give or take the stream.
    expect(fastest).toBeLessThan(HARBOUR_LIMIT + 1.2);
  });

  it('on 8 September 2026 goes up to Totnes at 15:30 and is back alongside at 19:30', () => {
    const t = buildRiverTraffic({ ferries: features.ferries, geo, moorings: features.moorings });
    const at = (iso: string) => t.states(ms(iso)).find((s) => s.kind === 'paddle-steamer');
    // BST: local 15:35 is 14:35 UTC.
    expect(at('2026-09-08T14:35:00Z')?.moving).toBe(true);
    // Up the river beyond the map.
    expect(at('2026-09-08T17:00:00Z')).toBeUndefined();
    expect(at('2026-09-08T18:20:00Z')?.moving).toBe(true);
    const home = at('2026-09-08T18:32:00Z')!;
    expect(home.moving).toBe(false);
    expect(Math.hypot(home.e - PADDLE_STEAMER.berth.e, home.n - PADDLE_STEAMER.berth.n)).toBeLessThan(1);
  });
});
