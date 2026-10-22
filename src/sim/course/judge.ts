import type { ResolvedCourse, ResolvedLeg } from './course';
import { wrapPi } from '../math/angles';
import { angleTo, cross, dist, segmentCrossing } from './geometry';
import type { LocalPoint } from './types';

/**
 * Course judge: start sequence, OCS, start, mark roundings, gates, boundaries and finish, from the boat's
 * pose after every physics step. Pure and deterministic. A simplified reading of the Racing Rules of Sailing
 * (definitions Start, Finish, Sail the Course; rules 28, 29.1), NOT an authoritative adjudication system.
 *
 * Roundings follow the "taut string" idea with winding angles. For each mark leg, W is the angle swept by the
 * bearing from the mark to the boat, measured from the ray towards the previous point (mark, gate middle or
 * start-line middle). Leaving the mark to port means going anticlockwise round it, from the previous ray to the
 * ray towards the next point: a sweep of α = CCW angle(prev ray → next ray); to starboard, −(2π − α).
 *   - The rounding is credited halfway round on the required side (W = sweep/2): for a windward mark that is
 *     the moment the boat passes upwind of it. If the boat then goes back round (W falls back by π) before
 *     completing the next leg, the rounding is undone.
 *   - Going round the wrong way (a sweep the other way, at least a quarter turn) gives a "wrong side" warning;
 *     the mark is still to be rounded, and unwinding and going round correctly counts (rule 28 allows a boat
 *     to correct errors).
 *   - Extra full turns after a correct rounding are reported but allowed (World Sailing Case 90, as
 *     summarised by secondary sources).
 * Gates count when the track crosses between the gate marks from the previous mark's side.
 *
 * Lines use hull reference points (bow, stern, both sides at the widest point): a boat is OCS if any point is
 * on the course side of the starting line or its extension at the starting signal; she starts when, having
 * been entirely on the pre-start side at or after the signal, any point crosses the line towards the first
 * mark; she finishes when any point crosses the finishing line from the course side after sailing the course.
 * Crossing times are interpolated linearly within the 10 ms step.
 */
export interface BoatPose {
  n: number;
  e: number;
  /** Compass heading (rad). */
  heading: number;
}

export interface HullPoint {
  /** Body frame: x forward, y starboard (m). */
  x: number;
  y: number;
  name: string;
}

export interface StartSignal {
  name: 'warning' | 'preparatory' | 'one-minute' | 'start';
  t: number;
}

export function startSequence(startTime: number, kind: 'five-minute' | 'three-minute' | 'one-minute'): StartSignal[] {
  if (kind === 'five-minute') return [{ name: 'warning', t: startTime - 300 }, { name: 'preparatory', t: startTime - 240 }, { name: 'one-minute', t: startTime - 60 }, { name: 'start', t: startTime }];
  if (kind === 'three-minute') return [{ name: 'warning', t: startTime - 180 }, { name: 'preparatory', t: startTime - 120 }, { name: 'one-minute', t: startTime - 60 }, { name: 'start', t: startTime }];
  return [{ name: 'one-minute', t: startTime - 60 }, { name: 'start', t: startTime }];
}

export type RaceEvent =
  | { t: number; type: 'signal'; name: StartSignal['name'] }
  | { t: number; type: 'ocs' }
  | { t: number; type: 'ocs-cleared' }
  | { t: number; type: 'start'; time: number }
  | { t: number; type: 'rounded'; leg: number; label: string; time: number }
  | { t: number; type: 'gate'; leg: number; label: string; time: number }
  | { t: number; type: 'wrong-side'; leg: number; label: string }
  | { t: number; type: 'extra-loop'; leg: number; label: string }
  | { t: number; type: 'rounding-undone'; leg: number; label: string }
  | { t: number; type: 'out-of-order'; leg: number; label: string }
  | { t: number; type: 'boundary'; label: string; time: number }
  | { t: number; type: 'finish-incomplete'; remaining: number }
  | { t: number; type: 'finish'; time: number };

export type RacePhase = 'pre-start' | 'racing' | 'finished';

