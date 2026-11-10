/**
 * Start-line readouts and start drills (review, 10 Nov 2026), as racing instruments show them: the distance to the
 * line, the time to reach it at your present speed, the time to burn before the gun, and which end of the line is
 * favoured by the wind. Then, in a start drill, the start scored: how late you crossed, where on the line, and
 * where you were and how fast at the gun. Pure logic; the controller feeds it and the race panel shows it.
 *
 * Geometry: the course side of the line is the side the first mark is on (as the course judge has it); the
 * pre-start side is the other. Distance and closing speed are measured square to the line. An end is favoured
 * when it lies further upwind (for a start into a beat; further downwind for a start into a run). The thresholds
 * below are the simulator's choices (E), not a published standard.
 */

export interface P {
  n: number;
  e: number;
}

/** The Squib's length overall (m), for "boat lengths". */
export const BOAT_LENGTH_M = 5.8;
/** A line within this many degrees of square to the wind is called square (E). */
export const SQUARE_DEG = 2;
/** Closing or opening slower than this (m/s, about half a knot) is holding position (E). */
export const HOLDING_MS = 0.25;

export interface LineReadout {
  /** Distance to the line (m): positive on the pre-start side, negative over it; to the nearer end beyond the ends. */
  distanceM: number;
  /** Between the ends (seen square to the line). */
  withinEnds: boolean;
  /** Your speed towards the line, square to it, or towards the nearer end beyond the ends (m/s; negative sailing away). */
  closingMs: number;
  /** Time to reach the line at this closing speed (s), when closing from the pre-start side. */
  timeToLineS?: number;
  /** Seconds to the gun less the time to the line: time in hand (positive) or late (negative). */
  burnS?: number;
  motion: 'closing' | 'holding' | 'opening';
}

export interface LineBias {
  /** The favoured end: 0 (the line's first end) or 1, or undefined when the line is square. */
  favoured?: 0 | 1;
  /** How much further upwind (or downwind) the favoured end is (m), and in boat lengths. */
  advantageM: number;
  lengths: number;
  /** The line's angle off square to the wind (degrees, 0 = square). */
  angleDeg: number;
  /** The first leg is upwind (a start into a beat). */
  upwindStart: boolean;
}

const dot = (a: P, b: P) => a.n * b.n + a.e * b.e;
const sub = (a: P, b: P): P => ({ n: a.n - b.n, e: a.e - b.e });

/** The unit normal to the line pointing to the course side (the side of `firstMark`). */
export function courseNormal(line: readonly [P, P], firstMark: P): P {
  const [a, b] = line;
  const d = sub(b, a);
  const len = Math.hypot(d.n, d.e) || 1;
  let nn = -d.e / len;
  let ne = d.n / len;
  if (dot(sub(firstMark, a), { n: nn, e: ne }) < 0) {
    nn = -nn;
    ne = -ne;
  }
  return { n: nn, e: ne };
}

/**
 * Where the boat is against the line. `velocity` is her velocity over the ground (m/s), `toGunS` the seconds to
 * the start signal.
 */
export function lineReadout(line: readonly [P, P], firstMark: P, boat: P, velocity: P, toGunS: number): LineReadout {
  const [a, b] = line;
  const nrm = courseNormal(line, firstMark);
  const d = sub(b, a);
  const len2 = dot(d, d) || 1;
  const u = dot(sub(boat, a), d) / len2;
  const withinEnds = u >= 0 && u <= 1;
  const perp = -dot(sub(boat, a), nrm);
  const near = u < 0 ? a : u > 1 ? b : undefined;
  let distanceM = perp;
  let closingMs = perp >= 0 ? dot(velocity, nrm) : -dot(velocity, nrm);
  if (near) {
    // Beyond an end: the distance to that end, and the speed towards it.
    const to = sub(near, boat);
    const dist = Math.hypot(to.n, to.e) || 1;
    distanceM = Math.sign(perp || 1) * dist;
    closingMs = dot(velocity, { n: to.n / dist, e: to.e / dist });
  }
  const motion = Math.abs(closingMs) < HOLDING_MS ? 'holding' : closingMs > 0 ? 'closing' : 'opening';
  const timeToLineS = perp >= 0 && motion === 'closing' ? Math.abs(distanceM) / closingMs : undefined;
  return { distanceM, withinEnds, closingMs, timeToLineS, burnS: timeToLineS !== undefined ? toGunS - timeToLineS : undefined, motion };
}

