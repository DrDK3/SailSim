/**
 * The Squib does not sail through what the picture draws as solid (owner, 6 Nov 2026: "Squib going through solid
 * objects"). Over the towns the picture draws the 4 m LIDAR ground, with the quays filled behind their walls; the
 * physics had the 8 m grid alone, smoothed and carrying the bathymetry, so along steep shores (Kingswear's rocks,
 * the quays) it floated the boat several metres into ground drawn above the water. Now the physics stands on the
 * ground the picture draws (src/app/geoLoader.ts physicsGround, src/sim/geo/dart.ts setFinerGround), and the yacht
 * club's frontage sea wall is solid like the quays.
 */
import { describe, expect, it } from 'vitest';
import { Simulation, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet } from '../../src/sim/race/fleet';
import { raceStructures } from '../../src/sim/race/setup';
import { PierGrid, pierPieces } from '../../src/sim/race/piers';
import { gridGround, quayPiers, type TownGrid } from '../../src/sim/env/quays';
import { physicsGround, TOWN_WATER_MAX_ODN, townWithoutWater } from '../../src/app/geoLoader';
import { PAD_ODN } from '../../src/app/pads';
import { RDYC_FRONTAGE } from '../../src/render/rdyc';
import { readGrid } from '../../tools/lib/dartGeoNode';
import { loadDartApp, loadDartGeo } from './helpers';

const app = loadDartApp();
const plain = loadDartGeo();
const t = app.town.spec;
/** What the picture draws over the towns: the cleaned town ground, the quays filled (as src/render/dart.ts). */
const drawn: TownGrid = { spec: t, values: physicsGround(app.town, app.quays).values };
const walls = [...quayPiers(app.quays), ...quayPiers([{ line: [...RDYC_FRONTAGE] }], "the yacht club's sea wall")];
const piers = [...raceStructures(app.features as never, app.geo), ...walls];
const grid = new PierGrid(pierPieces(piers));

/** Sail at 6 kn before 16 kn of wind from (e, n) on `headingDeg` for `seconds`; the hull's outline at every step. */
function sailAt(e: number, n: number, headingDeg: number, waterLevel: number, ground = app.geo, seconds = 15) {
  const env = { ...uniformEnvironment({ twsKn: 16, twdDeg: (headingDeg + 180) % 360 }), waterLevel: () => waterLevel };
  const sim = new Simulation({ params: squibParams(), env, seabed: ground, ownsEnvironment: false, initial: { n, e, headingDeg, speedKn: 6 }, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const fleet = new Fleet(env);
  const b = fleet.add({ id: 'you', name: 'You', sailNumber: 'GBR', colour: 0xffffff, kind: 'human', sim });
  fleet.setObstacles({ piers });
  /** The most ground drawn above the water under the hull's outline (m), away from a wall's own foot. */
  let overGround = -Infinity;
  for (let s = 0; s < seconds * 100; s++) {
    fleet.stepOnce();
    for (const h of (fleet as unknown as { body: (b: unknown) => { pts: { n: number; e: number }[] } }).body(b).pts) {
      const g = gridGround(drawn, h.e, h.n);
      if (g !== undefined && g - waterLevel > overGround && !nearWall(h.e, h.n)) overGround = g - waterLevel;
    }
  }
  return { overGround, sim, fleet };
}

/** Within 2.5 m of a wall's face: the drawn ground slopes up behind the face there (the face hides it). */
function nearWall(e: number, n: number): boolean {
  for (const w of [...app.quays.map((q) => q.line), [...RDYC_FRONTAGE] as [number, number][]]) {
    for (let k = 1; k < w.length; k++) {
      const [ae, an] = w[k - 1]!;
      const [be, bn] = w[k]!;
      const de = be - ae;
      const dn = bn - an;
      const u = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / (de * de + dn * dn || 1)));
      if (Math.hypot(e - (ae + de * u), n - (an + dn * u)) < 2.5) return true;
    }
  }
  return false;
}