interface Winding {
  leg: ResolvedLeg;
  w: number;
  last: number;
  /** W at which the rounding is credited (halfway round on the required side), and the direction (+1 = CCW). */
  target: number;
  sign: 1 | -1;
  /** W at which going round the wrong way is reported. */
  wrongTarget: number;
  wrongArmed: boolean;
}

const TWO_PI = 2 * Math.PI;
/** Sweeps smaller than this (rad, ≈ 6°) mean the course doubles back at the mark: count a full turn. */
export const TURNAROUND = 0.1;

function makeWinding(leg: ResolvedLeg, boat: LocalPoint): Winding {
  const m = leg.target;
  const thP = angleTo(m, leg.prev);
  const thN = angleTo(m, leg.next);
  const alpha = ((thN - thP) % TWO_PI + TWO_PI) % TWO_PI; // CCW from the previous ray to the next ray
  const sign: 1 | -1 = leg.rounding === 'port' ? 1 : -1;
  let sweep = sign > 0 ? alpha : alpha - TWO_PI;
  // Next point (almost) straight back the way the boat came, as at a windward–leeward mark: a full turn.
  if (Math.abs(sweep) < TURNAROUND) sweep += sign * TWO_PI;
  // The wrong way round: small sweeps are indistinguishable from approach and tacking, so count a full turn more.
  let wrongSweep = sweep - sign * TWO_PI;
  if (Math.abs(wrongSweep) < Math.PI / 2) wrongSweep -= sign * TWO_PI;
  const wrongTarget = Math.abs(wrongSweep) >= Math.PI ? wrongSweep / 2 : wrongSweep;
  const a = angleTo(m, boat);
  return { leg, w: wrapPi(a - thP), last: a, target: sweep / 2, sign, wrongTarget, wrongArmed: true };
}

/** Advance a winding to the boat's new position; returns the fraction of the step at which `level` was crossed. */
function advance(wd: Winding, boat: LocalPoint): { prev: number; now: number } {
  const m = wd.leg.target;
  const prev = wd.w;
  if (dist(m, boat) > 1e-6) {
    const a = angleTo(m, boat);
    wd.w += wrapPi(a - wd.last);
    wd.last = a;
  }
  return { prev, now: wd.w };
}

/** Has W reached `level` in direction `sign`? (Level test, so a boat already past it at activation counts.) */
const reached = (now: number, level: number, sign: number) => (sign > 0 ? now >= level : now <= level);
/** Fraction of the step at which W reached the level (0 if it was already there). */
const frac = (prev: number, now: number, level: number, sign: number) => (reached(prev, level, sign) || now === prev ? 0 : (level - prev) / (now - prev));

export interface JudgeState {
  phase: RacePhase;
  ocs: boolean;
  /** True once the boat may start (entirely on the pre-start side at or after the signal). */
  mayStart: boolean;
  legIndex: number;
  legCount: number;
  startTime?: number;
  finishTime?: number;
  nextSignal?: StartSignal;
  startSignalTime: number;
  events: RaceEvent[];
}

export class CourseJudge {
  readonly events: RaceEvent[] = [];
  phase: RacePhase = 'pre-start';
  ocs = false;
  mayStart = false;
  legIndex = 0;
  startTime?: number;
  finishTime?: number;
  private prevT?: number;
  private prevPose?: BoatPose;
  private prevPts?: LocalPoint[];
  private signalIdx = 0;
  private active?: Winding;
  private lastRounded?: Winding & { extraTarget: number };
  private finishArmed = true;
  private future: Winding[] = [];
  private readonly startSide: number;
  private readonly finishSide: number;

  constructor(readonly course: ResolvedCourse, readonly hull: HullPoint[], readonly signals: StartSignal[]) {
    const [a, b] = course.start;
    this.startSide = Math.sign(cross(a, b, course.legs[0]!.target));
    const last = course.legs[course.legs.length - 1]!;
    this.finishSide = Math.sign(cross(course.finish[0], course.finish[1], last.target));
  }

  get startSignalTime(): number {
    return this.signals.find((s) => s.name === 'start')!.t;
  }

  hullPoints(p: BoatPose): LocalPoint[] {
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    return this.hull.map((h) => ({ n: p.n + h.x * c - h.y * s, e: p.e + h.x * s + h.y * c }));
  }

