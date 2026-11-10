/** Start-line readouts and start drills (src/app/startLine.ts). */
import { describe, expect, it } from 'vitest';
import { BOAT_LENGTH_M, WindFollower, alongLine, drillVerdict, lineBias, lineReadout, scoreStart, type P } from '../../src/app/startLine';

// A line across the wind, west to east, with the first mark 500 m north (upwind of it).
const line: [P, P] = [{ n: 0, e: -50 }, { n: 0, e: 50 }];
const mark = { n: 500, e: 0 };
const northerly = { n: -5, e: 0 }; // the air moving south: wind from the north

describe('where you are against the line', () => {
  it('distance, time to the line at this speed, and the time to burn before the gun', () => {
    const r = lineReadout(line, mark, { n: -30, e: 0 }, { n: 2, e: 0 }, 20);
    expect(r.distanceM).toBeCloseTo(30, 9);
    expect(r.withinEnds).toBe(true);
    expect(r.closingMs).toBeCloseTo(2, 9);
    expect(r.motion).toBe('closing');
    expect(r.timeToLineS).toBeCloseTo(15, 9);
    expect(r.burnS).toBeCloseTo(5, 9);
    // Closing at an angle: only the speed square to the line counts.
    const slant = lineReadout(line, mark, { n: -30, e: 0 }, { n: 1, e: 3 }, 20);
    expect(slant.timeToLineS).toBeCloseTo(30, 9);
    expect(slant.burnS).toBeCloseTo(-10, 9);
  });

  it('over the line, beyond the ends, holding position and sailing away', () => {
    const over = lineReadout(line, mark, { n: 5, e: 0 }, { n: -1, e: 0 }, 10);
    expect(over.distanceM).toBeCloseTo(-5, 9);
    expect(over.motion).toBe('closing'); // heading back to the line
    expect(over.timeToLineS).toBeUndefined();
    const beyond = lineReadout(line, mark, { n: -10, e: 80 }, { n: 0, e: 0 }, 10);
    expect(beyond.withinEnds).toBe(false);
    expect(beyond.distanceM).toBeCloseTo(Math.hypot(10, 30), 9);
    // Beyond the ends the time is to the nearer end, at the speed towards it.
    const toEnd = lineReadout(line, mark, { n: -30, e: 90 }, { n: 0, e: -2 }, 60);
    expect(toEnd.distanceM).toBeCloseTo(50, 9);
    expect(toEnd.closingMs).toBeCloseTo((2 * 40) / 50, 9);
    expect(toEnd.timeToLineS).toBeCloseTo(50 / 1.6, 9);
    expect(lineReadout(line, mark, { n: -20, e: 0 }, { n: 0.1, e: 0.5 }, 10).motion).toBe('holding');
    const away = lineReadout(line, mark, { n: -20, e: 0 }, { n: -1.5, e: 0 }, 10);
    expect(away.motion).toBe('opening');
    expect(away.timeToLineS).toBeUndefined();
    expect(away.burnS).toBeUndefined();
  });

  it('the side of the line comes from the first mark, whichever way round the ends are given', () => {
    const flipped: [P, P] = [line[1], line[0]];
    expect(lineReadout(flipped, mark, { n: -30, e: 0 }, { n: 2, e: 0 }, 20).distanceM).toBeCloseTo(30, 9);
  });
});

describe('the line bias', () => {
  it('the end further upwind is favoured for a start into a beat, by the distance and the angle', () => {
    const skew: [P, P] = [{ n: 0, e: -50 }, { n: 10, e: 50 }];
    const b = lineBias(skew, mark, northerly);
    expect(b.upwindStart).toBe(true);
    expect(b.favoured).toBe(1);
    expect(b.advantageM).toBeCloseTo(10, 9);
    expect(b.lengths).toBeCloseTo(10 / BOAT_LENGTH_M, 9);
    expect(b.angleDeg).toBeCloseTo((Math.asin(10 / Math.hypot(10, 100)) * 180) / Math.PI, 9);
    // The same line into a run: the end further downwind.
    expect(lineBias(skew, { n: -500, e: 0 }, northerly).favoured).toBe(0);
  });

  it('a line within 2° of square is called square', () => {
    expect(lineBias([{ n: 0, e: -50 }, { n: 1, e: 50 }], mark, northerly).favoured).toBeUndefined();
    expect(lineBias(line, mark, northerly).angleDeg).toBeCloseTo(0, 9);
  });

  it('a wind shift changes the favoured end; the follower shows a shift that lasts, not a gust', () => {
    const veer = { n: -5 * Math.cos((10 * Math.PI) / 180), e: -5 * Math.sin((10 * Math.PI) / 180) }; // from 010°
    expect(lineBias(line, mark, veer).favoured).toBe(1); // the east end is now further upwind
    const f = new WindFollower(30);
    f.update(northerly, 0.1);
    // Two seconds of a 10° veer moves the followed wind under 1°.
    for (let i = 0; i < 20; i++) f.update(veer, 0.1);
    expect(lineBias(line, mark, f.value!).favoured).toBeUndefined();
    // Two minutes of it: the follower has come round.
    for (let i = 0; i < 1200; i++) f.update(veer, 0.1);
    expect(lineBias(line, mark, f.value!).angleDeg).toBeGreaterThan(9);
  });
});

describe('a drill start, scored', () => {
  const bias = lineBias([{ n: 0, e: -50 }, { n: 10, e: 50 }], mark, northerly);
  it('late by, where at the gun, how fast, and where on the line', () => {
    const s = scoreStart({ attempt: 2, line, firstMark: mark, gunT: 90, startedT: 92.4, ocs: false, atGun: { n: -6, e: 30 }, velocityAtGun: { n: 2, e: 0 }, crossed: { n: 0, e: 32 }, bias });
    expect(s.lateS).toBeCloseTo(2.4, 9);
    expect(s.atGunM).toBeCloseTo(6, 9);
    expect(s.atGunKn).toBeCloseTo(2 / 0.514444, 6);
    expect(s.crossedAt).toBeCloseTo(0.82, 9);
    expect(s.favoured).toBe(1);
    expect(s.favouredThird).toBe(true);
    expect(drillVerdict(s)).toBe('A good start, at speed at the gun, at the favoured end.');
  });

  it('over at the gun, and not started', () => {
    const ocs = scoreStart({ attempt: 1, line, firstMark: mark, gunT: 90, ocs: true, atGun: { n: 3, e: 0 }, velocityAtGun: { n: 2, e: 0 }, bias });
    expect(ocs.atGunM).toBeCloseTo(-3, 9);
    expect(drillVerdict(ocs)).toMatch(/Over the line at the gun/);
    const none = scoreStart({ attempt: 1, line, firstMark: mark, gunT: 90, ocs: false, atGun: { n: -60, e: 0 }, velocityAtGun: { n: 0, e: 0 }, bias });
    expect(none.lateS).toBeUndefined();
    expect(drillVerdict(none)).toMatch(/Not started yet/);
  });

  it('along the line, clamped to the ends', () => {
    expect(alongLine(line, { n: -5, e: -50 })).toBe(0);
    expect(alongLine(line, { n: -5, e: 0 })).toBeCloseTo(0.5, 9);
    expect(alongLine(line, { n: 0, e: 90 })).toBe(1);
  });
});