/** Which end the wind favours. `windTo` is the true wind's velocity over the ground (where the air goes). */
export function lineBias(line: readonly [P, P], firstMark: P, windTo: P): LineBias {
  const [a, b] = line;
  const w = Math.hypot(windTo.n, windTo.e) || 1;
  const up = { n: -windTo.n / w, e: -windTo.e / w };
  const mid = { n: (a.n + b.n) / 2, e: (a.e + b.e) / 2 };
  const upwindStart = dot(sub(firstMark, mid), up) > 0;
  const d = sub(b, a);
  const len = Math.hypot(d.n, d.e) || 1;
  // How much further upwind end 1 is than end 0.
  const ahead = dot(d, up);
  const angleDeg = (Math.asin(Math.min(1, Math.abs(ahead) / len)) * 180) / Math.PI;
  const advantageM = Math.abs(ahead);
  const favoured = angleDeg < SQUARE_DEG ? undefined : (ahead > 0) === upwindStart ? 1 : 0;
  return { favoured, advantageM, lengths: advantageM / BOAT_LENGTH_M, angleDeg, upwindStart };
}

/**
 * A slowly following wind (vector mean with a time constant), so the line bias does not flicker with every gust
 * and shows the shifts that last. 30 s (E).
 */
export class WindFollower {
  private v?: P;
  constructor(private readonly tauS = 30) {}
  update(windTo: P, dtS: number): P {
    if (!this.v) this.v = { ...windTo };
    else {
      const k = 1 - Math.exp(-dtS / this.tauS);
      this.v = { n: this.v.n + (windTo.n - this.v.n) * k, e: this.v.e + (windTo.e - this.v.e) * k };
    }
    return this.v;
  }
  get value(): P | undefined {
    return this.v;
  }
  reset(): void {
    this.v = undefined;
  }
}

/** One start in a drill, scored. */
export interface DrillStart {
  attempt: number;
  /** Crossed to start this many seconds after the gun (undefined: had not started when scored). */
  lateS?: number;
  /** Over the line at the gun. */
  ocs: boolean;
  /** At the gun: distance to the line (m, positive on the pre-start side) and speed over the ground (kn). */
  atGunM: number;
  atGunKn: number;
  /** Where you crossed: 0 at the line's first end, 1 at the other. */
  crossedAt?: number;
  /** The favoured end at the gun, and whether you started in the favoured third of the line. */
  favoured?: 0 | 1;
  favouredThird?: boolean;
}

/** Where along the line (0 at end 0, 1 at end 1) a point lies, clamped. */
export function alongLine(line: readonly [P, P], p: P): number {
  const [a, b] = line;
  const d = sub(b, a);
  return Math.max(0, Math.min(1, dot(sub(p, a), d) / (dot(d, d) || 1)));
}

/** The drill's verdict in a line: the simulator's own wording (E), not a coaching standard. */
export function drillVerdict(s: DrillStart): string {
  if (s.ocs) return 'Over the line at the gun: come back and start again.';
  if (s.lateS === undefined) return 'Not started yet: cross the line from the pre-start side.';
  const late = s.lateS;
  const timing = late <= 1 ? 'Right on the gun' : late <= 3 ? 'A good start' : late <= 8 ? 'A few seconds late' : 'Late';
  const speed = s.atGunKn >= 3 ? 'at speed' : s.atGunKn >= 1.5 ? 'not yet up to speed' : 'nearly stopped';
  const end = s.favoured === undefined ? '' : s.favouredThird ? ', at the favoured end' : ', away from the favoured end';
  return `${timing}, ${speed} at the gun${end}.`;
}

/**
 * Score a drill start from the boat's positions (at the gun and where she crossed) and the judge's times. `velocity`
 * is her velocity over the ground at the gun.
 */
export function scoreStart(o: {
  attempt: number;
  line: readonly [P, P];
  firstMark: P;
  gunT: number;
  startedT?: number;
  ocs: boolean;
  atGun: P;
  velocityAtGun: P;
  crossed?: P;
  bias: LineBias;
}): DrillStart {
  const r = lineReadout(o.line, o.firstMark, o.atGun, o.velocityAtGun, 0);
  const crossedAt = o.crossed ? alongLine(o.line, o.crossed) : undefined;
  const favouredThird = crossedAt === undefined || o.bias.favoured === undefined ? undefined : o.bias.favoured === 0 ? crossedAt <= 1 / 3 : crossedAt >= 2 / 3;
  return {
    attempt: o.attempt,
    lateS: o.startedT !== undefined ? Math.max(0, o.startedT - o.gunT) : undefined,
    ocs: o.ocs,
    atGunM: r.distanceM,
    atGunKn: Math.hypot(o.velocityAtGun.n, o.velocityAtGun.e) / 0.514444,
    crossedAt,
    favoured: o.bias.favoured,
    favouredThird,
  };
}
