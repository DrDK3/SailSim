/**
 * Tactical aids for a race (owner, 18 Nov 2026): the wind's shift against its recent mean ("lifted" or "headed"), and
 * the laylines to the next mark. Presentation only: nothing here feeds the physics.
 *
 * One definition each, shared with the race coach (src/app/coach.ts): the mean wind is the coach's (a vector average
 * with a memory), a leg is a beat or a run by the coach's rule, and the laylines use the same model polar's best
 * upwind and downwind angles. All of it is model output and rules of thumb (E): no allowance is made for leeway or
 * for the tidal stream, which move a real layline.
 */

const DEG = Math.PI / 180;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The wind direction's recent mean, as a vector average with a memory of `memoryS` seconds. */
export class WindTrend {
  private mean?: { x: number; y: number };
  private last?: number;

  constructor(readonly memoryS: number) {}

  /**
   * Take the wind direction now (`twd`: where it comes from, rad) `dtS` seconds after the last one. Returns the shift
   * from the mean in degrees: positive veered (clockwise), negative backed.
   */
  update(dtS: number, twd: number): number {
    const k = this.mean ? 1 - Math.exp(-Math.max(0, dtS) / this.memoryS) : 1;
    const wx = Math.sin(twd);
    const wy = Math.cos(twd);
    this.mean = this.mean ? { x: this.mean.x + (wx - this.mean.x) * k, y: this.mean.y + (wy - this.mean.y) * k } : { x: wx, y: wy };
    this.last = wrapPi(twd - Math.atan2(this.mean.x, this.mean.y)) / DEG;
    return this.last;
  }

  /** The last shift (deg), or undefined before the first sample. */
  get shiftDeg(): number | undefined {
    return this.last;
  }

  reset(): void {
    this.mean = undefined;
    this.last = undefined;
  }
}

/** Shifts smaller than this read as steady (deg, E). */
export const STEADY_SHIFT_DEG = 3;
/** Sailing lower than this true wind angle is "upwind" for the lifted/headed call (deg; the coach's figure). */
export const UPWIND_TWA_DEG = 70;

export interface ShiftCall {
  call: 'lifted' | 'headed' | 'steady';
  /** Size of the shift (deg, rounded, never negative). */
  deg: number;
}

/**
 * Lifted or headed, sailing upwind: on starboard (wind over the starboard side, `twaRad` > 0) a veer lets the boat
 * point higher (a lift) and a back makes her bear away (a header); on port the other way round. Undefined when not
 * sailing upwind: off the wind the same shift means something else.
 */
export function shiftCall(shiftDeg: number, twaRad: number): ShiftCall | undefined {
  if (Math.abs(twaRad) >= UPWIND_TWA_DEG * DEG) return undefined;
  const deg = Math.round(Math.abs(shiftDeg));
  if (Math.abs(shiftDeg) < STEADY_SHIFT_DEG) return { call: 'steady', deg };
  const lifted = twaRad > 0 ? shiftDeg > 0 : shiftDeg < 0;
  return { call: lifted ? 'lifted' : 'headed', deg };
}

export type LegKind = 'beat' | 'reach' | 'run';

/** The leg to a mark from where the boat is, by how far off the wind the mark lies (the coach's rule: 60° and 120°). */
export function legKind(boat: { n: number; e: number }, mark: { n: number; e: number }, windFromRad: number): LegKind {
  const off = Math.abs(wrapPi(Math.atan2(mark.e - boat.e, mark.n - boat.n) - windFromRad));
  return off < 60 * DEG ? 'beat' : off > 120 * DEG ? 'run' : 'reach';
}

export interface Layline {
  /** The tack (or gybe) a boat sails along this line on. */
  tack: 'starboard' | 'port';
  /** The far end (where boats come from) and the mark. */
  from: { n: number; e: number };
  to: { n: number; e: number };
}

/** The angles the laylines are drawn at: the model polar's best VMG angles (src/sim/ai/polar.ts). */
export interface LaylinePolar {
  beat(twsMs: number): { twa: number };
  run(twsMs: number): { twa: number };
}

/**
 * The two laylines to a mark: the lines along which a boat sailing the polar's best upwind angle (on a beat) or best
 * downwind angle (on a run) arrives at it, one for each tack. None on a reach: the mark can be sailed straight at.
 * A boat on starboard heads `twa` to the left of where the wind comes from, so her line ends at the mark from the
 * opposite direction; on port, to the right.
 */
export function laylines(
  mark: { n: number; e: number },
  boat: { n: number; e: number },
  windFromRad: number,
  twsMs: number,
  polar: LaylinePolar,
): { kind: 'beat' | 'run'; twaDeg: number; lines: [Layline, Layline] } | undefined {
  const kind = legKind(boat, mark, windFromRad);
  if (kind === 'reach') return undefined;
  const twa = kind === 'beat' ? polar.beat(twsMs).twa : polar.run(twsMs).twa;
  const dist = Math.hypot(mark.n - boat.n, mark.e - boat.e);
  // Long enough to reach past the boat, within reason.
  const len = Math.max(150, Math.min(2500, dist * 1.3));
  const line = (tack: Layline['tack']): Layline => {
    const heading = windFromRad + (tack === 'starboard' ? -twa : twa);
    return { tack, to: { n: mark.n, e: mark.e }, from: { n: mark.n - Math.cos(heading) * len, e: mark.e - Math.sin(heading) * len } };
  };
  return { kind, twaDeg: twa / DEG, lines: [line('starboard'), line('port')] };
}
