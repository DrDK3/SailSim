/**
 * AI fleet safety (package F, review #27, issue 42): what made big AI fleets collide, each with a test that failed
 * before its fix. The trials themselves (`npm run ai:trials -- --boats 10 --first 101`) are the measure; these are the
 * mechanisms.
 */
import { describe, expect, test } from 'vitest';
import { DEG, practiceCourse } from '../../src/sim/index';
import { wrapPi } from '../../src/sim/math/angles';
import { createRace, practiceLineLength } from '../../src/sim/race/setup';

function race(boats: number, windFromDeg: number) {
  const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg, laps: 1, startLineM: practiceLineLength(boats) });
  return createRace({
    conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: windFromDeg }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    course,
    aiCount: boats,
    level: 'good',
    seed: 7,
    committee: { startAt: 330, sequence: 'five-minute', finishWindowS: 600, timeLimitS: 3000 },
  }).session;
}

describe('AI starts in a big fleet', () => {
  test.each([5, 10, 20])('%i boats: every boat makes for its own spot on the line, at least a hull length from the next', (boats) => {
    const session = race(boats, 225);
    // The timed runs begin within the last minute or so; by 10 s before the signal every boat has chosen its spot.
    session.advance(session.committee.startTime - 10 - session.time);
    const spots = [...session.skippers.values()].map((s) => s.startSpot!);
    expect(spots.every(Boolean)).toBe(true);
    let least = Infinity;
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) least = Math.min(least, Math.hypot(spots[i]!.n - spots[j]!.n, spots[i]!.e - spots[j]!.e));
    // Before the fix the boats nearest each end were clamped onto the same spot (0 m apart).
    expect(least).toBeGreaterThan(5.79);
  }, 180_000);
});

describe('AI boats waiting before the start', () => {
  test.each([5, 10, 20])('%i boats: their waiting places are spread so that neighbours, drifting while they wait, do not meet', (boats) => {
    const session = race(boats, 225);
    const holds = [...session.skippers.values()].map((s) => s.holdPoint);
    let least = Infinity;
    for (let i = 0; i < holds.length; i++) for (let j = i + 1; j < holds.length; j++) least = Math.min(least, Math.hypot(holds[i]!.n - holds[j]!.n, holds[i]!.e - holds[j]!.e));
    // Before the fix they waited at their starting slots, 17.6 m apart in a row of seven (each boat wanders up to 30 m).
    expect(least).toBeGreaterThan(30);
  }, 60_000);
});

