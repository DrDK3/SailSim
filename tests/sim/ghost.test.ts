/**
 * Ghost racing (src/app/ghost.ts, controller startGhost): a recording is sailed through to learn its path, then the
 * same scenario starts again with the ghost where the recorded boat was at each moment.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SimController } from '../../src/app/controller';
import { GHOST_EVERY, ghostPoseAt } from '../../src/app/ghost';
import type { FleetPose } from '../../src/render/fleet';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

type Inner = { fleetCurr: Map<string, FleetPose> };
const pose = (o: Partial<FleetPose>): FleetPose =>
  ({ id: 'x', n: 0, e: 0, heading: 0, heel: 0, boomMain: 0, boomJib: 0, mainSide: 1, jibSide: 1, mainLuff: 0, jibLuff: 0, mainAwa: 0, jibAwa: 0, rudder: 0, crewY: 0, crewTo: 0, awa: 0, aws: 0, water: 0, ...o }) as FleetPose;

describe('ghost racing', () => {
  it('between samples the ghost moves smoothly, the short way round; after the end she stays put', () => {
    const ps = [pose({ n: 0, heading: 3.1 }), pose({ n: 10, heading: -3.1 })];
    const mid = ghostPoseAt(ps, 0.5)!;
    expect(mid.n).toBeCloseTo(5);
    expect(Math.abs(Math.abs(mid.heading) - Math.PI)).toBeLessThan(0.01); // through 180°, not through 0°
    expect(ghostPoseAt(ps, 7)!.n).toBe(10);
    expect(ghostPoseAt(ps, -1)).toBeUndefined();
  });

  it('a run raced again: the ghost is where the recorded boat was, at each moment of the new run', async () => {
    const c = new SimController();
    const path: { n: number; e: number }[] = [];
    c.press('helmRight', true);
    for (let i = 0; i < 40; i++) {
      if (i === 8) c.press('helmRight', false);
      c.advance(1);
      const s = c.sim.snapshot(false);
      path.push({ n: s.n, e: s.e });
    }
    const rec = c.saveRecording('first run');
    expect(c.startGhost(rec)).toBe(true);
    for (let i = 0; i < 400 && c.getState().ghostLoading !== undefined; i++) await new Promise((r) => setTimeout(r, 5));
    const st = c.getState();
    expect(st.ghostLoading).toBeUndefined();
    expect(st.replay).toBeUndefined();
    expect(st.ghost?.title).toBe('first run');
    expect(c.sim.time).toBe(0);
    // Sail differently this time (straight on); the ghost follows the recorded path.
    for (const k of [10, 25, 40]) {
      c.advance(k - c.sim.time);
      const g = (c as unknown as Inner).fleetCurr.get('ghost')!;
      expect(Math.hypot(g.n - path[k - 1]!.n, g.e - path[k - 1]!.e)).toBeLessThan(0.05);
    }
    expect(c.sim.step % GHOST_EVERY).toBe(0);
    // A reset of the same scenario keeps the ghost; another scenario ends it.
    c.restart();
    expect(c.getState().ghost).toBeDefined();
    c.restart({ ...c.scenario, startHeadingDeg: c.scenario.startHeadingDeg + 30 });
    expect(c.getState().ghost).toBeUndefined();
  });
});
