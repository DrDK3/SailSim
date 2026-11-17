import { Simulation, squibParams, type BoatParams } from '../../sim/index';
import { buildConditions, type ConditionsSettings } from '../../sim/env/conditions';
import { autopilotHelm } from '../../sim/control/autopilot';

/**
 * Model demonstrations for the tactical exercise (training slice §8): the same boat, from the same start, in the same
 * scripted wind, sailed by the autopilot with one tactical rule, to the windward mark. Two rules are compared:
 *  - "tack on the header": whenever a shift heads the tack the boat is on, tack (after a reaction time); otherwise
 *    sail to the layline and fetch the mark;
 *  - "hold": ignore the shifts: stay on starboard until the port-tack layline, then tack and fetch the mark.
 * The result says which reached the mark sooner IN THIS MODEL: it is model output (the polar, the leeway and the tack
 * all come from estimated coefficients), not a measurement and not a rule of sailing.
 */

const DEG = Math.PI / 180;
const R2D = 180 / Math.PI;
const KN = 1852 / 3600;

export interface BeatSetup {
  conditions: ConditionsSettings;
  start: { n: number; e: number; headingDeg: number; speedKn: number };
  mark: { n: number; e: number };
  roundingRadiusM: number;
  timeLimitS: number;
  /** The boat (default: the Squib as calibrated); the sensitivity harness passes other multipliers. */
  params?: BoatParams;
  /** The true wind angle the demonstration points at, close-hauled (default 42°, E). */
  pointTwaDeg?: number;
  /** Seconds after the shift begins before the "tack on the header" rule tacks (default 8 s, E). */
  reactS?: number;
}

export type DemoPolicy = 'tack-on-header' | 'hold';

export interface DemoResult {
  policy: DemoPolicy;
  /** Seconds to reach the mark, or undefined within the time limit. */
  timeS?: number;
  /** Every 2 s: [n, e]. */
  track: [number, number][];
  tacks: number[];
}

/** Bearing from a to b (rad, 0 = north, clockwise). */
const bearing = (a: { n: number; e: number }, b: { n: number; e: number }) => Math.atan2(b.e - a.e, b.n - a.n);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The true wind angle the demonstrations point at, close-hauled, unless a set-up says otherwise (E). */
export const DEFAULT_POINT_TWA_DEG = 42;

/** Where the mark lies from the wind's eye, in degrees (> 0: to the right, looking upwind). */
export function markFromWindDeg(here: { n: number; e: number }, mark: { n: number; e: number }, windFromDeg: number): number {
  return (wrap(bearing(here, mark) - (windFromDeg * Math.PI) / 180) * 180) / Math.PI;
}

/** A change of wind direction the "tack on the header" rule responds to: when it begins (s) and its size (° > 0 veers). */
export interface ShiftEvent {
  t: number;
  deg: number;
}

/** The events of a scripted shift: the shift, and its return if it is temporary. */
export function shiftEvents(shift: { atS: number; deg: number; rampS: number; holdS?: number }): ShiftEvent[] {
  const ev: ShiftEvent[] = [{ t: shift.atS, deg: shift.deg }];
  if (shift.holdS !== undefined) ev.push({ t: shift.atS + shift.rampS + shift.holdS, deg: -shift.deg });
  return ev;
}

/** Starboard tack is headed by a backing shift (deg < 0), port tack by a veer (deg > 0). */
const headsTack = (side: 1 | -1, deg: number) => (side === 1 ? deg < 0 : deg > 0);