  /** Call after every physics step with the simulation time and the boat's pose at that time. */
  update(t: number, pose: BoatPose): RaceEvent[] {
    const out: RaceEvent[] = [];
    const emit = (e: RaceEvent) => {
      out.push(e);
      this.events.push(e);
    };
    const pts = this.hullPoints(pose);
    const boat = { n: pose.n, e: pose.e };
    const t0 = this.prevT;
    const prevPts = this.prevPts;
    const prevBoat = this.prevPose ? { n: this.prevPose.n, e: this.prevPose.e } : undefined;
    const at = (s: number) => (t0 === undefined ? t : t0 + s * (t - t0));

    // Signals (the start signal falls exactly on a step: the pose is the one at the signal).
    while (this.signalIdx < this.signals.length && t >= this.signals[this.signalIdx]!.t) {
      const sig = this.signals[this.signalIdx++]!;
      emit({ t, type: 'signal', name: sig.name });
      if (sig.name === 'start') {
        const [a, b] = this.course.start;
        this.ocs = pts.some((q) => cross(a, b, q) * this.startSide > 0);
        if (this.ocs) emit({ t, type: 'ocs' });
        else this.mayStart = true;
      }
    }

    if (this.phase === 'pre-start' && t >= this.startSignalTime) {
      const [a, b] = this.course.start;
      if (this.ocs && pts.every((q) => cross(a, b, q) * this.startSide < 0)) {
        this.ocs = false;
        this.mayStart = true;
        emit({ t, type: 'ocs-cleared' });
      } else if (this.mayStart && prevPts && t0 !== undefined && t0 >= this.startSignalTime - 1e-9) {
        // Earliest hull point to cross the line segment from the pre-start side.
        let best = Infinity;
        prevPts.forEach((p0, i) => {
          const p1 = pts[i]!;
          if (cross(a, b, p0) * this.startSide <= 0 && cross(a, b, p1) * this.startSide > 0) {
            const s = segmentCrossing(p0, p1, a, b);
            if (s !== null) best = Math.min(best, s);
          }
        });
        if (best <= 1) {
          this.startTime = at(best);
          this.phase = 'racing';
          emit({ t, type: 'start', time: this.startTime });
          this.activate(boat);
        }
      }
    } else if (this.phase === 'racing' && prevBoat && t0 !== undefined) {
      this.racingStep(t, t0, boat, prevBoat, pts, prevPts!, emit);
    }

    this.prevT = t;
    this.prevPose = pose;
    this.prevPts = pts;
    return out;
  }

  private activate(boat: LocalPoint): void {
    const leg = this.course.legs[this.legIndex];
    this.active = leg?.leg.type === 'mark' ? makeWinding(leg, boat) : undefined;
    // Watch the following mark legs of this lap for roundings out of order.
    this.future = [];
    if (leg) {
      for (let j = this.legIndex + 1; j < this.course.legs.length; j++) {
        const lj = this.course.legs[j]!;
        if (lj.lap !== leg.lap) break;
        if (lj.leg.type === 'mark') this.future.push(makeWinding(lj, boat));
      }
    }
  }

