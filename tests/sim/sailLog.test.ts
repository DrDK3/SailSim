/** The debrief after every sail (src/app/sailLog.ts): tacks and gybes found and costed, the start timed, the track kept. */
import { beforeEach, describe, expect, it } from 'vitest';
import { findManoeuvres, segmentDistance, summarise, speedColour, SPEED_RAMP, type TrackPoint } from '../../src/app/sailLog';
import { SimController } from '../../src/app/controller';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

/** A synthetic beat: `vmg` m/s to windward, the main changing side at `tackAt` with a dip in VMG for `dipS` seconds. */
function beat(seconds: number, tackAt: number, dipS: number, twaDeg = 45): TrackPoint[] {
  // Through the wind in a tack (TWA near 0°), through dead downwind in a gybe (near 180°).
  const throughDeg = twaDeg < 90 ? 10 : 175;
  const out: TrackPoint[] = [];
  let n = 0;
  for (let t = 0; t <= seconds; t++) {
    const inDip = t >= tackAt && t < tackAt + dipS;
    const vmg = inDip ? 0.2 : 1.5;
    n += vmg;
    out.push({ t, n, e: 0, sog: 2, vmg, twaDeg: inDip ? throughDeg : twaDeg, mainSide: t < tackAt + 2 ? 1 : -1 });
  }
  return out;
}

describe('the sail debrief', () => {
  it('a tack found where the main changes side, costed as ground lost against the speed before', () => {
    const m = findManoeuvres(beat(80, 40, 6));
    expect(m).toHaveLength(1);
    expect(m[0]!.kind).toBe('tack');
    // 6 s at 0.2 instead of 1.5 m/s: 7.8 m lost, 5.2 s at 1.5 m/s.
    expect(m[0]!.lossM).toBeCloseTo(7.8, 5);
    expect(m[0]!.lossS).toBeCloseTo(5.2, 5);
  });

  it('a gybe is costed going downwind; a wobble back and forth is not two manoeuvres', () => {
    const down = beat(80, 40, 4, 150).map((p) => ({ ...p, vmg: -p.vmg }));
    const g = findManoeuvres(down);
    expect(g.map((x) => x.kind)).toEqual(['gybe']);
    expect(g[0]!.lossS).toBeGreaterThan(0);
    const wobble = beat(80, 40, 0).map((p) => ({ ...p, mainSide: p.t >= 40 && p.t < 43 ? -1 : 1 }));
    expect(findManoeuvres(wobble)).toHaveLength(0);
  });

  it('too near the start or end, or too slow, a manoeuvre is listed but not costed', () => {
    const m = findManoeuvres(beat(30, 25, 3));
    expect(m).toHaveLength(1);
    expect(m[0]!.lossS).toBeUndefined();
  });

  it('the summary: distance, speeds, best upwind VMG, the start against the gun and the line', () => {
    const pts = beat(120, 60, 6);
    const s = summarise(pts, { gunT: 10, line: [{ n: 0, e: -50 }, { n: 0, e: 50 }], startedT: 12.5, ocs: false });
    expect(s.durationS).toBe(120);
    expect(s.distanceM).toBeGreaterThan(150);
    expect(s.maxSogKn).toBeCloseTo(2 / 0.514444, 5);
    expect(s.bestUpwindVmgKn).toBeCloseTo(1.5 / 0.514444, 5);
    expect(s.tacks.count).toBe(1);
    expect(s.start!.lateS).toBeCloseTo(2.5, 5);
    expect(s.start!.distToLineAtGunM).toBeCloseTo(pts[10]!.n, 5);
    expect(segmentDistance({ n: 5, e: 100 }, { n: 0, e: -50 }, { n: 0, e: 50 })).toBeCloseTo(Math.hypot(5, 50), 5);
  });

  it('the speed colour runs through the ramp in order, slow to fast', () => {
    expect(speedColour(0)).toBe(SPEED_RAMP[0]);
    expect(speedColour(1)).toBe(SPEED_RAMP[SPEED_RAMP.length - 1]);
    expect(speedColour(0.5)).toBe(SPEED_RAMP[2]);
  });

  it('a real sail: the controller keeps the track once a second and finds a tack', () => {
    const c = new SimController();
    // Sail on, then turn towards the wind (the bow to starboard: the wind is from 225°, she heads 170°) and tack.
    c.advance(30);
    c.press('helmRight', true);
    c.advance(10);
    c.press('helmRight', false);
    c.advance(40);
    const d = c.sailDebrief();
    expect(d.points.length).toBeGreaterThanOrEqual(75);
    expect(d.points[1]!.t - d.points[0]!.t).toBeCloseTo(1, 6);
    expect(d.summary.manoeuvres.map((m) => m.kind)).toContain('tack');
    // A new run starts a new track.
    c.restart();
    expect(c.sailDebrief().points.length).toBeLessThan(2);
  });
});
