/**
 * Fixes of 21 Nov 2026, §2.3: the coach and the laylines did not know the spinnaker. The race coach's downwind "% of
 * target VMG" and the downwind laylines used the AI's table computed without a spinnaker, so with spinnakers on by
 * default in races the downwind percentages were inflated and the layline angles were those of a boat without one.
 * Now a second table (AI_POLAR_SPIN, `npm run ai:polar -- --spin`, model output) is chosen whenever the boat carries
 * the spinnaker: for the coach and the laylines (the user's boat) and for an AI fleet carrying them, except for the
 * weekly targets before the week the change reaches them (never mid-week).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Polar, RUN_TWA_MAX_DEG, crewPolicyPoint, paramsFingerprint } from '../../src/sim/ai/polar';
import { AI_POLAR } from '../../src/sim/ai/polarData';
import { AI_POLAR_SPIN } from '../../src/sim/ai/polarDataSpin';
import { squibParams } from '../../src/sim/boat/squib';
import { withSpinnaker } from '../../src/sim/boat/spinnaker';
import { practiceCourse } from '../../src/sim/index';
import { createRace, practiceLineLength } from '../../src/sim/race/setup';
import { polarFor } from '../../src/sim/race/session';
import { RaceCoach, type BriefingInput, type CoachSample } from '../../src/app/coach';
import { laylines } from '../../src/app/raceAids';
import { SimController, DEFAULT_SCENARIO } from '../../src/app/controller';
import { DEFAULT_QUICK_RACE } from '../../src/app/quickRace';
import { aiSpinPolarFor, weekOf } from '../../src/app/weekly';

const DEG = Math.PI / 180;
const KN = 1852 / 3600;
const SPIN = new Polar(AI_POLAR_SPIN);
const PLAIN = new Polar(AI_POLAR);

describe('the spinnaker table (model output)', () => {
  it('is the boat carrying one, the same as the table without it forward of 90° and above 20 kn, faster aft', () => {
    expect(AI_POLAR_SPIN.paramsHash).toBe(paramsFingerprint(withSpinnaker(squibParams())));
    expect(AI_POLAR_SPIN.spinFromTwaDeg).toBe(90);
    let faster = 0;
    AI_POLAR_SPIN.twsKn.forEach((tws, i) =>
      AI_POLAR_SPIN.twaDeg.forEach((twa, j) => {
        const a = AI_POLAR.stwKn[i]![j]!;
        const b = AI_POLAR_SPIN.stwKn[i]![j]!;
        expect(b).toBeGreaterThanOrEqual(a);
        if (twa < 90 || tws > 20) expect(b).toBe(a);
        if (AI_POLAR_SPIN.spinSet![i]![j]) faster++;
      }),
    );
    expect(faster).toBeGreaterThan(40);
  });

  it('is current: a point sailed again with the spinnaker set gives the table’s speed', () => {
    const i = AI_POLAR_SPIN.twsKn.indexOf(10);
    const j = AI_POLAR_SPIN.twaDeg.indexOf(155);
    expect(AI_POLAR_SPIN.spinSet![i]![j]).toBe(true);
    const p = crewPolicyPoint(withSpinnaker(squibParams()), 10, AI_POLAR_SPIN.twaDeg[j]!, 120, { spin: true });
    expect(Math.abs(p.stwKn - AI_POLAR_SPIN.stwKn[i]![j]!)).toBeLessThan(0.02);
  });

  it('downwind targets: not nearer dead downwind than 175°; the table without a spinnaker keeps its angles (all below)', () => {
    for (const kn of [4, 6, 8, 10, 12, 14, 16, 18, 20]) {
      expect(SPIN.run(kn * KN).twa / DEG).toBeLessThanOrEqual(RUN_TWA_MAX_DEG + 1e-9);
      expect(PLAIN.run(kn * KN).twa / DEG).toBeLessThan(RUN_TWA_MAX_DEG - 1);
      // Upwind the two tables agree (the spinnaker is not set there).
      expect(SPIN.beat(kn * KN).twa).toBe(PLAIN.beat(kn * KN).twa);
    }
    // In light air the spinnaker's best angle is well above a run, without it nearer one.
    expect(SPIN.run(6 * KN).twa / DEG).toBeLessThan(150);
    expect(PLAIN.run(6 * KN).twa / DEG).toBeGreaterThan(160);
  });
});

/** A steady run for two minutes at a polar's best angle and VMG, after the gun; then the coach's downwind line. */
function steadyRunScore(coachPolar: Polar, sailed: Polar, kn = 8): { pct: number; text: string } {
  const input: BriefingInput = { twsKn: kn, twdDeg: 180, gusts: 'steady', line: { a: { n: 0, e: -50 }, b: { n: 0, e: 50 } }, endLabels: ['pin', 'committee boat'], firstMark: { n: 1000, e: 0 }, sequence: 'three-minute', competitors: 0 };
  const c = new RaceCoach(input, coachPolar);
  const run = sailed.run(kn * KN);
  const s = (t: number): CoachSample => ({
    // The polar's downwind VMG is positive (away from the wind); the coach's samples carry it negative.
    t, n: 20, e: 0, stw: run.speed, vmg: -run.vmg, tws: kn * KN, twd: 180 * DEG, twa: run.twa, heel: 5 * DEG, rudderFrac: 0, mainLuff: 0, mainStall: 0,
    autoMain: true, flatten: 0,
    // The next mark is downwind (to the north, the wind from the south): a run.
    race: { phase: t < 1 ? 'pre-start' : 'racing', toStart: 1 - t, ocs: false, mark: { n: 1000, e: 0 }, penaltyOwed: 0 },
  });
  for (let t = 0; t <= 130; t += 0.5) c.update(s(t));
  const item = c.debrief().items.find((i) => i.area === 'Downwind')!;
  return { pct: Number(/made (\d+)% of the target VMG/.exec(item.text)![1]), text: item.text };
}

