/**
 * The car ferries' ramps are solid (owner, 12 Nov 2026: the helm view inside the Lower Ferry, "Contact with Lower
 * Ferry (tug and float) at 0.1 m/s", the bow holed). The raised ramps overhang the float's ends by about 2.5 m and
 * were not in its outline, so a Squib's bow could go under one before anything touched her. A boat lying in the
 * ferry's path now meets the ramp first and is pushed clear, not overrun.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { boxOutline, placeOutline, polygonContact } from '../../src/sim/race/hull';
import { FERRY_RAMPS, buildRiverTraffic, type VesselState } from '../../src/sim/env/traffic';
import { loadDartApp } from './helpers';

const app = loadDartApp();
const f = app.features as unknown as Parameters<typeof buildRiverTraffic>[0] & { moorings: { n: number; e: number }[] };
const traffic = buildRiverTraffic({ ferries: f.ferries, geo: app.geo, moorings: f.moorings, marinas: f.marinas, piers: f.piers });

/** The first moment from noon, 15 Jul 2026, the Lower Ferry is under way mid-river at speed. */
function underway(): { t: number; v: VesselState } {
  const t0 = Date.parse('2026-07-15T13:00:00Z');
  for (let k = 0; k < 3600; k += 2) {
    const v = traffic.states(t0 + k * 1000).find((x) => x.kind === 'tug-float' && x.phase === 'underway' && x.sog > 1.5);
    if (v) return { t: t0 + k * 1000, v };
  }
  throw new Error('no crossing found');
}

describe('the car ferries\' ramps are solid', () => {
  it('both car ferries carry their ramps in their outlines', () => {
    for (const kind of ['tug-float', 'floating-bridge'] as const) {
      const v = traffic.states(Date.parse('2026-07-15T13:00:00Z')).find((x) => x.kind === kind)!;
      expect(v, kind).toBeTruthy();
      expect(v.parts.filter((p) => p.role === 'ramp'), kind).toHaveLength(2);
      expect(FERRY_RAMPS[kind]!.reach).toBeGreaterThan(FERRY_RAMPS[kind]!.hinge + 2);
    }
  });

  it('a Squib head to wind in the Lower Ferry\'s path meets the raised ramp and is not overrun', () => {
    const { t, v } = underway();
    const h = v.heading;
    const n = v.n + Math.cos(h) * 35;
    const e = v.e + Math.sin(h) * 35;
    const hd = ((h * 180) / Math.PI + 90 + 360) % 360;
    const env = { ...uniformEnvironment({ twsKn: 4, twdDeg: hd }), startEpochMs: t, waterLevel: () => 2 };
    const sim = new Simulation({ params: squibParams(), env, seabed: app.geo, ownsEnvironment: false, initial: { n, e, headingDeg: hd, speedKn: 0 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
    const fleet = new Fleet(env);
    const b = fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
    fleet.setObstacles({ traffic });
    let deepest = 0;
    for (let s = 0; s < 40 * 20; s++) {
      fleet.stepOnce();
      const pts = (fleet as unknown as { body: (x: unknown) => { pts: { n: number; e: number }[] } }).body(b).pts;
      for (const fy of fleet.ferriesAt(fleet.time).filter((x) => x.id === v.id)) {
        for (const p of fy.parts) {
          const c = polygonContact(pts, placeOutline(boxOutline(p.length, p.beam), p.n, p.e, p.heading));
          if (c) deepest = Math.max(deepest, c.depth);
        }
      }
    }
    const ev = fleet.events.find((x) => x.kind === 'ferry');
    expect(ev?.label).toBe('Lower Ferry (tug and float) (ramp)');
    expect(deepest).toBeLessThan(0.4);
  });
});
