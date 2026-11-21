import { describe, expect, it } from 'vitest';
import { weeklyCourse } from '../../src/app/weekly';
import { sailOnce, sailTargets } from '../../src/app/weeklyTargets';
import { TARGET_SPREAD, targetsLine, targetsStatus, trackPoses, type Target } from '../../src/app/targets';
import { SimController } from '../../src/app/controller';
import { loadDartApp } from './helpers';
import type { DartData } from '../../src/app/geoLoader';

/**
 * The weekly targets (juniors round §6.3): the AI sails the week's own course in the week's own conditions, and the
 * app accepts the file only for this week's scenario; missing or stale files are "not available", never an error.
 */
const practiceWeek = weeklyCourse(new Date('2026-11-17T12:00:00Z'), undefined, { '2026-W47': 'practice:windward-leeward' });

describe('weekly targets', () => {
  it('the AI finishes the week’s practice course; the file is for this week and this scenario', () => {
    const f = sailTargets(practiceWeek, {}, { seeds: [1, 2], build: 'test', now: new Date('2026-11-17T02:00:00Z') });
    expect(f.targets.map((t) => t.medal)).toEqual(['bronze', 'silver', 'gold']);
    for (const t of f.targets) {
      expect(t.timeS).toBeGreaterThan(60);
      expect(t.level).toBe('expert');
      expect(t.track.rows.length).toBeGreaterThan(t.timeS / (1 + (t.slowedBy ?? 0)) - 2);
      const poses = trackPoses(t.track);
      expect(poses.length).toBeGreaterThan(t.timeS * 9);
    }
    // Review #11: gold is the expert AI's median; silver and bronze 10% and 25% slower (E, configurable).
    const [bronze, silver, gold] = f.targets as [Target, Target, Target];
    expect(gold.runs.every((r) => r !== null)).toBe(true);
    expect(gold.slowedBy).toBeUndefined();
    expect(silver.slowedBy).toBe(TARGET_SPREAD.silver);
    expect(bronze.slowedBy).toBe(TARGET_SPREAD.bronze);
    expect(silver.timeS).toBeCloseTo(gold.timeS * 1.1, 0);
    expect(bronze.timeS).toBeCloseTo(gold.timeS * 1.25, 0);
    // The silver ghost is the gold ghost slowed after the start: it finishes at the silver time, not before.
    const start = practiceWeek.scenario.race!.startInS;
    expect(silver.track.rows.at(-1)![0]! - start).toBeCloseTo((gold.track.rows.at(-1)![0]! - start) * 1.1, 0);
    expect(silver.track.rows[10]).toEqual(gold.track.rows[10]);
    // Shown in one line, best first.
    expect(targetsLine(f.targets)).toMatch(/^gold \d+:\d\d · silver \d+:\d\d · bronze \d+:\d\d$/);
    expect(targetsLine([{ medal: 'gold', timeS: 400 }, { medal: 'silver', timeS: 440 }, { medal: 'bronze', timeS: 500 }])).toBe('gold 6:40 · silver 7:20 · bronze 8:20');
    // The course is sized for juniors: the good AI's time is recorded as the check (5–10 minutes).
    expect(f.sizing?.timeS).toBeGreaterThanOrEqual(300);
    expect(f.sizing?.timeS).toBeLessThanOrEqual(600);
    expect(f.note).toMatch(/not people/);
    const ok = targetsStatus(JSON.parse(JSON.stringify(f)), '2026-W47', JSON.stringify(practiceWeek.scenario), Date.parse('2026-11-17T03:00:00Z'));
    expect(ok.state).toBe('ok');
    expect(ok.state === 'ok' && ok.ageMin).toBe(60);
    expect(targetsStatus(f, '2026-W48', JSON.stringify(practiceWeek.scenario)).state).toBe('unavailable');
    expect(targetsStatus(f, '2026-W47', '{}').state).toBe('unavailable');
    expect(targetsStatus(undefined, '2026-W47', '{}')).toEqual({ state: 'unavailable', reason: 'not a weekly targets file' });
    expect(targetsStatus({ schema: 'x' }, '2026-W47', '{}').state).toBe('unavailable');
  }, 120_000);

  it('a club week: the AI sails the RDYC course with the River Dart data, as the app would', () => {
    const club = weeklyCourse(new Date('2026-11-17T12:00:00Z'), undefined, { '2026-W47': 'rdyc-2026-c1' });
    const dart = loadDartApp();
    const run = sailOnce(club, 'good', 1, dart, 5400);
    expect(run.timeS, 'finished').not.toBeNull();
    // The player's app builds the same scenario (it starts).
    const c = new SimController();
    c.dartData = { ...dart, issues: [] } as unknown as DartData;
    expect(c.restart(club.scenario)).toBe(true);
    console.log(`club course ${club.name}: good AI ${run.timeS} s`);
  }, 240_000);
});
