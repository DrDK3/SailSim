/**
 * The debrief after every sail (review, 10 Nov 2026): the boat's track once a second for the whole run, and what it
 * shows. Tacks and gybes are found where the mainsail changes side, and each is costed as sailing coaches do: the
 * ground made good towards (or away from) the wind over the manoeuvre, against what she was making before it,
 * converted to seconds. In a race, the start: how late she crossed after the gun, how far from the line she was at
 * the gun, and how fast. Pure logic; the controller records the track and the panel draws it.
 *
 * The windows and thresholds are the simulator's choices for a 5.8 m keelboat (E), not a published standard.
 */

export interface TrackPoint {
  t: number;
  n: number;
  e: number;
  /** Speed over the ground (m/s). */
  sog: number;
  /** Velocity made good towards the true wind (m/s; negative sailing away from it). */
  vmg: number;
  /** True wind angle, 0–180°. */
  twaDeg: number;
  /** +1 main to port (starboard tack), −1 to starboard. */
  mainSide: number;
}

/** Once a second for up to six hours. */
export const TRACK_EVERY_S = 1;
const TRACK_CAP = 6 * 3600;

export class SailTrack {
  readonly points: TrackPoint[] = [];
  add(p: TrackPoint): void {
    if (this.points.length >= TRACK_CAP) this.points.shift();
    this.points.push(p);
  }
  clear(): void {
    this.points.length = 0;
  }
}

export interface Manoeuvre {
  kind: 'tack' | 'gybe';
  t: number;
  n: number;
  e: number;
  /** Ground lost against the speed before it (m) and as time at that speed (s); undefined when it cannot be costed. */
  lossM?: number;
  lossS?: number;
}

/** Costing windows (s, E): the speed before is the mean from 20 s to 5 s before; the manoeuvre runs from 5 s before to 15 s after. */
export const BEFORE_S: [number, number] = [-20, -5];
export const DURING_S: [number, number] = [-5, 15];
/** Too slow to cost against (m/s): about 0.6 kn made good. */
const MIN_BASELINE = 0.3;
/** Two side changes closer than this are one wobble, not two manoeuvres (s). */
const DEBOUNCE_S = 8;

/** The tacks and gybes in a track, each costed where the track allows. */
export function findManoeuvres(points: readonly TrackPoint[]): Manoeuvre[] {
  const out: Manoeuvre[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.mainSide === b.mainSide || a.mainSide === 0 || b.mainSide === 0) continue;
    const prev = out[out.length - 1];
    if (prev && b.t - prev.t < DEBOUNCE_S) {
      // Back where she was: the wobble cancels out.
      out.pop();
      continue;
    }
    const kind = Math.min(a.twaDeg, b.twaDeg) < 90 ? 'tack' : 'gybe';
    out.push({ kind, t: b.t, n: b.n, e: b.e, ...cost(points, b.t, kind) });
  }
  return out;
}

function cost(points: readonly TrackPoint[], t: number, kind: 'tack' | 'gybe'): { lossM?: number; lossS?: number } {
  const sign = kind === 'tack' ? 1 : -1;
  const before = points.filter((p) => p.t >= t + BEFORE_S[0] && p.t < t + BEFORE_S[1]);
  const during = points.filter((p) => p.t >= t + DURING_S[0] && p.t < t + DURING_S[1]);
  const span = DURING_S[1] - DURING_S[0];
  if (before.length < 5 || during.length < span * 0.8 / TRACK_EVERY_S) return {};
  const base = before.reduce((s, p) => s + sign * p.vmg, 0) / before.length;
  if (base < MIN_BASELINE) return {};
  const made = during.reduce((s, p) => s + sign * p.vmg, 0) * TRACK_EVERY_S;
  const lossM = base * span - made;
  return { lossM, lossS: lossM / base };
}

export interface StartInfo {
  /** The gun (s of the run) and the line's ends. */
  gunT: number;
  line: [{ n: number; e: number }, { n: number; e: number }];
  /** When she started (crossed correctly), if she did. */
  startedT?: number;
  /** Over the line at the gun (an individual recall). */
  ocs: boolean;
}