/** Sail one demonstration, starting on starboard tack (the wind over the starboard side). */
export function sailDemo(setup: BeatSetup, policy: DemoPolicy, events: ShiftEvent[]): DemoResult {
  const { env } = buildConditions(setup.conditions);
  const sim = new Simulation({ params: setup.params ?? squibParams(), env, initial: setup.start, input: { autoMain: true, autoJib: true, autoCrew: true } });
  const point = (setup.pointTwaDeg ?? DEFAULT_POINT_TWA_DEG) * DEG;
  // The course over the ground is lower than the heading by the leeway: fetch only with this margin (E).
  const fetchMargin = 6 * DEG;
  const reactS = setup.reactS ?? 8;
  let side: 1 | -1 = 1;
  let nextEvent = 0;
  const tacks: number[] = [];
  const track: [number, number][] = [];
  let lastTackT = -Infinity;
  const steps = Math.round(setup.timeLimitS * 100);
  for (let i = 0; i < steps; i++) {
    const t = sim.time;
    const here = { n: sim.state.n, e: sim.state.e };
    if (i % 200 === 0) track.push([Math.round(here.n * 10) / 10, Math.round(here.e * 10) / 10]);
    const dist = Math.hypot(setup.mark.n - here.n, setup.mark.e - here.e);
    if (dist < setup.roundingRadiusM) {
      track.push([Math.round(here.n * 10) / 10, Math.round(here.e * 10) / 10]);
      return { policy, timeS: t, track, tacks };
    }
    const w = env.wind(t, here.n, here.e);
    // The wind blows towards (w.n, w.e): it comes from the opposite direction.
    const from = Math.atan2(-w.e, -w.n);
    const toMark = bearing(here, setup.mark);
    // Where the mark lies from the wind's eye (> 0: to the right, looking upwind).
    const rel = wrap(toMark - from);
    // On starboard (side 1) the boat points left of the wind: the mark is fetched when it lies at least
    // (point + margin) to the left; on port, to the right.
    const fetchOther = side === 1 ? rel >= point + fetchMargin : rel <= -(point + fetchMargin);
    const fetchThis = side === 1 ? rel <= -(point + fetchMargin) : rel >= point + fetchMargin;
    const settled = t - lastTackT > 12;
    let tack = false;
    const ev = events[nextEvent];
    if (ev && t >= ev.t + reactS) {
      nextEvent++;
      // Tack on a header (unless the mark can already be fetched on this tack).
      if (policy === 'tack-on-header' && headsTack(side, ev.deg) && !fetchThis) tack = true;
    }
    if (!tack && settled && fetchOther) tack = true;
    if (tack) {
      side = side === 1 ? -1 : 1;
      tacks.push(Math.round(t * 10) / 10);
      lastTackT = t;
    }
    // Close-hauled on this tack, or straight at the mark once it can be fetched.
    const helm =
      fetchThis && t - lastTackT > 6
        ? autopilotHelm(sim, { mode: 'heading', target: toMark + side * 3 * DEG })
        : autopilotHelm(sim, { mode: 'twa', target: side * point });
    sim.setInput({ helm });
    sim.stepOnce();
  }
  return { policy, track, tacks };
}

export interface Comparison {
  tack: DemoResult;
  hold: DemoResult;
  /** The rule that reached the mark sooner in this model (undefined if neither did, or within 1 s). */
  better?: DemoPolicy;
  /** Seconds the better rule gained (positive); undefined when only one reached the mark. */
  marginS?: number;
}

export function compareDemos(setup: BeatSetup, events: ShiftEvent[]): Comparison {
  const tack = sailDemo(setup, 'tack-on-header', events);
  const hold = sailDemo(setup, 'hold', events);
  if (tack.timeS === undefined && hold.timeS === undefined) return { tack, hold };
  // Only one reached the mark: it is the better one, by no measurable margin.
  if (tack.timeS === undefined || hold.timeS === undefined) return { tack, hold, better: tack.timeS !== undefined ? 'tack-on-header' : 'hold' };
  const d = Math.abs(tack.timeS - hold.timeS);
  if (d < 1) return { tack, hold, marginS: d };
  return { tack, hold, better: tack.timeS < hold.timeS ? 'tack-on-header' : 'hold', marginS: d };
}

/** A start on starboard tack, close-hauled-ish, at a location, for the exercise and the harness. */
export function starboardStart(loc: { n: number; e: number }, windFromDeg: number, speedKn = 4): BeatSetup['start'] {
  return { n: loc.n, e: loc.e, headingDeg: (((windFromDeg - 45) % 360) + 360) % 360, speedKn };
}

/** The windward mark: `distM` straight upwind of the start (in the wind before the shift). */
export function markUpwind(loc: { n: number; e: number }, windFromDeg: number, distM: number): { n: number; e: number } {
  return { n: loc.n + Math.cos(windFromDeg * DEG) * distM, e: loc.e + Math.sin(windFromDeg * DEG) * distM };
}

export { KN, R2D };
