import { clamp, smoothstep } from '../math/angles';
import type { ApparentWind, SailForce } from './forces';
import type { BoatParams } from './params';

/**
 * The symmetric spinnaker (package B, review decisions D2 and D3, PH-3). The Squib races with one of 13.5 m² on a
 * pole of 2.14 m, hoisted to 6.49 m at most (data/boats/squib/class-spec.json: area C4, S(p); pole and hoist C16, V).
 *
 * The player calls for it to be hoisted, dropped or gybed; the simulated crew carries each call out as a timed task
 * and trims it (D2). Everything they do acts through what the model already has: the spinnaker's force is one more
 * sail force in the same sums as the main and the jib (drive, side force, the yaw moment about the centre of
 * gravity, the heeling moment), so heel, weather helm and a broach come out of the existing dynamics. Nothing is
 * scripted: a spinnaker collapses because the apparent wind has gone too far forward, too far by the lee or onto the
 * wrong side of the pole, and fills again when it comes back.
 *
 * Every number below except the class figures is an estimate (E): there are no Squib spinnaker data, and the free
 * published coefficient tables (the ORC VPP documentation) could not be read from this environment (docs/SOURCES.md,
 * docs/PHYSICS.md §23). The coefficient table follows the general shape of published VPP spinnaker curves (lift
 * highest on a reach, drag rising to a run), not values read from a source.
 */
export interface SpinParams {
  /** Sail area (m²). */
  area: number;
  /** Centre of effort above the waterline (m). */
  ceHeight: number;
  /** Centre of effort forward of the centre of gravity (m): ahead of the forestay, on the pole. */
  ceX: number;
  /** [apparent wind angle (deg), lift coefficient, drag coefficient], 0…180°, for a set, trimmed spinnaker. */
  table: readonly (readonly [number, number, number])[];
  /** Below this apparent wind angle (deg) it cannot be held full; it is gone by `collapseAwaDeg − collapseWidthDeg`. */
  collapseAwaDeg: number;
  collapseWidthDeg: number;
  /** By the lee beyond this (deg past dead astern, on the pole's side) the main blankets it and it collapses. */
  byLeeCollapseDeg: number;
  /** How fast it fills and how fast it collapses (per second, as a share of full). */
  fillRate: number;
  collapseRate: number;
  /** Flogging, it still drags: this share of the run's drag coefficient (E). */
  flogDrag: number;
  /** The crew's tasks (s): hoist, drop and gybing the pole; each varied by up to ±`taskVary` of itself. */
  hoistS: number;
  dropS: number;
  gybeS: number;
  taskVary: number;
  /** The crew react to a gybe nobody called (auto trim only), after this long (s). */
  reactS: number;
  /** While the pole is being gybed the spinnaker flies on its sheets alone: this share of full. */
  gybeDeployed: number;
  /** The jib behind a full spinnaker: its effectiveness is multiplied by 1 − this (E; how Squibs carry the jib is B6). */
  jibBlanket: number;
  /** Manual trim (Expert): the sheet within this of the best keeps it drawing; beyond, it curls or stalls (E). */
  trimWidth: number;
}

export const SPIN_PARAMS: SpinParams = {
  area: 13.5,
  // The head at the 6.49 m hoist, the luff 4.9 m (class maxima), the mast heel about 0.45 m above the water: the
  // centre of effort about 0.55 of the luff below the head (E).
  ceHeight: 3.6,
  // The pole (2.14 m) runs forward from the mast (0.55 m forward of the centre of gravity, E); the sail's centre a
  // little inside the pole's end, ahead of the forestay (E).
  ceX: 2.6,
  table: [
    [0, 0, 0.05],
    [30, 0, 0.05],
    [45, 0.6, 0.12],
    [60, 1.05, 0.22],
    [75, 1.3, 0.35],
    [90, 1.35, 0.5],
    [105, 1.25, 0.65],
    [120, 1.05, 0.78],
    [135, 0.8, 0.88],
    [150, 0.5, 0.95],
    [165, 0.25, 0.98],
    [180, 0, 1],
  ],
  collapseAwaDeg: 62,
  collapseWidthDeg: 14,
  byLeeCollapseDeg: 12,
  fillRate: 0.8,
  collapseRate: 2.5,
  flogDrag: 0.15,
  hoistS: 9,
  dropS: 7,
  gybeS: 8,
  taskVary: 0.2,
  reactS: 1.5,
  gybeDeployed: 0.35,
  jibBlanket: 0.55,
  trimWidth: 0.18,
};

const cache = new WeakMap<BoatParams, BoatParams>();

/** The boat's parameters with the spinnaker aboard (one object per parameter set, so runs stay bit-reproducible). */
export function withSpinnaker(p: BoatParams): BoatParams {
  if (p.spin) return p;
  let q = cache.get(p);
  if (!q) cache.set(p, (q = { ...p, spin: SPIN_PARAMS }));
  return q;
}

/** What the crew are doing with the spinnaker. */
export type SpinPhase = 'down' | 'hoisting' | 'up' | 'gybing' | 'dropping';

/** The spinnaker's state: part of the boat's state (it is in the replay's hash once the spinnaker has been used). */
export interface SpinState {
  phase: SpinPhase;
  /** Time into the current task (s), and how long it takes this time. */
  t: number;
  dur: number;
  /** How much of the sail is up and set on its pole: 0 bagged … 1 hoisted and set. */
  deployed: number;
  /** How full it is: 0 collapsed or flogging … 1 full. */
  fill: number;
  /** The pole's side: +1 to starboard (the starboard tack), −1 to port. */
  poleSide: 1 | -1;
  /** Calls acted on (hoist/drop, gybe), so a held call is acted on once. */
  gybesDone: number;
  /** A gybe nobody called: the crew react after this long (s); −1 when not waiting. */
  react: number;
}

