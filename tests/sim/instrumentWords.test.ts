import { describe, expect, it } from 'vitest';
import { vmgShown, windFromWords } from '../../src/ui/format';

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
  it('where the wind comes from, in words', () => {
    expect(windFromWords(40 * D)).toBe('40° to starboard');
    expect(windFromWords(-135 * D)).toBe('135° to port');
    expect(windFromWords(1 * D)).toBe('dead ahead');
    expect(windFromWords(-179 * D)).toBe('dead behind');
  });
});