describe('the coach judges a boat carrying the spinnaker against the spinnaker table', () => {
  it('a steady run at the spinnaker table’s best angle scores 95–105%, and says which table', () => {
    const { pct, text } = steadyRunScore(SPIN, SPIN);
    expect(pct).toBeGreaterThanOrEqual(95);
    expect(pct).toBeLessThanOrEqual(105);
    expect(text).toMatch(/model polar with the spinnaker set, E/);
  });

  it('judged against the table without one (as before), the same run was inflated above 105%', () => {
    const { pct, text } = steadyRunScore(PLAIN, SPIN);
    expect(pct).toBeGreaterThan(105);
    expect(text).toMatch(/model polar without a spinnaker, E/);
  });
});

function race(opts: { spinnaker?: boolean; aiSpinPolar?: boolean; human?: boolean }) {
  const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 225, laps: 1, startLineM: practiceLineLength(3) });
  const params = opts.spinnaker ? withSpinnaker(squibParams()) : squibParams();
  return createRace({
    conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: 10, twdDeg: 225 }, gusts: { preset: 'steady', seed: 1 }, current: { mode: 'none' } },
    course,
    aiCount: 2,
    level: 'good',
    seed: 3,
    spinnaker: opts.spinnaker,
    ...(opts.aiSpinPolar === undefined ? {} : { aiSpinPolar: opts.aiSpinPolar }),
    committee: { startAt: 60, sequence: 'one-minute' },
    ...(opts.human ? { human: { params } } : {}),
  }).session;
}

describe('the race chooses the table by whether the boat carries the spinnaker', () => {
  it('a fleet and a user carrying it: the spinnaker table for both; without: the table without one', () => {
    const s = race({ spinnaker: true, human: true });
    expect(s.polar.data).toBe(AI_POLAR_SPIN);
    expect(s.humanPolar.data).toBe(AI_POLAR_SPIN);
    const p = race({ spinnaker: false, human: true });
    expect(p.polar.data).toBe(AI_POLAR);
    expect(p.humanPolar.data).toBe(AI_POLAR);
    expect(polarFor(squibParams()).data).toBe(AI_POLAR);
    expect(polarFor(withSpinnaker(squibParams())).data).toBe(AI_POLAR_SPIN);
  });

  it('the weekly targets before the change’s week: the fleet carries the spinnaker but sails by the table without one', () => {
    expect(race({ spinnaker: true, aiSpinPolar: false }).polar.data).toBe(AI_POLAR);
    // The change reaches the targets at a week's start (Monday 30 Nov 2026, 2026-W49), never mid-week.
    expect(aiSpinPolarFor(weekOf(new Date('2026-11-29T23:00:00Z')))).toBe(false);
    expect(aiSpinPolarFor(weekOf(new Date('2026-11-30T09:00:00Z')))).toBe(true);
    expect(aiSpinPolarFor(weekOf(new Date('2026-11-25T12:00:00Z')))).toBe(false);
  });

  it('the laylines on a run are drawn at the spinnaker angle when the boat carries one', () => {
    const mark = { n: 0, e: 0 };
    const boat = { n: -500, e: 0 };
    // Wind from the south (180°) and the mark to the north: a run.
    const withIt = laylines(mark, boat, Math.PI, 6 * KN, SPIN)!;
    const without = laylines(mark, boat, Math.PI, 6 * KN, PLAIN)!;
    expect(withIt.kind).toBe('run');
    expect(withIt.twaDeg).toBeCloseTo(SPIN.run(6 * KN).twa / DEG, 6);
    expect(Math.abs(withIt.twaDeg - without.twaDeg)).toBeGreaterThan(10);
  });
});