export function newSpinState(): SpinState {
  return { phase: 'down', t: 0, dur: 0, deployed: 0, fill: 0, poleSide: 1, gybesDone: 0, react: -1 };
}

/** A repeatable variation in −1…1 for a task, from the step it starts on and a salt (no random numbers in the state). */
export function taskVariation(step: number, salt: number): number {
  // Unsigned throughout (an XOR gives a signed 32-bit result in JavaScript).
  let h = (Math.imul(step | 0, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h / 4294967295) * 2 - 1;
}

/** The spinnaker's lift and drag coefficients for a set, trimmed sail at |apparent wind angle| `awa` (rad). */
export function spinCoefficients(sp: SpinParams, awa: number): { cl: number; cd: number } {
  const deg = Math.min(180, Math.abs(awa) * (180 / Math.PI));
  const t = sp.table;
  let i = 1;
  while (i < t.length - 1 && t[i]![0] < deg) i++;
  const a = t[i - 1]!;
  const b = t[i]!;
  const f = b[0] > a[0] ? (deg - a[0]) / (b[0] - a[0]) : 0;
  return { cl: a[1] + (b[1] - a[1]) * f, cd: a[2] + (b[2] - a[2]) * f };
}

/**
 * How full the spinnaker can be held now (0…1), from the apparent wind angle `awa` (rad, > 0 from starboard), the
 * pole's side, and (manual trim only) the sheet against the best for this angle.
 */
export function spinCanFill(sp: SpinParams, awa: number, poleSide: 1 | -1, sheet?: number): number {
  const deg = Math.abs(awa) * (180 / Math.PI);
  // Too far forward: it cannot be held.
  let can = smoothstep(sp.collapseAwaDeg - sp.collapseWidthDeg, sp.collapseAwaDeg, deg);
  // The wind on the pole's side is right (pole to windward). From the other side it is by the lee: past the limit,
  // or with the wind well round on the wrong side, the main blankets it and it falls in.
  const fromPoleSide = Math.sign(awa || 1) === poleSide;
  if (!fromPoleSide) {
    const byLee = 180 - deg;
    can *= 1 - smoothstep(sp.byLeeCollapseDeg * 0.5, sp.byLeeCollapseDeg, byLee);
  }
  if (sheet !== undefined) {
    const off = sheet - bestSpinSheet(awa);
    // Over-eased it curls and collapses; over-trimmed it stalls (it stays full but drives less: spinTrimFactor).
    can *= 1 - smoothstep(sp.trimWidth, sp.trimWidth * 2, off);
  }
  return clamp(can, 0, 1);
}

/** The best spinnaker sheet (0 = pole squared back and sheet in … 1 = eased) for |awa|: eased as the wind goes aft (E). */
export function bestSpinSheet(awa: number): number {
  const deg = Math.abs(awa) * (180 / Math.PI);
  return clamp((deg - 60) / 120, 0, 1) * 0.8 + 0.1;
}

/** Manual trim (Expert): the share of the trimmed force the sail gives at this sheet (1 at the best, E). */
export function spinTrimFactor(sp: SpinParams, awa: number, sheet: number): number {
  const off = sheet - bestSpinSheet(awa);
  return Math.exp(-((off / sp.trimWidth) ** 2));
}

/**
 * The spinnaker's force (written into `out`): lift ⟂ to the apparent wind, drag along it, in the heeled sail plane,
 * times how much is up and how full it is; a flogging sail still drags. `aw` is the apparent wind at the boat,
 * `trim` the share of the trimmed force (1 with the crew trimming).
 */
export function spinForce(sp: SpinParams, aw: ApparentWind, heel: number, rhoAir: number, deployed: number, fill: number, trim: number, out: SailForce): SailForce {
  const cosH = Math.cos(heel);
  const ax = aw.ax;
  const ay = aw.ay * cosH;
  const aws = Math.hypot(ax, ay);
  const ceY = sp.ceHeight * Math.sin(heel);
  out.ceX = sp.ceX;
  out.ceY = ceY;
  out.aws = aws;
  out.boomTorque = 0;
  out.incidence = 0;
  out.stall = 0;
  if (aws < 1e-9 || deployed <= 0) {
    out.x = out.y = out.yPlane = out.n = out.cl = out.cd = 0;
    out.luff = 0;
    out.awa = 0;
    return out;
  }
  const awa = Math.atan2(-ay, -ax);
  const k = spinCoefficients(sp, awa);
  const run = spinCoefficients(sp, Math.PI);
  const cl = k.cl * fill * trim;
  const cd = k.cd * fill * trim + run.cd * sp.flogDrag * (1 - fill);
  const q = 0.5 * rhoAir * aws * aws * sp.area * deployed;
  // Air flows along d; drag along it, lift ⟂ to it on the side that drives the boat forward.
  const dx = ax / aws;
  const dy = ay / aws;
  const s = awa >= 0 ? 1 : -1;
  const lx = -s * dy;
  const ly = s * dx;
  const fx = q * (cl * lx + cd * dx);
  const fyPlane = q * (cl * ly + cd * dy);
  const fy = fyPlane * cosH;
  out.x = fx;
  out.y = fy;
  out.yPlane = fyPlane;
  out.n = sp.ceX * fy - ceY * fx;
  out.cl = cl;
  out.cd = cd;
  out.luff = fill;
  out.awa = awa;
  return out;
}
