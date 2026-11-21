/**
 * Fixes of 21 Nov 2026, §3.2: the like-for-like bests of the weekly course and today's challenge carry the rules they
 * were sailed under ("weekly:2026-W48:r2"), so times sailed under different rules are never compared. Week 47's course
 * changed mid-week (the RDYC's C1, then the rounding drill) and today's challenge gained the spinnaker on 21 Nov 2026.
 * Bests kept under the old keys stay where they are, are still read, and are shown as "earlier rules".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RULESET, earlierRulesLikeForLike, earlierRulesRace, isLikeForLikeKey, keyBase, loadBests, loadLikeForLike, recordAttempt, recordRaceTime, ruleKey } from '../../src/app/bests';
import { weekOf, weeklyKey, weeklyLongKey } from '../../src/app/weekly';
import { dailyChallenge } from '../../src/app/quickRace';
import { learnSteps } from '../../src/app/learnMap';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
});

const W48 = weekOf(new Date('2026-11-25T12:00:00Z'));

describe('§3.2: bests keyed by the rules they were sailed under', () => {
  it('the weekly course, its long course and today’s challenge are keyed with the ruleset', () => {
    expect(RULESET).toBe('r2');
    expect(weeklyKey(W48)).toBe('weekly:2026-W48:r2');
    expect(weeklyLongKey(W48)).toBe('weekly:2026-W48:long:r2');
    const d = dailyChallenge(new Date('2026-11-21T10:00:00Z'));
    expect(d.key).toBe('challenge:2026-11-21:r2');
    expect(d.options.challenge).toBe(d.key);
    expect(keyBase(d.key)).toBe('challenge:2026-11-21');
    expect(ruleKey('weekly:2026-W48')).toBe(weeklyKey(W48));
    for (const k of [weeklyKey(W48), weeklyLongKey(W48), d.key]) expect(isLikeForLikeKey(k)).toBe(true);
  });

  it('old keys (no ruleset) still load and still take attempts', () => {
    // A best kept before this release, under the old key.
    expect(recordAttempt('weekly:2026-W47', 'Week 47', 330, true).best).toBe(true);
    expect(isLikeForLikeKey('weekly:2026-W47')).toBe(true);
    expect(isLikeForLikeKey('challenge:2026-11-21')).toBe(true);
    expect(loadLikeForLike('weekly:2026-W47')?.independent?.timeS).toBe(330);
  });

  it('a time under the new rules is not compared with one under the old: its own first best, the old one shown apart', () => {
    recordAttempt('weekly:2026-W47', 'Week 47 (C1)', 300, true);
    const now = ruleKey('weekly:2026-W47');
    // Slower than the old best, but the first under these rules: a best, and no "previous" from the old rules.
    expect(recordAttempt(now, 'Week 47', 340, true)).toEqual({ best: true, previousS: undefined });
    expect(loadLikeForLike(now)?.independent?.timeS).toBe(340);
    // The old best is kept, unchanged, and is what "earlier rules" shows.
    expect(loadLikeForLike('weekly:2026-W47')?.independent?.timeS).toBe(300);
    expect(earlierRulesLikeForLike(now)?.independent?.timeS).toBe(300);
    // Another week's best is not "earlier rules" for this one.
    recordAttempt('weekly:2026-W46', 'Week 46', 200, true);
    expect(earlierRulesLikeForLike(ruleKey('weekly:2026-W48'))).toBeUndefined();
  });

  it('today’s challenge: the time before the spinnaker came is shown as earlier rules, not compared', () => {
    recordRaceTime('challenge:2026-11-21', 'Today', 280);
    const d = dailyChallenge(new Date('2026-11-21T15:00:00Z'));
    expect(recordRaceTime(d.key, 'Today', 310)).toEqual({ best: true, previousS: undefined });
    const b = loadBests();
    expect(b.races[d.key]!.timeS).toBe(310);
    expect(earlierRulesRace(b, d.key)?.timeS).toBe(280);
    expect(earlierRulesRace(b, dailyChallenge(new Date('2026-11-22T15:00:00Z')).key)).toBeUndefined();
  });

  it('the Learn map counts a best under earlier rules as done', () => {
    const d = dailyChallenge(new Date('2026-11-21T15:00:00Z'));
    const steps = learnSteps({ lessons: {}, exerciseRuns: [], bests: { races: { 'challenge:2026-11-21': { timeS: 280, at: '', label: '' } } }, dailyKey: d.key, weeklyDone: false, started: [] });
    expect(steps.find((s) => s.id === 'challenge:daily')!.done).toBe(true);
  });
});