describe('AI collision avoidance', () => {
  test('a boat sailing side by side with another, not closing, needs less room than one converging', () => {
    const session = race(2, 225);
    const [[idA, skA], [idB]] = [...session.skippers.entries()] as [[string, unknown], [string, unknown]];
    const A = session.fleet.boat(idA)!.sim;
    const B = session.fleet.boat(idB)!.sim;
    const wind = { dir: 225 * DEG, speed: 10 * 0.5144, cur: { n: 0, e: 0 } };
    const polar = (session as unknown as { polar: { speed: (tws: number, twa: number) => number } }).polar;
    // A beam reach on starboard (heading 135°), both at the polar speed; B 11 m to leeward, abeam.
    const h = 135 * DEG;
    const v0 = polar.speed(wind.speed, 90 * DEG);
    Object.assign(A.state, { n: -3600, e: 1200, psi: h, u: v0, v: 0, r: 0 });
    Object.assign(B.state, { n: -3600 + 11 * Math.cos(45 * DEG), e: 1200 + 11 * Math.sin(45 * DEG), psi: h, u: v0, v: 0, r: 0 });
    type Scorer = { score: (h: number, slow: boolean, dev: number, mode?: string) => number };
    const goal = { p: { n: -3800, e: 1400 }, label: 'test', lineWall: false, depower: 0 };
    const sc = (skA as { makeScorer: (...a: unknown[]) => Scorer }).makeScorer(A, { n: A.state.n, e: A.state.e }, goal, wind, 40 * DEG);
    // Holding her course beside B counts as clear of boats (under 0.3, the level at which the skipper stops letting
    // boats pass: her leeway still closes on B a little); heading at B costs plenty. Before the fix the parallel course
    // cost 1.5, as much as a near miss (16 m asked of a boat keeping clear, whatever the geometry).
    expect(sc.score(h, false, 0, 'boats')).toBeLessThan(0.3);
    expect(sc.score(h - 40 * DEG, false, 0, 'boats')).toBeGreaterThan(0.5);
  }, 60_000);

  test('never steers within 5° of dead downwind, where her tack (and who has right of way) would flip', () => {
    const session = race(2, 225);
    const [id, sk] = [...session.skippers.entries()][0]!;
    const sim = session.fleet.boat(id)!.sim;
    const wind = { dir: 225 * DEG, speed: 5, cur: { n: 0, e: 0 } };
    const deadRun = wind.dir + Math.PI;
    // Every heading carries risk except within 4° of dead downwind, so that is the cheapest escape.
    const score = (h: number) => (Math.abs(wrapPi(h - deadRun)) < 4 * DEG ? 0 : 1);
    const nav = { mode: 'heading' as const, target: wind.dir - 150 * DEG, depower: 0 };
    type Avoid = (sim: unknown, sc: unknown, nav: unknown, wind: unknown, beatTwa: number) => { mode: string; target: number };
    const cmd = (sk as unknown as { avoid: Avoid }).avoid(sim, { score, prev: undefined }, nav, wind, 40 * DEG);
    const twa = cmd.mode === 'twa' ? cmd.target : wrapPi(wind.dir - cmd.target);
    // Before the fix it picked the dead run itself (TWA 180°).
    expect(Math.abs(twa)).toBeLessThanOrEqual(175 * DEG + 1e-9);
  }, 60_000);
});

describe('who keeps clear', () => {
  test('of two boats out of the race (finished), exactly one keeps clear of the other', () => {
    const session = race(2, 225);
    const [[idA, skA], [idB, skB]] = [...session.skippers.entries()] as [[string, unknown], [string, unknown]];
    // Both finished: each heading for her waiting place beyond the finishing line.
    (session as unknown as { outOfRace: (id: string) => boolean }).outOfRace = () => true;
    type KeepsClear = (b: unknown, mine: unknown) => boolean;
    const kc = (sk: unknown, other: string, me: string) => (sk as { keepsClearOf: KeepsClear }).keepsClearOf(session.fleet.boat(other)!, session.rulesBoat(me));
    // Before the fix both kept clear (true, true), and both swerved.
    expect([kc(skA, idB, idA), kc(skB, idA, idB)].filter(Boolean)).toHaveLength(1);
  }, 60_000);

  test('at a mark, the boat that must give mark-room keeps clear, as the judge rules it (simplified rule 18)', () => {
    const session = race(2, 225);
    const [[idA, skA], [idB, skB]] = [...session.skippers.entries()] as [[string, unknown], [string, unknown]];
    type KeepsClear = (b: unknown, mine: unknown) => boolean;
    const kc = (sk: unknown, other: string, me: string) => (sk as { keepsClearOf: KeepsClear }).keepsClearOf(session.fleet.boat(other)!, session.rulesBoat(me));
    const world = session as unknown as { markRoomGiver: (a: string, b: string) => string | undefined };
    // Whichever boat the tracker says owes mark-room keeps clear, and the other does not (before the fix the AI
    // asked only rules 10–13, so one of the two cases came out the other way round).
    for (const giver of [idA, idB]) {
      world.markRoomGiver = () => giver;
      expect(kc(skA, idB, idA)).toBe(giver === idA);
      expect(kc(skB, idA, idB)).toBe(giver === idB);
    }
  }, 60_000);
});

