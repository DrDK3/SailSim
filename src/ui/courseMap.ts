import type { ResolvedCourse } from '../sim/course/course';
import { courseSegments } from '../app/courseFit';
import type { Layline } from '../app/raceAids';
import { gateName } from '../app/raceStory';

/**
 * A race course on a north-up canvas map: the minimap during a race and the race from above in the debrief (owner,
 * 18 Nov 2026). The legs as lines with the way round shown by arrowheads (sailed legs fainter, the leg being sailed
 * brighter), both lines, the marks with their names, the next mark ringed, and the laylines to it when the race aids
 * are on. The laylines differ by line style as well as colour: starboard solid green, port dashed red.
 */

export type ToPx = (n: number, e: number) => readonly [number, number];

export interface CourseMapOptions {
  /** The leg being sailed by the boat the map is for (the number of legs when she is on the way to the finish). */
  legIndex?: number;
  /** Ring the next mark (she is racing). */
  ringNext?: boolean;
  /** Write the marks' names and "Start" / "Finish". */
  names?: boolean;
  laylines?: readonly Layline[];
  /**
   * How much larger to draw the words, marks and line widths (default 1): for a canvas shown smaller than its own
   * size (a wide map in a phone's panel), so that they come out at the same size on the screen.
   */
  scale?: number;
}

const LEG = '255,178,102';
const HALO = 'rgba(8,20,28,0.85)';
export const LAYLINE_COLOUR = { starboard: '#5fe08a', port: '#ff6b5e' } as const;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, k = 1): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 3 * k;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff4e6';
  ctx.fillText(text, x, y);
}

export function drawCourse(ctx: CanvasRenderingContext2D, r: ResolvedCourse, toPx: ToPx, o: CourseMapOptions = {}): void {
  const k = o.scale ?? 1;
  ctx.save();
  ctx.lineCap = 'round';
  // The laylines, under the course.
  for (const l of o.laylines ?? []) {
    const [x0, y0] = toPx(l.from.n, l.from.e);
    const [x1, y1] = toPx(l.to.n, l.to.e);
    ctx.strokeStyle = LAYLINE_COLOUR[l.tack];
    ctx.lineWidth = 1.5 * k;
    ctx.setLineDash(l.tack === 'port' ? [5 * k, 4 * k] : []);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // The legs: sailed ones faint, the one being sailed bright, with an arrowhead for the way along each.
  const segs = courseSegments(r.legs, o.legIndex);
  for (const pass of [false, true]) {
    for (const s of segs) {
      if (s.current !== pass) continue;
      const [x0, y0] = toPx(s.a.n, s.a.e);
      const [x1, y1] = toPx(s.b.n, s.b.e);
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) continue;
      ctx.strokeStyle = s.current ? '#ffffff' : `rgba(${LEG},${s.sailed ? 0.32 : 0.92})`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = (s.current ? 2.2 : 1.4) * k;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (len > 28 * k) {
        const ux = (x1 - x0) / len;
        const uy = (y1 - y0) / len;
        const mx = (x0 + x1) / 2 + ux * 4 * k;
        const my = (y0 + y1) / 2 + uy * 4 * k;
        const a = (s.current ? 5 : 4) * k;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - ux * a * 1.8 - uy * a, my - uy * a * 1.8 + ux * a);
        ctx.lineTo(mx - ux * a * 1.8 + uy * a, my - uy * a * 1.8 - ux * a);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // The starting and finishing lines.
  const lines: (typeof r.start)[] = sameLine(r) ? [r.start] : [r.start, r.finish];
  for (const [a, b] of lines) {
    const [x0, y0] = toPx(a.n, a.e);
    const [x1, y1] = toPx(b.n, b.e);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // The marks, and the names of the ones the course goes round.
  ctx.lineWidth = k;
  for (const p of r.pos.values()) {
    const [x, y] = toPx(p.n, p.e);
    ctx.fillStyle = '#ff7a1a';
    ctx.strokeStyle = '#0b1a24';
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (o.names) drawCourseNames(ctx, r, toPx, k);
  // The next mark (or gate), ringed.
  const next = o.legIndex !== undefined ? r.legs[o.legIndex] : undefined;
  if (next && o.ringNext) {
    ctx.strokeStyle = '#5fe08a';
    ctx.lineWidth = 2 * k;
    for (const p of next.points) {
      const [x, y] = toPx(p.n, p.e);
      ctx.beginPath();
      ctx.arc(x, y, 7 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Whether the course starts and finishes on the same line. */
function sameLine(r: ResolvedCourse): boolean {
  const near = (a: { n: number; e: number }, b: { n: number; e: number }) => Math.hypot(a.n - b.n, a.e - b.e) < 1;
  return (near(r.start[0], r.finish[0]) && near(r.start[1], r.finish[1])) || (near(r.start[0], r.finish[1]) && near(r.start[1], r.finish[0]));
}

/**
 * The names on a course: "Start" and "Finish" under their lines, one name over each mark the course goes round and
 * one over a gate. On their own, so that a map can write them over what it draws on top of the course (the tracks of
 * a replay).
 */
export function drawCourseNames(ctx: CanvasRenderingContext2D, r: ResolvedCourse, toPx: ToPx, k = 1): void {
  ctx.save();
  ctx.font = `600 ${10 * k}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines: [typeof r.start, string][] = sameLine(r) ? [[r.start, 'Start · Finish']] : [[r.start, 'Start'], [r.finish, 'Finish']];
  for (const [[a, b], name] of lines) {
    const [x0, y0] = toPx(a.n, a.e);
    const [x1, y1] = toPx(b.n, b.e);
    label(ctx, name, (x0 + x1) / 2, Math.max(y0, y1) + 9 * k, k);
  }
  const named = new Set<string>();
  const names = new Map(r.course.marks.map((m) => [m.id, m.name]));
  for (const l of r.legs) {
    const key = l.leg.type === 'mark' ? l.leg.mark : l.leg.marks.join('+');
    if (named.has(key)) continue;
    named.add(key);
    const name = l.leg.type === 'mark' ? names.get(l.leg.mark) : gateName(names.get(l.leg.marks[0]) ?? '', names.get(l.leg.marks[1]) ?? '');
    if (!name) continue;
    const [x, y] = toPx(l.target.n, l.target.e);
    const top = Math.min(...l.points.map((p) => toPx(p.n, p.e)[1]));
    label(ctx, name.length > 16 ? `${name.slice(0, 15)}…` : name, x, Math.min(y, top) - 10 * k, k);
  }
  ctx.restore();
}