  private racingStep(t: number, t0: number, boat: LocalPoint, prevBoat: LocalPoint, pts: LocalPoint[], prevPts: LocalPoint[], emit: (e: RaceEvent) => void): void {
    const at = (s: number) => t0 + s * (t - t0);
    // Boundaries (either direction).
    for (const b of this.course.boundaries) {
      const s = segmentCrossing(prevBoat, boat, b.a, b.b);
      if (s !== null) emit({ t, type: 'boundary', label: b.label, time: at(s) });
    }
    // The mark just rounded: extra loops are reported; going back round undoes the rounding.
    if (this.lastRounded) {
      const lr = this.lastRounded;
      const { now } = advance(lr, boat);
      if (reached(now, lr.extraTarget, lr.sign)) {
        emit({ t, type: 'extra-loop', leg: lr.leg.index, label: lr.leg.label });
        lr.extraTarget += lr.sign * TWO_PI;
      } else if (reached(now, lr.target - lr.sign * Math.PI, -lr.sign)) {
        emit({ t, type: 'rounding-undone', leg: lr.leg.index, label: lr.leg.label });
        this.legIndex = lr.leg.index;
        this.active = lr;
        this.lastRounded = undefined;
        this.future = [];
      }
    }
    for (const f of this.future) {
      const { prev, now } = advance(f, boat);
      if (!reached(prev, f.target, f.sign) && reached(now, f.target, f.sign)) {
        emit({ t, type: 'out-of-order', leg: f.leg.index, label: f.leg.label });
      }
    }
    const leg = this.course.legs[this.legIndex];
    if (leg) {
      let done: number | null = null;
      if (leg.leg.type === 'mark' && this.active) {
        const wd = this.active;
        const { prev, now } = advance(wd, boat);
        if (reached(now, wd.target, wd.sign)) {
          done = frac(prev, now, wd.target, wd.sign);
        } else if (wd.wrongArmed && reached(now, wd.wrongTarget, -wd.sign)) {
          wd.wrongArmed = false;
          emit({ t, type: 'wrong-side', leg: leg.index, label: leg.label });
        } else if (!wd.wrongArmed && reached(now, wd.wrongTarget + wd.sign * (Math.PI / 2), wd.sign)) {
          wd.wrongArmed = true; // unwound: warn again if the boat goes the wrong way round again
        }
        if (done !== null) {
          emit({ t, type: 'rounded', leg: leg.index, label: leg.label, time: at(done) });
          this.lastRounded = { ...wd, extraTarget: wd.target + wd.sign * TWO_PI };
        }
      } else if (leg.leg.type === 'gate') {
        const [a, b] = leg.points as [LocalPoint, LocalPoint];
        const side = Math.sign(cross(a, b, leg.prev));
        if (cross(a, b, prevBoat) * side > 0 && cross(a, b, boat) * side <= 0) {
          const s = segmentCrossing(prevBoat, boat, a, b);
          if (s !== null) {
            done = s;
            emit({ t, type: 'gate', leg: leg.index, label: leg.label, time: at(s) });
            this.lastRounded = undefined;
          }
        }
      }
      if (done !== null) {
        this.legIndex++;
        this.activate(boat);
      }
    }
    // Finishing line: any hull point crossing from the course side.
    const [fa, fb] = this.course.finish;
    let best = Infinity;
    prevPts.forEach((p0, i) => {
      const p1 = pts[i]!;
      if (cross(fa, fb, p0) * this.finishSide > 0 && cross(fa, fb, p1) * this.finishSide <= 0) {
        const s = segmentCrossing(p0, p1, fa, fb);
        if (s !== null) best = Math.min(best, s);
      }
    });
    if (best <= 1) {
      if (this.legIndex >= this.course.legs.length) {
        this.finishTime = at(best);
        this.phase = 'finished';
        emit({ t, type: 'finish', time: this.finishTime });
      } else if (this.finishArmed) {
        this.finishArmed = false;
        emit({ t, type: 'finish-incomplete', remaining: this.course.legs.length - this.legIndex });
      }
    } else if (!this.finishArmed && pts.every((q) => cross(fa, fb, q) * this.finishSide > 0)) {
      this.finishArmed = true;
    }
  }

  state(t: number): JudgeState {
    return {
      phase: this.phase,
      ocs: this.ocs,
      mayStart: this.mayStart,
      legIndex: this.legIndex,
      legCount: this.course.legs.length,
      startTime: this.startTime,
      finishTime: this.finishTime,
      nextSignal: this.signals.find((s) => s.t > t),
      startSignalTime: this.startSignalTime,
      events: this.events,
    };
  }
}

/** Hull reference points for a boat of the given length and beam (bow, stern, widest point each side). */
export function hullReferencePoints(loa: number, beam: number): HullPoint[] {
  return [
    { name: 'bow', x: loa / 2, y: 0 },
    { name: 'stern', x: -loa / 2, y: 0 },
    { name: 'port', x: 0, y: -beam / 2 },
    { name: 'starboard', x: 0, y: beam / 2 },
  ];
}
