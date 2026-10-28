/** Piers and pontoons are solid: the pieces they are cut into, and a boat stopped by one instead of sailing through. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { PierGrid, pierPieces, triangulate, type PierInput } from '../../src/sim/race/piers';

const area = (r: { n: number; e: number }[]) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i]!.e * r[(i + 1) % r.length]!.n - r[(i + 1) % r.length]!.e * r[i]!.n;
  return a / 2;
};

describe('pier pieces', () => {
  it('cuts an outline into clockwise triangles of the same total area, an L shape included', () => {
    const L = [[0, 0], [20, 0], [20, 5], [5, 5], [5, 30], [0, 30]].map(([e, n]) => ({ e: e!, n: n! }));
    const tris = triangulate(L);
    expect(tris).toHaveLength(4);
    for (const t of tris) expect(area(t)).toBeLessThan(0);
    expect(tris.reduce((a, t) => a - area(t), 0)).toBeCloseTo(area(L), 9);
  });

  it('makes a rectangle per segment of a pontoon line, covering its joints', () => {
    const pcs = pierPieces([{ name: 'Test pontoon', floating: true, line: [[0, 0], [0, 40], [30, 40]], width: 3 }]);
    expect(pcs).toHaveLength(2);
    expect(pcs[0]!.label).toBe('Test pontoon');
    expect(pcs[0]!.floating).toBe(true);
    // The first runs north 40 m, grown 1.5 m at each end, 3 m wide.
    expect(-area(pcs[0]!.pts)).toBeCloseTo(43 * 3, 9);
    const grid = new PierGrid(pcs);
    expect(grid.near(40, 0, 2)).toEqual([0, 1]);
    expect(grid.near(-200, -200, 2)).toEqual([]);
  });

  it('every pier in the River Dart data becomes solid pieces', () => {
    const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8')) as { piers: PierInput[] };
    const pcs = pierPieces(features.piers);
    const piers = new Set(pcs.map((p) => p.pier));
    expect(piers.size).toBe(features.piers.length);
    expect(pcs.some((p) => p.floating)).toBe(true);
    expect(pcs.some((p) => !p.floating)).toBe(true);
  });
});

describe('a boat meets a pontoon', () => {
  for (const floating of [true, false]) {
    it(`is stopped by a ${floating ? 'floating pontoon' : 'fixed jetty'} instead of sailing through, and the contact is reported`, () => {
      // A pontoon running east-west 20 m north of a boat heading north at 3 kn on a reach (wind from the east).
      const env = uniformEnvironment({ twsKn: 10, twdDeg: 90 });
      const sim = new Simulation({ params: squibParams(), env, ownsEnvironment: false, initial: { n: 0, e: 0, headingDeg: 0, speedKn: 3 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
      const fleet = new Fleet(env);
      fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
      fleet.setObstacles({ piers: [{ name: floating ? 'Test pontoon' : 'Test jetty', floating, line: [[-40, 20], [40, 20]], width: 2.5 }] });
      let maxBow = -Infinity;
      for (let k = 0; k < 3000; k++) {
        fleet.stepOnce();
        const s = sim.state;
        maxBow = Math.max(maxBow, s.n + (squibParams().loa / 2) * Math.cos(s.psi));
      }
      // The pontoon's south face is at 18.75 m: the bow may press into it a little (the contact gives), never through.
      expect(maxBow).toBeLessThan(19.5);
      const ev = fleet.events.find((e) => e.kind === 'pier');
      expect(ev?.label).toBe(floating ? 'Test pontoon' : 'Test jetty');
      expect(ev!.speed).toBeGreaterThan(0.5);
    });
  }
});
