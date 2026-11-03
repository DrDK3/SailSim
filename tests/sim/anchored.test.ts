import { describe, expect, it } from 'vitest';
import { squibParams } from '../../src/sim/boat/squib';
import { uniformEnvironment, type Environment } from '../../src/sim/env/environment';
import { GUST_PRESETS, WindField, type BaseWind } from '../../src/sim/env/wind';
import { COMMITTEE_BOAT, COMMITTEE_OUTLINE, lyingHeading, mooredBoatPose, mooringSwingDeg } from '../../src/sim/race/anchored';
import { Fleet } from '../../src/sim/race/fleet';
import { placeOutline, boxOutline } from '../../src/sim/race/hull';
import { Simulation } from '../../src/sim/simulation';

/**
 * Boats at anchor and on moorings (review CO-3, CO-4): one pose for the physics and the picture.
 */
const DEG = Math.PI / 180;
const withStream = (setDeg: number, kn: number, windFromDeg = 0): Environment => uniformEnvironment({ twsKn: 8, twdDeg: windFromDeg, currentSetDeg: setDeg, currentRateKn: kn });

describe('how an anchored or moored boat lies', () => {
  it('head to the stream when it runs, head to the wind (plus her swing) in slack water', () => {
    // Stream setting north at 1 kn: the bow points south, into it.
    expect(Math.abs(lyingHeading(withStream(0, 1, 90), 0, 0, 0) - Math.PI)).toBeLessThan(1e-9);
    // Slack: the wind from 090°, swung 10°.
    expect(lyingHeading(withStream(0, 0, 90), 0, 0, 0, 10 * DEG)).toBeCloseTo(100 * DEG, 9);
    // In between (0.06 m/s, in the blend), somewhere between the two.
    const h = lyingHeading(withStream(0, 0.06 / 0.514444, 90), 0, 0, 0);
    expect(h).toBeGreaterThan(90 * DEG);
    expect(h).toBeLessThan(180 * DEG);
  });

  it('answers the base wind, not each gust and shift', () => {
    const base: BaseWind = { at: () => ({ speed: 5, fromDir: 30 * DEG }) };
    const field = new WindField(base, { ...GUST_PRESETS.shifty, seed: 3 });
    const env: Environment = { wind: (_t, n, e) => field.wind(n, e), current: () => ({ n: 0, e: 0 }), label: 'test', windField: field };
    for (let i = 0; i < 3000; i++) field.step(i * 0.01, 0.01);
    expect(lyingHeading(env, 30, 0, 0)).toBeCloseTo(30 * DEG, 9);
  });

  it('a mooring\'s swing comes from the layout and stays within ±15°', () => {
    for (const h of [0, 7, 15, 29, 30, 1234567]) {
      expect(Math.abs(mooringSwingDeg(h))).toBeLessThanOrEqual(15);
    }
  });

  it('the moored boat the physics hits is the one the pose function places (what the renderer draws)', () => {
    const env = withStream(0, 0, 0); // slack, wind from the north: she lies bow north, south of her buoy
    const m = { n: 0, e: 0, l: 9, swingDeg: 0, area: 'test' };
    const pose = mooredBoatPose(m, env, 0);
    expect(pose.heading).toBeCloseTo(0, 9);
    expect(pose.n).toBeCloseTo(-(9 / 2 + 2), 9);
    const outline = placeOutline(boxOutline(9, 9 * 0.33), pose.n, pose.e, pose.heading);
    const eastEdge = Math.max(...outline.map((p) => p.e));
    const P = squibParams();
    const pass = (gap: number) => {
      // A Squib heading north alongside, her port side `gap` m from the moored boat's starboard side.
      const s = new Simulation({ params: P, env, ownsEnvironment: false, initial: { n: pose.n - 12, e: eastEdge + P.beam / 2 + gap, headingDeg: 0, speedKn: 2 }, input: { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, autoCrew: false }, lockHeading: true, logInputs: false });
      const f = new Fleet(env);
      f.add({ id: 'a', name: 'A', sailNumber: '1', colour: 0, kind: 'human', sim: s });
      f.setObstacles({ moored: [m] });
      for (let i = 0; i < 1500; i++) if (f.stepOnce().some((ev) => ev.kind === 'moored')) return true;
      return false;
    };
    expect(pass(-0.2)).toBe(true);
    expect(pass(0.2)).toBe(false);
  });

  it('SAMARITAN\'s contact outline is her size', () => {
    const xs = COMMITTEE_OUTLINE.x;
    const ys = COMMITTEE_OUTLINE.y;
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(COMMITTEE_BOAT.loa, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(COMMITTEE_BOAT.beam, 1);
    expect(Math.max(...xs)).toBeCloseTo(COMMITTEE_BOAT.loa / 2, 6);
  });
});