describe('the ground the boat sails on is the ground the picture draws', () => {
  it('over the towns, nowhere does the picture draw ground above the physics bed', () => {
    let worst = -Infinity;
    for (let j = 1; j < t.ny - 1; j++) {
      for (let i = 1; i < t.nx - 1; i++) {
        const e = t.e0 + (i + 0.5) * t.cell;
        const n = t.n0 + (j + 0.5) * t.cell;
        worst = Math.max(worst, drawn.values[j * t.nx + i]! - app.geo.bedElevation(n, e));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('where the 8 m grid alone floated a Squib under ground drawn above high water, there is now ground', () => {
    // Kingswear's rocks south of the town: drawn up to +5 m ODN where the 8 m grid had 4 m of water.
    expect(gridGround(drawn, 542, -660)!).toBeGreaterThan(4);
    expect(plain.bedElevation(-660, 542)).toBeLessThan(-3);
    expect(app.geo.bedElevation(-660, 542)).toBeGreaterThan(4);
    // Out in the river the bed is the 8 m grid's, as before.
    expect(app.geo.bedElevation(300, -150)).toBe(plain.bedElevation(300, -150));
  });

  it("the LIDAR's river surface is not ground: near the Higher Ferry the survey met the water at −0.4 m ODN", () => {
    const raw = new Int16Array(readGrid(new URL('../../public/geo/', import.meta.url), t as never));
    const rawGrid: TownGrid = { spec: t, values: Float32Array.from(raw, (v) => v * (t as unknown as { scale: number }).scale) };
    // A cell mid-river there: the raw grid has the water's surface, the cleaned one the 8 m grid's bed.
    const e = -650;
    const n = 1600;
    expect(gridGround(rawGrid, e, n)!).toBeGreaterThan(-1);
    expect(gridGround(rawGrid, e, n)!).toBeLessThan(TOWN_WATER_MAX_ODN);
    expect(gridGround(app.town, e, n)!).toBeLessThan(-2.5);
    // The app's town ground is the cleaned grid, with the waterfront buildings' pads (src/app/pads.ts) raised to PAD_ODN.
    const cleaned = townWithoutWater(rawGrid, plain);
    let other = 0;
    for (let k = 0; k < cleaned.length; k++) if (app.town.values[k] !== cleaned[k] && app.town.values[k] !== Math.fround(PAD_ODN)) other++;
    expect(other).toBe(0);
    // The land is untouched (it is all the LIDAR's) but for the waterfront buildings' pads.
    let changedLand = 0;
    for (let k = 0; k < raw.length; k++) if (rawGrid.values[k]! > TOWN_WATER_MAX_ODN && app.town.values[k] !== rawGrid.values[k] && app.town.values[k] !== Math.fround(PAD_ODN)) changedLand++;
    expect(changedLand).toBe(0);
  });
});

describe('the Squib meets the shore instead of sailing into it', () => {
  it("is stopped by Kingswear's rocks at high water (with the 8 m grid alone she sailed 7 m into them)", () => {
    // From open water south of Kingswear, at 6 kn straight at the rocks.
    const before = sailAt(548, -643, 199, 2.2, plain);
    expect(before.overGround).toBeGreaterThan(4);
    const after = sailAt(548, -643, 199, 2.2);
    expect(after.overGround).toBeLessThan(0.5);
    expect(after.sim.snapshot(false).grounded).toBe(true);
  });

  it("is stopped by the yacht club's sea wall, which is solid like the quays", () => {
    // From off the club, north of its pontoon, straight at the frontage at high water (3 m of water at its foot).
    const [ae, an] = RDYC_FRONTAGE[3]!;
    const [be, bn] = RDYC_FRONTAGE[4]!;
    const me = (ae + be) / 2;
    const mn = (an + bn) / 2;
    const L = Math.hypot(be - ae, bn - an);
    const out = { e: (bn - an) / L, n: -(be - ae) / L }; // the river side: right of the wall walked north to south
    const r = sailAt(me + out.e * 20, mn + out.n * 20, (Math.atan2(-out.e, -out.n) * 180) / Math.PI, 2.3);
    expect(r.overGround).toBeLessThan(0.5);
    expect(r.fleet.events.some((ev) => ev.label === "the yacht club's sea wall")).toBe(true);
  });

  for (const level of [2.2, 0.5]) {
    it(`sailed at the towns' shores from open water (every 8th of them), never ends up over ground drawn above the water, at ${level} m ODN`, () => {
      const open = (e: number, n: number) => (gridGround(drawn, e, n) ?? -99) < level - 1.5 && app.geo.bedElevation(n, e) < level - 1.5 && !grid.within(n, e, 4);
      const targets: { e: number; n: number; heading: number }[] = [];
      const seen = new Set<string>();
      for (let j = 2; j < t.ny - 2; j++) {
        for (let i = 2; i < t.nx - 2; i++) {
          const e = t.e0 + (i + 0.5) * t.cell;
          const n = t.n0 + (j + 0.5) * t.cell;
          if ((gridGround(drawn, e, n) ?? -99) <= level + 0.3) continue;
          const key = `${Math.floor(e / 20)},${Math.floor(n / 20)}`;
          if (seen.has(key)) continue;
          for (let a = 0; a < 16; a++) {
            const de = Math.sin((a * Math.PI) / 8);
            const dn = Math.cos((a * Math.PI) / 8);
            const se = e + de * 16;
            const sn = n + dn * 16;
            if (!open(se, sn) || !open(se - de * 3.5, sn - dn * 3.5) || !open(se + de * 3, sn + dn * 3)) continue;
            seen.add(key);
            targets.push({ e: se, n: sn, heading: (Math.atan2(-de, -dn) * 180) / Math.PI });
            break;
          }
        }
      }
      expect(targets.length).toBeGreaterThan(300);
      let worst = -Infinity;
      for (let k = 0; k < targets.length; k += 8) {
        const g = targets[k]!;
        worst = Math.max(worst, sailAt(g.e, g.n, g.heading, level).overGround);
      }
      console.log(`[shore] ${level} m ODN: ${Math.ceil(targets.length / 8)} of ${targets.length} shore approaches sailed; worst ground under the hull ${worst.toFixed(2)} m above the water`);
      expect(worst).toBeLessThan(0.5);
    }, 120_000);
  }
});
