/**
 * Marina boats keep out of the way of sailing boats (COLREGs Rule 18(a); src/sim/env/traffic.ts): off their track
 * when one would pass close, never far and never into shallow water, back on it once clear; the ferries stand on.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GIVE_WAY_MAX_M, buildRiverTraffic, type MarinaSpec, type VesselState } from '../../src/sim/env/traffic';
import type { PierFeature } from '../../src/sim/env/marinas';
import type { FerryRoute } from '../../src/sim/env/ferries';
import { SignalScheduler } from '../../src/app/soundSignals';
import { loadDartGeo } from './helpers';

const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as {
  ferries: FerryRoute[];
  moorings: { n: number; e: number }[];
  marinas: MarinaSpec[];
  piers: PierFeature[];
};
const geo = loadDartGeo();
const make = () => buildRiverTraffic({ ferries: features.ferries, geo, moorings: features.moorings, marinas: features.marinas, piers: features.piers });
const T0 = Date.parse('2026-07-15T09:00:00Z');

/** A marina boat under way in mid-river, and where she will be in 30 s (on her own track). */
function findBoat(t: ReturnType<typeof make>): { at: number; v: VesselState; ahead: VesselState } {
  for (let s = 0; s < 8 * 3600; s += 20) {
    const at = T0 + s * 1000;
    const later = new Map(t.states(at + 30_000).map((x) => [x.id, x]));
    for (const v of t.states(at)) {
      const a = later.get(v.id);
      if (!/Marina/.test(v.name) || v.phase !== 'underway' || v.sog < 1.5 || !a || a.phase !== 'underway') continue;
      if (Math.hypot(a.n - v.n, a.e - v.e) > 40) return { at, v, ahead: a };
    }
  }
  throw new Error('no marina boat under way');
}

describe('marina boats give way to sailing boats (Rule 18(a))', () => {
  it('a boat stopped on her track: she eases off it, passes clear, then comes back; the same run twice is the same', () => {
    const run = () => {
      const t = make();
      const { at, v, ahead } = findBoat(t);
      // A Squib lying still where the marina boat will be in 30 s.
      const squib = { n: ahead.n, e: ahead.e, vn: 0, ve: 0 };
      let closest = Infinity;
      let maxOff = 0;
      let altered: number | undefined;
      const sig = new SignalScheduler();
      const heard: string[] = [];
      for (let k = 0; k <= 900; k++) {
        const now = at + k * 100;
        t.keepClearOf(now, 0.1, [squib]);
        const me = t.states(now).find((x) => x.id === v.id);
        if (!me) break;
        closest = Math.min(closest, Math.hypot(me.n - squib.n, me.e - squib.e));
        const g = t.keepingClear.get(v.id);
        maxOff = Math.max(maxOff, Math.abs(g?.off ?? 0));
        if (me.givingWay && altered === undefined) altered = k / 10;
        for (const s of sig.update(k / 10, [me], 20000, squib)) heard.push(s.rule);
      }
      return { closest, maxOff, altered, heard, end: t.keepingClear.get(v.id)?.off ?? 0, untouched: (() => {
        const u = make();
        const ref = u.states(at + 30_000).find((x) => x.id === v.id)!;
        return Math.hypot(ref.n - squib.n, ref.e - squib.e);
      })() };
    };
    const a = run();
    expect(a.untouched).toBeLessThan(1); // without giving way she would run straight into it
    expect(a.altered).toBeDefined();
    expect(a.maxOff).toBeGreaterThan(3);
    expect(a.maxOff).toBeLessThanOrEqual(GIVE_WAY_MAX_M + 1e-9);
    // Clear by more than the two half-beams with room to spare (centre to centre).
    expect(a.closest).toBeGreaterThan(8);
    expect(Math.abs(a.end)).toBeLessThan(1); // back on her track once clear
    // One short blast as she begins (Rule 34(a)), once; no doubt signal from the boat keeping clear.
    expect(a.heard).toEqual(['Rule 34(a)']);
    expect(run()).toEqual(a);
  });

  it('nothing changes without a sailing boat near, and the ferries never move off their tracks', () => {
    const t = make();
    const ref = make();
    const at = T0 + 3600_000;
    for (let k = 0; k < 600; k++) t.keepClearOf(at + k * 100, 0.1, []);
    expect(t.keepingClear.size).toBe(0);
    // A Squib on the Lower Ferry's crossing: the ferry does not alter.
    const lf = ref.states(at).find((x) => x.name === 'Dartmouth Lower Ferry')!;
    for (let k = 0; k < 300; k++) t.keepClearOf(at + k * 100, 0.1, [{ n: lf.n, e: lf.e, vn: 0, ve: 0 }]);
    const a = t.states(at + 30_000).filter((x) => !/Marina/.test(x.name));
    const b = ref.states(at + 30_000).filter((x) => !/Marina/.test(x.name));
    expect(a).toEqual(b);
  });
});