describe('in the app: the coach and the laylines of a race with the spinnaker aboard use the spinnaker table', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  });

  it('a quick race with spinnakers: the coach’s polar is the spinnaker table', () => {
    const c = new SimController();
    c.restart({ ...structuredClone(DEFAULT_SCENARIO), spinnaker: true });
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 1, conditions: 'as-set', spinnaker: true })).toBeDefined();
    const session = c.race!.session;
    expect(session.humanPolar.data).toBe(AI_POLAR_SPIN);
    expect((c as unknown as { coach: { polar: Polar } }).coach.polar).toBe(session.humanPolar);
  });

  it('a quick race without them: the table without one', () => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 1, conditions: 'as-set', spinnaker: false })).toBeDefined();
    expect((c as unknown as { coach: { polar: Polar } }).coach.polar.data).toBe(AI_POLAR);
  });
});

describe('the AI uses the spinnaker table only while it can fly the spinnaker', () => {
  const Pof = (session: ReturnType<typeof race>) =>
    [...session.skippers.values()].map((sk) => (sk as unknown as { polarNow(w: number): Polar }).polarNow(8 * KN).data);

  it('before the start the table without it (the spinnaker is never hoisted then); racing, the spinnaker table', () => {
    const s = race({ spinnaker: true });
    expect(s.plainPolar.data).toBe(AI_POLAR);
    expect(Pof(s).every((d) => d === AI_POLAR)).toBe(true);
    s.advance(s.committee.startTime + 20 - s.time);
    const racing = [...s.skippers.keys()].filter((id) => s.judgeOf(id).phase === 'racing');
    expect(racing.length).toBeGreaterThan(0);
    for (const id of racing) expect((s.skippers.get(id) as unknown as { polarNow(w: number): Polar }).polarNow(8 * KN).data).toBe(AI_POLAR_SPIN);
  });

  it('racing in more wind than the AI hoists it in (20 kn): the table without it', () => {
    const s = race({ spinnaker: true });
    s.advance(s.committee.startTime + 20 - s.time);
    const id = [...s.skippers.keys()].find((x) => s.judgeOf(x).phase === 'racing')!;
    expect((s.skippers.get(id) as unknown as { polarNow(w: number): Polar }).polarNow(22 * KN).data).toBe(AI_POLAR);
  });

  it('a fleet without spinnakers: the table without one, always', () => {
    expect(Pof(race({ spinnaker: false })).every((d) => d === AI_POLAR)).toBe(true);
  });
});

describe('a recorded race re-sails by the table its AI sailed by (old recordings as recorded)', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  });
  const recorded = (spinnaker: boolean) => {
    const c = new SimController();
    expect(c.startQuickRace({ ...DEFAULT_QUICK_RACE, competitors: 2, conditions: 'as-set', spinnaker })).toBeDefined();
    c.advance(3);
    return c.saveRecording('race');
  };

  it('a race with spinnakers says its AI steered by the spinnaker table, and its replay does the same', () => {
    const rec = recorded(true);
    expect(rec.aiSpinPolar).toBe(true);
    const r = new SimController();
    expect(r.startReplay(rec)).toBe(true);
    expect(r.race!.session.polar.data).toBe(AI_POLAR_SPIN);
  });

  it('a recording from before (no flag) replays with the AI on the table without one, as it was sailed', () => {
    const rec = recorded(true);
    delete rec.aiSpinPolar;
    const r = new SimController();
    expect(r.startReplay(rec)).toBe(true);
    expect(r.race!.session.polar.data).toBe(AI_POLAR);
    // The player's own coach still judges a boat carrying the spinnaker by the spinnaker table (it is not the AI).
    expect(r.race!.session.humanPolar.data).toBe(AI_POLAR_SPIN);
  });

  it('a race without spinnakers writes no flag (its recordings are as before)', () => {
    expect(recorded(false).aiSpinPolar).toBeUndefined();
  });
});
