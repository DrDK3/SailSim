import { describe, expect, it } from 'vitest';
import { COURSE_SPANS, coursePoints, courseSegments, fitCourse } from '../../src/app/courseFit';

describe('fitting a course into the minimap', () => {
  const view = { w: 220, h: 250 };

  it('picks the smallest width that holds the whole course with its margin, centred on it', () => {
    const pts = [
      { n: 0, e: -40 },
      { n: 0, e: 40 },
      { n: 600, e: 0 },
    ];
    const f = fitCourse(pts, undefined, view)!;
    // 600 m north to south needs 600 / 0.8 = 750 m of height: 660 m of width in a 220 by 250 map.
    expect(f.span).toBe(800);
    expect(f.n).toBe(300);
    expect(f.e).toBe(0);
    // Every point is inside the map, clear of the margin.
    const k = view.w / f.span;
    for (const p of pts) {
      expect(Math.abs((p.e - f.e) * k)).toBeLessThanOrEqual(view.w * 0.4 + 1e-9);
      expect(Math.abs((p.n - f.n) * k)).toBeLessThanOrEqual(view.h * 0.4 + 1e-9);
    }
  });

  it('widens to keep the boat in view when she is outside the course', () => {
    const pts = [
      { n: 0, e: 0 },
      { n: 400, e: 0 },
    ];
    const near = fitCourse(pts, { n: 200, e: 10 }, view)!;
    const far = fitCourse(pts, { n: 200, e: 900 }, view)!;
    expect(far.span).toBeGreaterThan(near.span);
    expect(far.e).toBe(450);
  });

  it('uses only widths whose quarter is a round figure, and the largest when nothing fits', () => {
    for (const s of COURSE_SPANS) expect(Number.isInteger(s / 4)).toBe(true);
    expect(fitCourse([{ n: 0, e: 0 }, { n: 0, e: 90_000 }], undefined, view)!.span).toBe(COURSE_SPANS[COURSE_SPANS.length - 1]);
    expect(fitCourse([], undefined, view)).toBeUndefined();
  });

  it('gathers both lines and every mark', () => {
    const pos = new Map([
      ['a', { n: 1, e: 1 }],
      ['b', { n: 2, e: 2 }],
    ]);
    expect(coursePoints({ start: [{ n: 0, e: 0 }, { n: 0, e: 9 }], finish: [{ n: 5, e: 0 }, { n: 5, e: 9 }], pos })).toHaveLength(6);
  });
});

describe('the course as lines', () => {
  const S = { n: 0, e: 0 };
  const W = { n: 500, e: 0 };
  const L = { n: 50, e: 0 };
  const F = { n: 0, e: 0 };
  // Two laps, windward then leeward, finishing where it started.
  const legs = [
    { prev: S, target: W, next: L },
    { prev: W, target: L, next: W },
    { prev: L, target: W, next: L },
    { prev: W, target: L, next: F },
  ];

  it('draws each stretch of water once, however many laps run over it', () => {
    const segs = courseSegments(legs);
    // start to windward, windward to leeward, leeward to windward, leeward to the finish
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => !s.sailed && !s.current)).toBe(true);
  });

  it('marks the leg being sailed, and a stretch as sailed only when no later lap uses it', () => {
    const segs = courseSegments(legs, 2);
    const find = (a: { n: number }, b: { n: number }) => segs.find((s) => s.a.n === a.n && s.b.n === b.n && s.a !== s.b)!;
    expect(segs.filter((s) => s.current)).toHaveLength(1);
    expect(segs.find((s) => s.current)!.a).toBe(L);
    // start to windward was sailed on leg 0 and is not used again
    expect(segs.find((s) => s.a === S && s.b === W)!.sailed).toBe(true);
    // windward to leeward was sailed on leg 1, and is sailed again on leg 3
    expect(find(W, L).sailed).toBe(false);
    // on the way to the finish: everything but the last stretch is sailed
    const end = courseSegments(legs, 4);
    expect(end.filter((s) => s.current).map((s) => s.b)).toEqual([F]);
    expect(end.filter((s) => !s.sailed)).toHaveLength(1);
  });
});