describe('AI near marks and in locks', () => {
  type Scorer = { score: (h: number, slow: boolean, dev: number, mode?: string) => number };
  const goal = { p: { n: -3000, e: 1200 }, label: 'test', lineWall: false, depower: 0 };

  test('turning away from a mark close by counts the stern swinging onto it, not only where the centre goes', () => {
    const session = race(2, 270);
    const [[idA, skA], [idB]] = [...session.skippers.entries()] as [[string, unknown], [string, unknown]];
    const A = session.fleet.boat(idA)!.sim;
    // A heading north at 2 m/s on a beam reach (wind from the west); a mark 7.5 m to her west; the other boat far off.
    Object.assign(A.state, { n: -3600, e: 1200, psi: 0, u: 2, v: 0, r: 0 });
    Object.assign(session.fleet.boat(idB)!.sim.state, { n: -2600, e: 2200 });
    session.obstacles.push({ id: 'mark-test', label: 'Test mark', kind: 'mark', n: -3600, e: 1192.5, radius: 0.6, stiffness: 1, damping: 1 } as never);
    const wind = { dir: 270 * DEG, speed: 10 * 0.5144, cur: { n: 0, e: 0 } };
    const sc = (skA as { makeScorer: (...a: unknown[]) => Scorer }).makeScorer(A, { n: A.state.n, e: A.state.e }, goal, wind, 40 * DEG);
    // Bearing away to the east carries her centre away from the mark, but swings her stern towards it: with the hull's
    // ends counted it is the riskier choice. Before the fix neither choice counted the mark at all (her centre stays
    // outside its margin), so she would turn away just as readily.
    expect(sc.score(90 * DEG, false, 0, 'risk')).toBeGreaterThan(sc.score(0, false, 0, 'risk'));
  }, 60_000);

  test('locked side by side for more than 5 s: the boat keeping clear lets her sails go, the other keeps hers drawing', () => {
    const session = race(2, 225);
    const [[idA, skA], [idB, skB]] = [...session.skippers.entries()] as [[string, unknown], [string, unknown]];
    const A = session.fleet.boat(idA)!.sim;
    const B = session.fleet.boat(idB)!.sim;
    session.advance(10);
    // Both on starboard on a beam reach (heading 135°), A 2.2 m to windward of B and level with her, both at 2.4 m/s;
    // one step so the race's rules see them there.
    const h = 135 * DEG;
    Object.assign(A.state, { n: -3600, e: 1200, psi: h, u: 2.4, v: 0, r: 0 });
    Object.assign(B.state, { n: -3600 + 2.2 * Math.cos(45 * DEG), e: 1200 + 2.2 * Math.sin(45 * DEG), psi: h, u: 2.4, v: 0, r: 0 });
    session.step();
    type Reflex = { giveWay: boolean; sideBySide: boolean } | undefined;
    const reflexOf = (sk: unknown, sim: unknown) => (sk as { collisionReflex: (s: unknown) => Reflex }).collisionReflex(sim);
    // The reflex sees the lock, and that exactly one of the two keeps clear.
    const rA = reflexOf(skA, A)!;
    const rB = reflexOf(skB, B)!;
    expect(rA.sideBySide && rB.sideBySide).toBe(true);
    expect(rA.giveWay).not.toBe(rB.giveWay);
    // From here on the reflex is held as found (so the test sees only what holding it longer changes).
    (skA as { collisionReflex: () => Reflex }).collisionReflex = () => rA;
    (skB as { collisionReflex: () => Reflex }).collisionReflex = () => rB;
    type Ctl = { control: (s: unknown) => { autoMain?: boolean; autoJib?: boolean }; reflexSince: number };
    const out = (sk: unknown, sim: typeof A, heldS: number) => {
      const c = sk as Ctl;
      (sk as { sheets: { ease: number } }).sheets.ease = 0;
      (sk as { reflex: Reflex }).reflex = sk === skA ? rA : rB;
      c.reflexSince = sim.time - heldS;
      return c.control(sim);
    };
    const [giver, gSim, stand, sSim] = rA.giveWay ? [skA, A, skB, B] : [skB, B, skA, A];
    // Just begun: both ease their sails (as before). Held 6 s: the boat keeping clear lets her jib fly, the other
    // sails on under full trim (before the fix both kept easing, however long the lock lasted).
    expect(out(giver, gSim, 0).autoJib).toBe(true);
    expect(out(stand, sSim, 0).autoMain).toBe(false);
    expect(out(giver, gSim, 6).autoJib).toBe(false);
    expect(out(stand, sSim, 6).autoMain).toBe(true);
  }, 60_000);
});