export interface SailSummary {
  durationS: number;
  distanceM: number;
  meanSogKn: number;
  maxSogKn: number;
  /** The best 30 s of progress to windward (kn), if she sailed upwind. */
  bestUpwindVmgKn?: number;
  tacks: { count: number; meanLossS?: number; worstLossS?: number };
  gybes: { count: number; meanLossS?: number; worstLossS?: number };
  manoeuvres: Manoeuvre[];
  start?: { lateS?: number; distToLineAtGunM?: number; sogAtGunKn?: number; ocs: boolean };
}

const KN = 0.514444;

/** Distance from p to the segment ab (m). */
export function segmentDistance(p: { n: number; e: number }, a: { n: number; e: number }, b: { n: number; e: number }): number {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  const l2 = dn * dn + de * de || 1;
  const u = Math.max(0, Math.min(1, ((p.n - a.n) * dn + (p.e - a.e) * de) / l2));
  return Math.hypot(p.n - (a.n + dn * u), p.e - (a.e + de * u));
}

export function summarise(points: readonly TrackPoint[], start?: StartInfo): SailSummary {
  const manoeuvres = findManoeuvres(points);
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += Math.hypot(points[i]!.n - points[i - 1]!.n, points[i]!.e - points[i - 1]!.e);
  const durationS = points.length ? points[points.length - 1]!.t - points[0]!.t : 0;
  const sogs = points.map((p) => p.sog);
  // The best 30 s to windward, sailing upwind (TWA under 90°).
  let best: number | undefined;
  for (let i = 0; i + 30 <= points.length; i++) {
    const w = points.slice(i, i + 30);
    if (w.some((p) => p.twaDeg >= 90)) continue;
    const m = w.reduce((s, p) => s + p.vmg, 0) / w.length;
    if (best === undefined || m > best) best = m;
  }
  const group = (kind: 'tack' | 'gybe') => {
    const all = manoeuvres.filter((m) => m.kind === kind);
    const costed = all.map((m) => m.lossS).filter((x): x is number => x !== undefined);
    return {
      count: all.length,
      meanLossS: costed.length ? costed.reduce((s, x) => s + x, 0) / costed.length : undefined,
      worstLossS: costed.length ? Math.max(...costed) : undefined,
    };
  };
  let startOut: SailSummary['start'];
  if (start) {
    const atGun = points.reduce<TrackPoint | undefined>((b, p) => (!b || Math.abs(p.t - start.gunT) < Math.abs(b.t - start.gunT) ? p : b), undefined);
    const near = atGun && Math.abs(atGun.t - start.gunT) <= 2 * TRACK_EVERY_S;
    startOut = {
      lateS: start.startedT !== undefined ? start.startedT - start.gunT : undefined,
      distToLineAtGunM: near ? segmentDistance(atGun, start.line[0], start.line[1]) : undefined,
      sogAtGunKn: near ? atGun.sog / KN : undefined,
      ocs: start.ocs,
    };
  }
  return {
    durationS,
    distanceM,
    meanSogKn: sogs.length ? sogs.reduce((s, x) => s + x, 0) / sogs.length / KN : 0,
    maxSogKn: sogs.length ? Math.max(...sogs) / KN : 0,
    bestUpwindVmgKn: best === undefined ? undefined : best / KN,
    tacks: group('tack'),
    gybes: group('gybe'),
    manoeuvres,
    start: startOut,
  };
}

/**
 * The speed colour for the track: one hue in steps of lightness, muted when slow and bright when fast (the map behind
 * is dark), so it reads in order without telling hues apart; the panel draws it over a dark outline so every step
 * stands out on water and on land. `f` is 0–1 of the run's top speed.
 */
export const SPEED_RAMP = ['#8a4a1c', '#b8621f', '#e0822a', '#f5a84e', '#ffd89a'] as const;
export function speedColour(f: number): string {
  const i = Math.max(0, Math.min(SPEED_RAMP.length - 1, Math.floor(f * SPEED_RAMP.length)));
  return SPEED_RAMP[i]!;
}
