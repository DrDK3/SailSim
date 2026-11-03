import { describe, expect, it } from 'vitest';
import { directionWords, ocsGuide } from '../../src/app/ocsGuide';

/** Review UX-6: a boat over the line at the start is told the nearer end and which way it lies. */
describe('over the line at the start: guidance back', () => {
  const ends = [{ n: 0, e: -50, label: 'the committee boat' }, { n: 0, e: 50, label: 'the pin' }] as const;
  it('names the nearer end, its distance, and where it is from the bow', () => {
    // 20 m on the course side (north of the line), nearer the pin, heading north (the pin is behind, to starboard).
    const g = ocsGuide({ n: 20, e: 30, headingRad: 0 }, ends, 10);
    expect(g.end).toBe('the pin');
    expect(g.distanceM).toBeCloseTo(Math.hypot(20, 20), 6);
    expect(g.relDeg).toBeCloseTo(135, 6);
    expect(g.direction).toBe('135° to starboard');
    expect(g.recallFlagDown).toBe(false);
  });
  it('says ahead and astern, and port for negative angles', () => {
    expect(directionWords(5)).toBe('ahead');
    expect(directionWords(-175)).toBe('astern');
    expect(directionWords(-42)).toBe('40° to port');
  });
  it('notes when flag X is down (four minutes after the start, rule 29.1)', () => {
    expect(ocsGuide({ n: 20, e: -40, headingRad: Math.PI }, ends, 241).recallFlagDown).toBe(true);
  });
});
