import { describe, expect, it } from 'vitest';
import { vmgShown } from '../../src/ui/format';
import { WIND_BAND_EDGES, windBand, windWords } from '../../src/app/windWords';

const D = Math.PI / 180;

/** Review #18 and #19: plain instrument words at the Learn level; VMG up or down the wind, always positive. */
describe('instrument words', () => {
  it('VMG is "upwind" forward of the beam and "downwind" abaft it, with a positive number', () => {
    expect(vmgShown(2.1, 42 * D)).toMatchObject({ label: 'VMG upwind', kn: 2.1 });
    expect(vmgShown(-3.4, -150 * D)).toMatchObject({ label: 'VMG downwind', kn: 3.4 });
    // In irons, drifting back: not a negative number.
    expect(vmgShown(-0.3, 10 * D).kn).toBe(0);
    for (let twa = -180; twa <= 180; twa += 5) for (const v of [-4, -1, 0, 1, 4]) expect(vmgShown(v, twa * D).kn).toBeGreaterThanOrEqual(0);
  });
  it('where the wind comes from, in words (fixes of 21 Nov 2026, §2.4): a direction, the angle alongside', () => {
    // The brief's examples.
    expect(windWords(170 * D)).toMatchObject({ words: 'from behind, a little to your right', deg: 170 });
    expect(windWords(-40 * D)).toMatchObject({ words: 'from ahead and to your left', deg: 40 });
    // Starboard is your right, port your left.
    expect(windWords(90 * D).words).toBe('from your right side');
    expect(windWords(-135 * D).words).toBe('from behind and to your left');
    expect(windWords(12 * D).words).toBe('from ahead, a little to your right');
    expect(windWords(2 * D).words).toBe('from dead ahead');
    expect(windWords(-178 * D).words).toBe('from dead behind');
    // No degrees symbol or sailors' terms in the words themselves (the number is shown apart, small).
    for (let a = -180; a <= 180; a += 1) expect(windWords(a * D).words).not.toMatch(/°|starboard|port|TWA/);
  });
  it('the bands’ edges (E): ahead < 20°, ahead-side < 70°, across ≤ 110°, behind-side ≤ 160°, behind beyond', () => {
    expect(WIND_BAND_EDGES).toMatchObject({ aheadSide: 20, across: 70, behindSide: 110, behind: 160 });
    const cases: [number, string][] = [
      [0, 'ahead'], [19, 'ahead'], [20, 'ahead-side'], [69, 'ahead-side'], [70, 'across'], [110, 'across'],
      [111, 'behind-side'], [160, 'behind-side'], [161, 'behind'], [180, 'behind'],
    ];
    for (const [d, band] of cases) {
      expect(windBand(d)).toBe(band);
      expect(windBand(-d)).toBe(band);
      expect(windWords(d * D).band).toBe(band);
    }
    // Rounded to whole degrees first: 19.6° is 20°, ahead-side.
    expect(windBand(19.6)).toBe('ahead-side');
  });
});
