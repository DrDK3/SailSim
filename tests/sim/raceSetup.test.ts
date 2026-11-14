import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_QUICK_RACE, SHORT_COURSE_LEG_M, dailyChallenge, quickRaceScenario, randomConditions, underTodaysSky } from '../../src/app/quickRace';
import { buildConditions } from '../../src/sim/env/conditions';
import { courseKey, loadBests, recordRaceTime, recordStart } from '../../src/app/bests';
import { DEFAULT_SCENARIO, type DataSource } from '../../src/app/controller';
import { createRace } from '../../src/sim/race/setup';
import { practiceCourse } from '../../src/sim/course/practice';

/** One race set-up (review U4), the short course, today's challenge and personal bests. */

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

describe('race set-up', () => {
  it('offers what the Scenario (now Options) panel used to: any library course, laps, leg length and the preparatory flag', () => {
    const lib = quickRaceScenario({ ...DEFAULT_QUICK_RACE, venue: 'library', libraryId: 'sim-river-range', laps: 3, prepFlag: 'U' }, DEFAULT_SCENARIO);
    expect(lib.scenario.course).toEqual({ source: 'library', id: 'sim-river-range', laps: 3 });
    expect(lib.scenario.fleet?.prepFlag).toBe('U');
    const tri = quickRaceScenario({ ...DEFAULT_QUICK_RACE, course: 'triangle', legM: 400, laps: 1 }, DEFAULT_SCENARIO);
    expect(tri.scenario.course).toEqual({ source: 'practice', kind: 'triangle', legM: 400, laps: 1 });
    const drill = quickRaceScenario({ ...DEFAULT_QUICK_RACE, course: 'rounding-drill' }, DEFAULT_SCENARIO);
    expect(drill.scenario.course).toEqual({ source: 'practice', kind: 'rounding-drill' });
  });

  it('the short course is one beat and one run, always one lap', () => {
    const q = quickRaceScenario({ ...DEFAULT_QUICK_RACE, course: 'short', laps: 4 }, DEFAULT_SCENARIO);
    expect(q.scenario.course).toEqual({ source: 'practice', kind: 'windward-leeward', legM: SHORT_COURSE_LEG_M, laps: 1 });
    expect(q.summary).toMatch(/^Short course/);
  });

  it('AI Squibs sail the short course in about five minutes in a moderate breeze (model output)', () => {
    const times: Record<number, number[]> = {};
    for (const tws of [10, 14]) {
      const course = practiceCourse({ kind: 'windward-leeward', centre: { n: -3500, e: 1200 }, windFromDeg: 225, legM: SHORT_COURSE_LEG_M, laps: 1 });
      const { session } = createRace({
        conditions: { startTime: '2026-07-15T13:00:00Z', weather: { source: 'manual', twsKn: tws, twdDeg: 225 }, gusts: { preset: 'moderate', seed: 3 }, current: { mode: 'none' } },
        course,
        aiCount: 3,
        level: 'good',
        seed: 3,
        committee: { startAt: 90, sequence: 'one-minute', finishWindowS: 300, timeLimitS: 1800 },
      });
      while (!session.finished && session.time < 2400) session.step();
      times[tws] = session.results().filter((r) => r.code === 'FIN' && r.id !== 'you').map((r) => r.elapsed ?? NaN);
    }
    for (const tws of [10, 14]) {
      expect(times[tws]!.length, `${tws} kn`).toBe(3);
      for (const t of times[tws]!) {
        expect(t, `${tws} kn: ${times[tws]!.map(Math.round).join(', ')} s`).toBeGreaterThan(3.5 * 60);
        expect(t, `${tws} kn: ${times[tws]!.map(Math.round).join(', ')} s`).toBeLessThan(6.5 * 60);
      }
    }
  }, 120_000);

  it("today's challenge is the same race all day, for everyone, and a different one tomorrow", () => {
    const a = dailyChallenge(new Date('2026-11-04T08:00:00Z'));
    const b = dailyChallenge(new Date('2026-11-04T22:59:00Z'));
    const c = dailyChallenge(new Date('2026-11-05T08:00:00Z'));
    expect(a).toEqual(b);
    expect(a.key).toBe('challenge:2026-11-04');
    expect(c.options.seed).not.toBe(a.options.seed);
    expect(a.options).toMatchObject({ competitors: 3, course: 'short', conditions: 'random', wind: 'medium', challenge: a.key });
    const s1 = quickRaceScenario(a.options, DEFAULT_SCENARIO);
    const s2 = quickRaceScenario(b.options, DEFAULT_SCENARIO);
    expect(s1.scenario).toEqual(s2.scenario);
  });
});

describe('personal bests (kept in this browser)', () => {
  it('a faster time is a best, a slower one is not; the best start is the shortest delay', () => {
    const k = courseKey('Short course', 1);
    expect(recordRaceTime(k, k, 330)).toEqual({ best: true, previousS: undefined });
    expect(recordRaceTime(k, k, 360)).toEqual({ best: false, previousS: 330 });
    expect(recordRaceTime(k, k, 300)).toEqual({ best: true, previousS: 330 });
    expect(loadBests().races[k]!.timeS).toBe(300);
    expect(recordStart(6).best).toBe(true);
    expect(recordStart(9)).toEqual({ best: false, previousS: 6 });
    expect(loadBests().start!.delayS).toBe(6);
  });
});

describe('today’s sky and light for seeded races (owner review, 5 Nov 2026)', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../public/live/metoffice-replay-2026-10-23T1400Z.json', import.meta.url), 'utf8'));
  const live = { id: 'live', kind: 'live', label: 'Met Office (live)', json: snapshot } as unknown as DataSource;
  const challenge = dailyChallenge(new Date('2026-10-23T12:00:00Z'));

  it('by day, the race starts now under the forecast’s sky; its wind and tide phase are unchanged', () => {
    const now = Date.parse('2026-10-23T14:07:00Z');
    const base = randomConditions(challenge.options.seed, challenge.options.wind, 'start-bay').conditions;
    const t = underTodaysSky(base, live, now);
    expect(t.applied).toBe(true);
    expect(t.conditions.startTime).toBe('2026-10-23T14:07:00Z');
    expect(t.conditions.weather).toEqual(base.weather);
    expect(t.conditions.gusts).toEqual(base.gusts);
    expect(t.conditions.sky).toEqual({ source: 'forecast', snapshot });
    // The high water moved with the start, so the tide's phase is the same.
    const phase = (c: typeof base) => Date.parse((c.tide as { hwTime: string }).hwTime) - Date.parse(c.startTime);
    expect(phase(t.conditions)).toBe(phase(base));
    // The sky is the forecast's (model kind), and the wind exactly as seeded.
    const built = buildConditions(t.conditions);
    expect(built.sky.kind).toBe('model');
    expect(buildConditions(base).env.wind(0, 0, 0)).toEqual(built.env.wind(0, 0, 0));
  });

  it('at night it keeps its seeded afternoon, and without a live forecast nothing changes', () => {
    const base = randomConditions(7, 'medium', 'start-bay').conditions;
    expect(underTodaysSky(base, live, Date.parse('2026-10-23T23:30:00Z'))).toEqual({ conditions: base, applied: false });
    expect(underTodaysSky(base, undefined, Date.parse('2026-10-23T14:00:00Z'))).toEqual({ conditions: base, applied: false });
  });
});
