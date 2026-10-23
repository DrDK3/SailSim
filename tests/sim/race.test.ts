/**
 * Phase 5: fleet contact, race committee, the simplified rules subset, penalty turns, the AI polar and a short
 * AI race. Contact coefficients, AI behaviour and the rules subset are documented in docs/RACING.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEG, Simulation, autopilotHelm, practiceCourse, squibParams, uniformEnvironment } from '../../src/sim/index';
import { Fleet, markRadius, CONTACT } from '../../src/sim/race/fleet';
import { circleContact, placeOutline, polygonContact, squibOutline } from '../../src/sim/race/hull';
import { DEFAULT_COMMITTEE, RaceCommittee, type BoatRaceStatus } from '../../src/sim/race/committee';
import { PenaltyTracker, TackTracker, clearAstern, overlapped, rightOfWay, tackOf, type RulesBoat } from '../../src/sim/race/rules';
import { Polar, paramsFingerprint } from '../../src/sim/ai/polar';
import { AI_POLAR } from '../../src/sim/ai/polarData';
import { createRace } from '../../src/sim/race/setup';
import { loadDartGeo } from './helpers';

const params = squibParams();

describe('hull outline and contact geometry', () => {
  const o = squibOutline(params);
  test('the outline matches the class length and beam and is convex and clockwise', () => {
    const xs = o.x;
    const ys = o.y;
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(params.loa, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(params.beam, 6);
    const pts = placeOutline(o, 0, 0, 0);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const c = pts[(i + 2) % pts.length]!;
      // Clockwise seen from above (e right, n up): every turn is to the right.
      expect((b.e - a.e) * (c.n - b.n) - (b.n - a.n) * (c.e - b.e)).toBeLessThanOrEqual(1e-9);
    }
  });
  test('overlap is detected with the right depth and normal, separation is not', () => {
    const a = placeOutline(o, 0, 0, 0);
    // Side by side, 1.5 m apart centre to centre: the hulls (1.87 m beam) overlap by 0.37 m.
    const b = placeOutline(o, 0, 1.5, 0);
    const c = polygonContact(a, b)!;
    // Minimum overlap over all axes: just under the 0.37 m beam overlap (the sides are slightly slanted there).
    expect(c.depth).toBeGreaterThan(0.33);
    expect(c.depth).toBeLessThanOrEqual(params.beam - 1.5 + 1e-9);
    expect(c.normal.e).toBeGreaterThan(0.99);
    expect(polygonContact(a, placeOutline(o, 0, 2, 0))).toBeNull();
    expect(circleContact(a, { n: 3.3, e: 0 }, 0.4)).not.toBeNull(); // bow at 2.95 m
    expect(circleContact(a, { n: 3.5, e: 0 }, 0.4)).toBeNull();
  });
});

describe('fleet: contact between boats', () => {
  const run = () => {
    const env = uniformEnvironment({ twsKn: 10, twdDeg: 0 });
    const fleet = new Fleet(env);
    const boat = (id: string, n: number, e: number, hdg: number) =>
      fleet.add({
        id, name: id, sailNumber: id, colour: 0, kind: 'ai',
        sim: new Simulation({ params, env, ownsEnvironment: false, initial: { n, e, headingDeg: hdg, speedKn: 4 }, input: { autoMain: true, autoJib: true }, controller: (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: hdg * DEG }) }) }),
      });
    // Starboard tack (heading 315) and port tack (045) on a collision course.
    const A = boat('A', -40, 40, 315);
    const B = boat('B', -40, -40, 45);
    let maxDepth = 0;
    for (let i = 0; i < 3000; i++) {
      fleet.stepOnce();
      const c = polygonContact(placeOutline(A.outline, A.sim.state.n, A.sim.state.e, A.sim.state.psi), placeOutline(B.outline, B.sim.state.n, B.sim.state.e, B.sim.state.psi));
      if (c) maxDepth = Math.max(maxDepth, c.depth);
    }
    return { fleet, maxDepth, gap: Math.hypot(A.sim.state.n - B.sim.state.n, A.sim.state.e - B.sim.state.e) };
  };
  test('the hulls push apart: shallow penetration, a contact event, deterministic', () => {
    const r1 = run();
    expect(r1.fleet.events.length).toBeGreaterThan(0);
    expect(r1.fleet.events[0]!.kind).toBe('boat');
    expect(r1.fleet.events[0]!.speed).toBeGreaterThan(1);
    expect(r1.maxDepth).toBeLessThan(0.3);
    expect(r1.maxDepth).toBeGreaterThan(0);
    const r2 = run();
    expect(r2.fleet.stateHash()).toBe(r1.fleet.stateHash());
  });
  test('a boat sailing into an inflatable mark touches it and slides off it without passing through', () => {
    const env = uniformEnvironment({ twsKn: 10, twdDeg: 0 });
    const fleet = new Fleet(env);
    const b = fleet.add({ id: 'A', name: 'A', sailNumber: 'A', colour: 0, kind: 'ai', sim: new Simulation({ params, env, ownsEnvironment: false, initial: { n: 0, e: 0, headingDeg: 90, speedKn: 4 }, input: { autoMain: true, autoJib: true }, controller: (s) => ({ helm: autopilotHelm(s, { mode: 'heading', target: 90 * DEG }) }) }) });
    fleet.setObstacles({ marks: [{ id: 'mark-X', label: 'X', kind: 'mark', n: 0, e: 30, radius: markRadius('inflatable')!, stiffness: CONTACT.softStiffness, damping: CONTACT.softDamping }] });
    let maxDepth = 0;
    for (let i = 0; i < 2500; i++) {
      fleet.stepOnce();
      const c = circleContact(placeOutline(b.outline, b.sim.state.n, b.sim.state.e, b.sim.state.psi), { n: 0, e: 30 }, markRadius('inflatable')!);
      if (c) maxDepth = Math.max(maxDepth, c.depth);
    }
    expect(fleet.events.some((e) => e.kind === 'mark' && e.b === 'mark-X')).toBe(true);
    expect(maxDepth).toBeGreaterThan(0);
    expect(maxDepth).toBeLessThan(0.5); // a soft mark gives a little but the hull does not pass through it
  });
});

describe('race committee (rule 26, 29, 30, Appendix A)', () => {
  const line: [{ n: number; e: number }, { n: number; e: number }] = [{ n: 0, e: -50 }, { n: 0, e: 50 }];
  const first = { n: 600, e: 0 };
  const status = (o: Partial<BoatRaceStatus> & { id: string }): BoatRaceStatus => ({ started: false, ocs: false, wasOcs: false, finished: false, retired: false, ...o });
  const behind = () => [{ n: -20, e: 0 }];

  test('five-minute sequence: class flag at 5, P at 4, P down at 1 (long sound), start', () => {
    const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 330 }, ['a'], line, first);
    const seen: [number, string][] = [];
    for (let t = 0.01; t <= 331; t = Math.round((t + 0.01) * 100) / 100) {
      for (const s of c.update(t, [status({ id: 'a' })], behind)) seen.push([s.t, s.name]);
      if (Math.abs(t - 100) < 0.005) expect([...c.flags].sort()).toEqual(['P', 'class']);
      if (Math.abs(t - 300) < 0.005) expect([...c.flags]).toEqual(['class']);
    }
    expect(seen).toEqual([[30, 'warning'], [90, 'preparatory'], [270, 'one-minute'], [330, 'start']]);
    expect(c.log.find((l) => l.name === 'one-minute')!.long).toBe(true);
  });

  test('individual recall: X up at the start, down when the OCS boat has returned', () => {
    const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 60, sequence: 'one-minute' }, ['a', 'b', 'c', 'd'], line, first);
    const st = ['a', 'b', 'c', 'd'].map((id) => status({ id }));
    st[0]!.ocs = true;
    st[0]!.wasOcs = true;
    c.update(60, st, behind);
    expect(c.flags.has('X')).toBe(true);
    c.update(70, st, behind);
    expect(c.flags.has('X')).toBe(true);
    st[0]!.ocs = false;
    const out = c.update(71, st, behind);
    expect(out.map((s) => s.name)).toEqual(['x-down']);
    expect(c.flags.has('X')).toBe(false);
  });

  test('X comes down four minutes after the start even if a boat has not returned', () => {
    const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 60, sequence: 'one-minute' }, ['a', 'b', 'c', 'd'], line, first);
    const st = ['a', 'b', 'c', 'd'].map((id) => status({ id, ocs: id === 'a', wasOcs: id === 'a' }));
    c.update(60, st, behind);
    c.update(299.99, st, behind);
    expect(c.flags.has('X')).toBe(true);
    c.update(300, st, behind);
    expect(c.flags.has('X')).toBe(false);
  });

  test('general recall: First Substitute, down after a minute, new warning one minute later', () => {
    const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 330 }, ['a', 'b', 'c', 'd', 'e'], line, first);
    const st = ['a', 'b', 'c', 'd', 'e'].map((id) => status({ id, ocs: id < 'd', wasOcs: id < 'd' }));
    const names: [number, string][] = [];
    for (let t = 0.01; t <= 800; t = Math.round((t + 0.01) * 100) / 100) for (const s of c.update(t, t < 330.005 ? st : st.map((x) => ({ ...x, ocs: false })), behind)) names.push([s.t, s.name]);
    expect(names.slice(3)).toEqual([[330, 'start'], [330, 'general-recall'], [390, 'first-substitute-down'], [450, 'warning'], [510, 'preparatory'], [690, 'one-minute'], [750, 'start']]);
    expect(c.attempt).toBe(2);
    // After a general recall the default preparatory flag is U (rule 30.3, E policy).
    expect(c.prepFlag).toBe('U');
  });

  test('U flag (30.3): a boat in the triangle in the last minute is UFD; black flag (30.4) is BFD', () => {
    for (const flag of ['U', 'black'] as const) {
      const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 330, prepFlag: flag }, ['a', 'b'], line, first);
      const hulls = (id: string) => (id === 'a' ? [{ n: 5, e: 0 }] : [{ n: -20, e: 0 }]);
      const st = [status({ id: 'a' }), status({ id: 'b' })];
      for (let t = 0.01; t <= 331; t = Math.round((t + 0.01) * 100) / 100) c.update(t, st, hulls);
      expect([...(flag === 'U' ? c.ufd : c.bfd)]).toEqual(['a']);
      expect(c.flags.has('X')).toBe(false); // rule 29.1 does not apply with U or black flag
    }
  });

  test('results: low points, finishers by time, others entries + 1', () => {
    const c = new RaceCommittee({ ...DEFAULT_COMMITTEE, startAt: 60 }, ['a', 'b', 'c', 'd', 'e'], line, first);
    const rows = c.results([
      status({ id: 'a', started: true, finished: true, finishTime: 900 }),
      status({ id: 'b', started: true, finished: true, finishTime: 850 }),
      status({ id: 'c', started: true }),
      status({ id: 'd', wasOcs: true }),
      status({ id: 'e' }),
    ]);
    expect(rows.map((r) => [r.id, r.code, r.points])).toEqual([['b', 'FIN', 1], ['a', 'FIN', 2], ['c', 'DNF', 6], ['d', 'OCS', 6], ['e', 'DNS', 6]]);
    expect(rows[0]!.elapsed).toBe(790);
  });
});

describe('rules subset (Part 2: rules 10–13; definitions)', () => {
  const o = squibOutline(params);
  const boat = (id: string, n: number, e: number, headingDeg: number, twaDeg: number, extra: Partial<RulesBoat> = {}): RulesBoat => {
    const heading = headingDeg * DEG;
    const twa = twaDeg * DEG;
    const mainSide: 1 | -1 = twa >= 0 ? 1 : -1;
    return { id, n, e, heading, twa, mainSide, tack: tackOf(twa, mainSide, 'starboard'), tacking: false, outline: placeOutline(o, n, e, heading), ...extra };
  };

  test('tack from the windward side; by the lee and dead downwind from the side the mainsail lies on', () => {
    expect(tackOf(45 * DEG, 1, 'port')).toBe('starboard');
    expect(tackOf(-45 * DEG, -1, 'starboard')).toBe('port');
    expect(tackOf(0, 1, 'port')).toBe('port'); // head to wind: unchanged
    expect(tackOf(-170 * DEG, 1, 'port')).toBe('starboard'); // by the lee, main to port
    expect(tackOf(180 * DEG, -1, 'starboard')).toBe('port'); // dead downwind, main to starboard
  });

  test('rule 10: port tack keeps clear of starboard tack', () => {
    const s = boat('S', 0, 10, 315, 45);
    const p = boat('P', 0, -10, 45, -45);
    expect(rightOfWay(s, p)).toMatchObject({ keepClear: 'P', rule: '10' });
  });

  test('rule 11: overlapped on the same tack, windward keeps clear', () => {
    // Wind from 000°, both on starboard (heading 315), side by side: L is to leeward (south-west).
    const w = boat('W', 0, 0, 315, 45);
    const l = boat('L', -3, -3, 315, 45);
    expect(overlapped(w, l)).toBe(true);
    expect(rightOfWay(w, l)).toMatchObject({ keepClear: 'W', rule: '11' });
  });

  test('rule 12: not overlapped, clear astern keeps clear', () => {
    const ahead = boat('A', 10, 0, 0, 45);
    const astern = boat('B', 0, 0, 0, 45);
    expect(clearAstern(astern, ahead)).toBe(true);
    expect(overlapped(astern, ahead)).toBe(false);
    expect(rightOfWay(ahead, astern)).toMatchObject({ keepClear: 'B', rule: '12' });
  });

  test('rule 13: a boat tacking keeps clear (rules 10–12 do not apply to her)', () => {
    const s = boat('S', 0, 10, 315, 45);
    const t = boat('T', 0, -10, 10, -10, { tacking: true });
    expect(rightOfWay(s, t)).toMatchObject({ keepClear: 'T', rule: '13' });
    const tr = new TackTracker(45 * DEG, 1);
    tr.update(-5 * DEG, -1, 40 * DEG);
    expect(tr.tacking).toBe(true);
    tr.update(-38 * DEG, -1, 40 * DEG);
    expect(tr.tacking).toBe(false); // close-hauled (within 3°)
  });
});

describe('penalty turns (rule 44.2)', () => {
  /** Feed a steady turn: heading changes by `rate` per step, wind from 000° (TWA = −heading). */
  const turn = (p: PenaltyTracker, from: number, degrees: number, step = 2) => {
    let h = from;
    for (let i = 0; i < Math.abs(degrees) / step; i++) {
      h += Math.sign(degrees) * step;
      p.update(h * DEG, -(((h + 180) % 360) - 180) * DEG);
    }
    return h;
  };
  test('two full turns in one direction, each with a tack and a gybe, complete a Two-Turns Penalty', () => {
    const p = new PenaltyTracker(2, 315 * DEG, 45 * DEG);
    const h = turn(p, 315, 364);
    expect(p.done).toBe(1);
    turn(p, h, 364);
    expect(p.complete).toBe(true);
  });
  test('turning back restarts the turn; a turn without a gybe does not count', () => {
    const p = new PenaltyTracker(1, 315 * DEG, 45 * DEG);
    const h = turn(p, 315, 200);
    turn(p, h, -60);
    expect(p.done).toBe(0);
    const q = new PenaltyTracker(1, 90 * DEG, -90 * DEG);
    turn(q, 90, -150); // through head to wind only
    expect(q.done).toBe(0);
  });
});

