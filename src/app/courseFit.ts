/**
 * Fitting a race course into a small north-up map (owner, 18 Nov 2026: "the course drawn on the minimap, which is an
 * almost empty blue square in open water"). Geometry only: which part of the water to show so that the whole course,
 * and the boat, are in view.
 */

export interface MapPoint {
  n: number;
  e: number;
}

/**
 * Widths of water a course map may show (m). Each is four times a round figure, so the scale bar (a quarter of the
 * map's width) carries an exact, plain length: 50 m, 75 m, 100 m … 4 km.
 */
export const COURSE_SPANS = [200, 300, 400, 600, 800, 1000, 1200, 1600, 2000, 2400, 3200, 4000, 4800, 6400, 8000, 12000, 16000] as const;

export interface CourseFit {
  /** Width of water shown across the map (m). */
  span: number;
  /** The point at the map's centre. */
  n: number;
  e: number;
}

/**
 * The view that holds every point of the course, and the boat when she is outside it, in a map `w` by `h` (any unit:
 * only the shape matters), with a margin of `pad` (a fraction of the map) on every side. The smallest width from
 * `COURSE_SPANS` that does it; the largest when none does (the far points then fall off the edges).
 */
export function fitCourse(points: readonly MapPoint[], boat: MapPoint | undefined, view: { w: number; h: number }, pad = 0.1): CourseFit | undefined {
  if (!points.length) return undefined;
  let nMin = Infinity;
  let nMax = -Infinity;
  let eMin = Infinity;
  let eMax = -Infinity;
  for (const p of boat ? [...points, boat] : points) {
    nMin = Math.min(nMin, p.n);
    nMax = Math.max(nMax, p.n);
    eMin = Math.min(eMin, p.e);
    eMax = Math.max(eMax, p.e);
  }
  const room = Math.max(0.2, 1 - 2 * pad);
  const need = Math.max((eMax - eMin) / room, ((nMax - nMin) / room) * (view.w / view.h));
  const span = COURSE_SPANS.find((s) => s >= need) ?? COURSE_SPANS[COURSE_SPANS.length - 1]!;
  return { span, n: (nMin + nMax) / 2, e: (eMin + eMax) / 2 };
}

/** The points a course's map must hold: both lines' ends and every mark. */
export function coursePoints(r: { start: readonly MapPoint[]; finish: readonly MapPoint[]; pos: ReadonlyMap<string, MapPoint> }): MapPoint[] {
  return [...r.start, ...r.finish, ...r.pos.values()];
}

export interface CourseSegment {
  a: MapPoint;
  b: MapPoint;
  /** Every leg along it has been sailed (by the boat whose leg index was given). */
  sailed: boolean;
  /** The leg being sailed now runs along it. */
  current: boolean;
}

/**
 * The course as lines to draw, each once (the laps of a course run over the same water): from the starting line to
 * the first mark, mark to mark, and from the last mark to the finishing line. `legIndex` is the leg being sailed (the
 * number of legs when on the way to the finish, or past it); omit it for a course nobody is sailing.
 */
export function courseSegments(legs: readonly { prev: MapPoint; target: MapPoint; next: MapPoint }[], legIndex?: number): CourseSegment[] {
  const out = new Map<string, CourseSegment>();
  const key = (p: MapPoint) => `${p.n.toFixed(1)},${p.e.toFixed(1)}`;
  const add = (a: MapPoint, b: MapPoint, index: number) => {
    const k = `${key(a)}>${key(b)}`;
    const sailed = legIndex !== undefined && index < legIndex;
    const current = legIndex !== undefined && index === legIndex;
    const had = out.get(k);
    if (had) {
      had.sailed = had.sailed && sailed;
      had.current = had.current || current;
    } else out.set(k, { a, b, sailed, current });
  };
  legs.forEach((l, i) => add(l.prev, l.target, i));
  const last = legs[legs.length - 1];
  if (last) add(last.target, last.next, legs.length);
  return [...out.values()];
}
