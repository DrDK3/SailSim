/**
 * Fixes of 21 Nov 2026, §3.7: the post-deploy check (tools/post-deploy-check.mjs) looks for this week's targets file
 * by the same week the app and the weekly-targets job use (src/app/weekly.ts), across the year's ends and the clock
 * changes in London; and it checks the repository's own Pages address unless told another.
 */
import { describe, expect, it } from 'vitest';
import { weekOf } from '../../src/app/weekly';
// @ts-expect-error: a plain JavaScript module (run by node without a build), no type declarations.
import { londonIsoWeek, siteUrl } from '../../tools/post-deploy-week.mjs';

describe('the week the post-deploy check looks for', () => {
  it('is the app’s week, every 7 hours through 2026–2028 (year ends, week 53, clock changes)', () => {
    let n = 0;
    for (let t = Date.UTC(2025, 11, 20); t < Date.UTC(2028, 0, 10); t += 7 * 3600e3) {
      const at = new Date(t);
      expect(londonIsoWeek(at), at.toISOString()).toBe(weekOf(at).key);
      n++;
    }
    expect(n).toBeGreaterThan(2500);
  });

  it('turns over at midnight in London, not UTC: Sunday 23:30 BST is still the old week', () => {
    // Monday 1 June 2026 00:00 BST is Sunday 31 May 23:00 UTC.
    expect(londonIsoWeek(new Date('2026-05-31T22:30:00Z'))).toBe('2026-W22');
    expect(londonIsoWeek(new Date('2026-05-31T23:30:00Z'))).toBe('2026-W23');
    // In winter London is on UTC: Monday 30 November 2026 starts at 00:00 UTC.
    expect(londonIsoWeek(new Date('2026-11-29T23:59:00Z'))).toBe('2026-W48');
    expect(londonIsoWeek(new Date('2026-11-30T00:00:00Z'))).toBe('2026-W49');
  });
});

describe('the address it checks', () => {
  it('SITE_URL when set (a slash added), else the repository’s GitHub Pages address', () => {
    expect(siteUrl({ SITE_URL: 'https://example.org/sim' })).toBe('https://example.org/sim/');
    expect(siteUrl({ GITHUB_REPOSITORY: 'DrDK3/SailSim' })).toBe('https://drdk3.github.io/SailSim/');
    expect(() => siteUrl({})).toThrow(/SITE_URL/);
  });
});