describe('AI polar', () => {
  const polar = new Polar(AI_POLAR);
  test('the stored polar was computed from the current boat parameters (regenerate with npm run ai:polar)', () => {
    expect(AI_POLAR.paramsHash).toBe(paramsFingerprint(params));
  });
  test('best VMG angles are plausible for a keelboat and model output only', () => {
    for (const kn of [5, 10, 15]) {
      const tws = kn * 0.5144;
      expect(polar.beat(tws).twa / DEG).toBeGreaterThan(28);
      expect(polar.beat(tws).twa / DEG).toBeLessThan(50);
      expect(polar.run(tws).twa / DEG).toBeGreaterThan(140);
      expect(polar.speed(tws, 90 * DEG)).toBeGreaterThan(polar.speed(tws, 40 * DEG));
    }
  });
});

describe('AI race (short)', () => {
  const geo = loadDartGeo();
  const features = JSON.parse(readFileSync(new URL('../../public/geo/features.json', import.meta.url), 'utf8'));
  const race = () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 220, legM: 250, laps: 1, startLineM: 100 });
    const { session } = createRace({
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 220 }, gusts: { preset: 'moderate', seed: 3 }, current: { mode: 'none' } },
      geo, features, course, aiCount: 3, level: 'good', seed: 3,
      committee: { startAt: 90, sequence: 'one-minute', finishWindowS: 300 },
    });
    while (!session.finished && session.time < 1200) session.step();
    return session;
  };
  test('three AI boats start, sail a windward–leeward and finish; the race is deterministic', () => {
    const a = race();
    const res = a.results();
    expect(res.map((r) => r.code)).toEqual(['FIN', 'FIN', 'FIN']);
    expect(a.status().every((s) => s.startTime! >= 90)).toBe(true);
    for (const b of a.fleet.boats) expect(Number.isFinite(b.sim.state.n)).toBe(true);
    const b = race();
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.results().map((r) => [r.id, r.finishTime])).toEqual(res.map((r) => [r.id, r.finishTime]));
  }, 120_000);

  test('a sequence that begins at once shows its flags before the first step', () => {
    const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 220, legM: 250, laps: 1, startLineM: 100 });
    const { session } = createRace({
      conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 11, twdDeg: 220 }, gusts: { preset: 'moderate', seed: 3 }, current: { mode: 'none' } },
      geo, features, course, aiCount: 1, level: 'good', seed: 3,
      committee: { startAt: 60, sequence: 'one-minute' },
    });
    expect(session.time).toBe(0);
    expect([...session.committee.flags]).toEqual(['class']);
    expect(session.log.filter((l) => l.kind === 'signal').map((l) => [l.t, l.text])).toEqual([[0, 'One minute: class flag up (long sound)']]);
  });
});
