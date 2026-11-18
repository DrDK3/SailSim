import { describe, expect, it } from 'vitest';
import { weeklyCourse } from '../../src/app/weekly';
import { sailOnce, sailTargets } from '../../src/app/weeklyTargets';
import { targetsStatus, trackPoses } from '../../src/app/targets';
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
      expect(t.runs.every((r) => r !== null)).toBe(true);
      expect(t.track.rows.length).toBeGreaterThan(t.timeS - 2);
      const poses = trackPoses(t.track);
      expect(poses.length).toBeGreaterThan(t.timeS * 9);
    }
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
