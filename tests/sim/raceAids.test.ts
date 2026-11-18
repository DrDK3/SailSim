/**
 * The race's tactical aids (owner, 18 Nov 2026): lifted or headed against the wind's recent mean, and the laylines to
 * the next mark. One definition with the race coach (the mean wind, the leg, the polar's angles). Presentation only.
 */
import { describe, expect, it } from 'vitest';
import { STEADY_SHIFT_DEG, WindTrend, laylines, legKind, shiftCall } from '../../src/app/raceAids';
import { COACH } from '../../src/app/coach';

const DEG = Math.PI / 180;
const polar = { beat: () => ({ twa: 42 * DEG }), run: () => ({ twa: 160 * DEG }) };
const brg = (a: { n: number; e: number }, b: { n: number; e: number }) => ((Math.atan2(b.e - a.e, b.n - a.n) / DEG) + 360) % 360;

describe('the wind against its recent mean', () => {
  it('a steady wind has no shift; a veer reads positive and fades as the mean catches up', () => {
    const w = new WindTrend(COACH.meanWindS);
    expect(w.shiftDeg).toBeUndefined();
    for (let i = 0; i < 120; i++) expect(Math.abs(w.update(0.5, 225 * DEG))).toBeLessThan(1e-9);
    // The wind veers 12° at once: the whole shift at first.
    expect(w.update(0.5, 237 * DEG)).toBeGreaterThan(11.5);
    // After one memory (90 s) about a third of it is left (e⁻¹), after four almost none.
    let s = 0;
    for (let i = 0; i < 180; i++) s = w.update(0.5, 237 * DEG);
    expect(s).toBeGreaterThan(3.5);
    expect(s).toBeLessThan(5.5);
    for (let i = 0; i < 540; i++) s = w.update(0.5, 237 * DEG);
    expect(Math.abs(s)).toBeLessThan(0.3);
    // A back reads negative; through north the short way round.
    const n = new WindTrend(COACH.meanWindS);
    n.update(0, 5 * DEG);
    expect(n.update(0.5, 355 * DEG)).toBeCloseTo(-10, 0);
  });

  it('lifted on starboard is a veer and on port a back; small shifts are steady; off the wind there is no call', () => {
    const stbd = 45 * DEG;
    const port = -45 * DEG;
    expect(shiftCall(8, stbd)).toEqual({ call: 'lifted', deg: 8 });
    expect(shiftCall(-8, stbd)).toEqual({ call: 'headed', deg: 8 });
    expect(shiftCall(8, port)).toEqual({ call: 'headed', deg: 8 });
    expect(shiftCall(-8.4, port)).toEqual({ call: 'lifted', deg: 8 });
    expect(shiftCall(STEADY_SHIFT_DEG - 0.1, stbd)?.call).toBe('steady');
    expect(shiftCall(-(STEADY_SHIFT_DEG - 0.1), port)?.call).toBe('steady');
    expect(shiftCall(10, 100 * DEG)).toBeUndefined();
    expect(shiftCall(10, -150 * DEG)).toBeUndefined();
  });
});

describe('laylines', () => {
  const mark = { n: 1000, e: 0 };
  it('a beat, a reach and a run by how far off the wind the mark lies', () => {
    // Wind from the north.
    expect(legKind({ n: 0, e: 0 }, mark, 0)).toBe('beat');
    expect(legKind({ n: 1000, e: -800 }, mark, 0)).toBe('reach');
    expect(legKind({ n: 2000, e: 100 }, mark, 0)).toBe('run');
  });

  it('on a beat: each line ends at the mark, and sailing the polar\'s angle along it arrives there', () => {
    const l = laylines(mark, { n: 0, e: 0 }, 0, 5, polar)!;
    expect(l.kind).toBe('beat');
    expect(l.twaDeg).toBeCloseTo(42, 9);
    const [s, p] = l.lines;
    expect(s.tack).toBe('starboard');
    expect(p.tack).toBe('port');
    for (const x of l.lines) expect(x.to).toEqual(mark);
    // On starboard a boat heads 42° to the left of the wind's eye (318°), on port 42° to the right (042°).
    expect(brg(s.from, s.to)).toBeCloseTo(318, 6);
    expect(brg(p.from, p.to)).toBeCloseTo(42, 6);
    // So the starboard layline lies to the right of the mark looking upwind (east of it), the port one to the left.
    expect(s.from.e).toBeGreaterThan(mark.e);
    expect(p.from.e).toBeLessThan(mark.e);
    // Both start downwind of the mark and reach past the boat.
    for (const x of l.lines) {
      expect(x.from.n).toBeLessThan(mark.n);
      expect(Math.hypot(x.from.n - mark.n, x.from.e - mark.e)).toBeCloseTo(1300, 6);
    }
  });

  it('follows the wind: a 10° veer swings both lines 10° clockwise', () => {
    const a = laylines(mark, { n: 0, e: 0 }, 0, 5, polar)!;
    const b = laylines(mark, { n: 0, e: 0 }, 10 * DEG, 5, polar)!;
    for (let i = 0; i < 2; i++) expect((brg(b.lines[i]!.from, mark) - brg(a.lines[i]!.from, mark) + 360) % 360).toBeCloseTo(10, 6);
  });

  it('on a run: the lines come down from upwind at the polar\'s downwind angle; none on a reach', () => {
    const l = laylines({ n: 0, e: 0 }, { n: 900, e: 50 }, 0, 5, polar)!;
    expect(l.kind).toBe('run');
    const [s, p] = l.lines;
    // Starboard gybe: heading 160° left of the wind's eye = 200°; port: 160°.
    expect(brg(s.from, s.to)).toBeCloseTo(200, 6);
    expect(brg(p.from, p.to)).toBeCloseTo(160, 6);
    for (const x of l.lines) expect(x.from.n).toBeGreaterThan(0);
    expect(laylines(mark, { n: 1000, e: -800 }, 0, 5, polar)).toBeUndefined();
  });

  it('never shorter than 150 m nor longer than 2.5 km', () => {
    const near = laylines(mark, { n: 990, e: 0 }, 0, 5, polar)!;
    expect(Math.hypot(near.lines[0].from.n - mark.n, near.lines[0].from.e - mark.e)).toBeCloseTo(150, 6);
    const far = laylines(mark, { n: -9000, e: 0 }, 0, 5, polar)!;
    expect(Math.hypot(far.lines[0].from.n - mark.n, far.lines[0].from.e - mark.e)).toBeCloseTo(2500, 6);
  });
});
