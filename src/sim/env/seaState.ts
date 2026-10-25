import { G } from '../units';
import type { NE } from '../boat/forces';

/**
 * Waves: a fetch-limited wind sea, shaped by the tidal stream. This is what makes wind over tide: when the
 * stream runs against the waves they get shorter, higher and steeper, and break. Everything here is a pure
 * function of time and place (base wind, current, water level and land), so the result never depends on who
 * asks first: the physics (spray coming aboard) and the renderer (the water surface) see the same sea.
 *
 * 1. Wind relative to the water (wind minus current) blows over a fetch: open water upwind of the point
 *    until land, by ray-marching the elevation grid at the current water level; plus an estimated open-sea
 *    fetch where the ray leaves the area over water.
 * 2. JONSWAP fetch-limited growth (Hasselmann et al. 1973): g·Hs/U² = 0.0016 (gF/U²)^½ and
 *    g·Tp/U = 0.286 (gF/U²)^⅓, capped at the fully developed sea (g·Hs/U² = 0.243, g·Tp/U = 8.13).
 * 3. Over a current, waves cross the fetch at cg + U along their direction, so they spend longer (against
 *    the stream) or shorter (with it) being driven by the wind: effective fetch F·cg/(cg + Ū), with Ū the
 *    current along the waves averaged over the fetch (a kinematic estimate, not a published formula).
 * 4. From the fetch to the point the current changes from Ū to the local U. The absolute frequency
 *    ω = σ + k·U is conserved, so the waves shorten against a stronger opposing stream; wave action is
 *    conserved, so H² (cg + U)/σ is constant and they grow. If (ω − kU)² = gk·tanh(kh) has no solution the
 *    stream is too strong for them (blocking, |U| ≥ gT/8π in deep water): they break.
 * 5. Limits: steepness Hs/L ≤ 0.1 and depth Hs ≤ 0.55 h (breaking; estimates). Whitecap cover from Monahan and
 *    O'Muircheartaigh (1980), W = 3.84e-6 U^3.41, scaled by the square of the steepening (estimate).
 */
export interface SeaState {
  /** Significant wave height (m). */
  hs: number;
  /** Peak period seen from a fixed point (s). */
  tp: number;
  /** Local wavelength at the peak (m). */
  wavelength: number;
  /** Direction the waves travel towards (rad, compass). */
  dirTo: number;
  /** Hs / wavelength. */
  steepness: number;
  /** Fraction of the surface covered by breaking crests (0 … 1). */
  whitecaps: number;
  /** Current along the waves' direction here (m/s; < 0 = against them). */
  currentAlong: number;
  /** Open water upwind (m). */
  fetch: number;
  /** The same wind and fetch with no current: what the stream changes. */
  slack: { hs: number; wavelength: number; steepness: number };
  /** The stream opposes the waves enough to steepen them noticeably. */
  windAgainstTide: boolean;
  /** The stream is too strong for the peak waves to travel against: they break. */
  blocked: boolean;
}

export interface SeaStateInputs {
  /** Mean wind over the ground (no gusts), where the air moves to (m/s), at real time epochMs. */
  wind(epochMs: number, n: number, e: number): NE;
  current(epochMs: number, n: number, e: number): NE;
  /** Water depth (m) at the water level of epochMs; ≤ 0 on land. Without it the sea is open everywhere. */
  depth?(epochMs: number, n: number, e: number): number;
  inDomain?(n: number, e: number): boolean;
  startEpochMs: number;
}

/** Open-sea fetch added where the upwind ray leaves the mapped area over water (E: Start Bay and the Channel). */
export const OPEN_SEA_FETCH_M = 40_000;
/** Depth used without a seabed, and the cap for finite-depth effects (m). */
const DEEP_M = 50;
const RAY_STEP_M = 25;
const OPEN_STEP_M = 100;
const MAX_RAY_M = 15_000;
const STEEPNESS_MAX = 0.1;
const DEPTH_BREAKING = 0.55;
const CALM_WIND = 0.5;

/** JONSWAP fetch-limited Hs and Tp for wind speed u (m/s) over fetch f (m), capped at the fully developed sea. */
export function jonswap(u: number, f: number): { hs: number; tp: number } {
  if (u < CALM_WIND || f <= 0) return { hs: 0, tp: 0 };
  const x = (G * f) / (u * u);
  const hs = Math.min(0.0016 * Math.sqrt(x), 0.243) * (u * u) / G;
  const tp = Math.min(0.286 * Math.cbrt(x), 8.13) * u / G;
  return { hs, tp };
}

/** Intrinsic frequency σ = √(g k tanh kh). */
function sigma(k: number, h: number): number {
  return Math.sqrt(G * k * Math.tanh(Math.min(k * h, 20)));
}

/** Group velocity relative to the water (m/s). */
export function groupVelocity(k: number, h: number): number {
  const kh = Math.min(k * h, 20);
  const n = 0.5 * (1 + (kh < 20 ? (2 * kh) / Math.sinh(2 * kh) : 0));
  return (n * sigma(k, h)) / k;
}

/** Wavenumber of a wave of intrinsic frequency σ in depth h (Newton on σ² = g k tanh kh). */
export function wavenumber(sig: number, h: number): number {
  let k = (sig * sig) / G;
  for (let i = 0; i < 30; i++) {
    const t = Math.tanh(Math.min(k * h, 20));
    const f = G * k * t - sig * sig;
    const df = G * t + G * k * h * (1 - t * t);
    const dk = f / df;
    k -= dk;
    if (Math.abs(dk) < 1e-10 * k) break;
  }
  return k;
}

/**
 * Wavenumber of waves with absolute frequency ω on a current U along their direction (m/s), depth h:
 * σ(k) + kU = ω on the branch that joins still water. undefined when blocked (no solution).
 */
export function wavenumberOnCurrent(omega: number, u: number, h: number): number | undefined {
  // Deep-water start: √(gk) + kU = ω, a quadratic in √k.
  let k: number;
  if (Math.abs(u) < 1e-9) k = (omega * omega) / G;
  else {
    const disc = G + 4 * u * omega;
    if (disc < 0) return undefined;
    const s = (-Math.sqrt(G) + Math.sqrt(disc)) / (2 * u);
    k = s * s;
  }
  // Finite depth: Newton on f(k) = σ(k) + kU − ω (f′ = cg + U).
  for (let i = 0; i < 30; i++) {
    const f = sigma(k, h) + k * u - omega;
    const df = groupVelocity(k, h) + u;
    if (df <= 1e-6) return undefined;
    const dk = f / df;
    k = Math.max(1e-6, k - dk);
    if (Math.abs(dk) < 1e-10 * k) break;
  }
  return Math.abs(sigma(k, h) + k * u - omega) < 1e-6 * omega ? k : undefined;
}

/** Monahan and O'Muircheartaigh (1980) whitecap fraction for a 10 m wind u (m/s). */
export function whitecapFraction(u: number): number {
  return Math.min(1, 3.84e-6 * Math.pow(Math.max(0, u), 3.41));
}

interface FetchRay {
  fetch: number;
  /** Current along the waves averaged over the fetch (m/s). */
  meanAlong: number;
}

/**
 * The sea state model. Results are cached on a 40 m grid in 30 s steps of sim time and interpolated, which
 * keeps it cheap; each cached value is computed from the cell centre and the step's time only, so the
 * cache never changes an answer.
 */
export class SeaStateModel {
  static readonly CELL_M = 40;
  static readonly STEP_S = 30;
  private readonly cache = new Map<string, SeaState>();
  private cacheStep = -1;

  constructor(private readonly src: SeaStateInputs) {}

  /** Sea state at sim time t (s) and point (n, e). */
  at(t: number, n: number, e: number): SeaState {
    const step = SeaStateModel.STEP_S;
    const i0 = Math.floor(t / step);
    const ft = t / step - i0;
    this.trim(i0);
    const a = this.spatial(i0, n, e);
    if (ft < 1e-9) return a;
    return blend(a, this.spatial(i0 + 1, n, e), ft);
  }

  /** Point evaluation at an exact time (no grid, no cache): for tests and diagnostics. */
  exact(t: number, n: number, e: number): SeaState {
    return this.evaluate(this.src.startEpochMs + t * 1000, n, e);
  }

  private spatial(step: number, n: number, e: number): SeaState {
    const c = SeaStateModel.CELL_M;
    const x = e / c - 0.5;
    const y = n / c - 0.5;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const s00 = this.cell(step, i, j);
    const s10 = this.cell(step, i + 1, j);
    const s01 = this.cell(step, i, j + 1);
    const s11 = this.cell(step, i + 1, j + 1);
    return blend(blend(s00, s10, fx), blend(s01, s11, fx), fy);
  }

  private cell(step: number, i: number, j: number): SeaState {
    const key = `${step}:${i}:${j}`;
    let s = this.cache.get(key);
    if (!s) {
      const c = SeaStateModel.CELL_M;
      s = this.evaluate(this.src.startEpochMs + step * SeaStateModel.STEP_S * 1000, (j + 0.5) * c, (i + 0.5) * c);
      this.cache.set(key, s);
    }
    return s;
  }

  /** Keep the cache to the current and next time steps. */
  private trim(step: number): void {
    if (step === this.cacheStep) return;
    for (const k of this.cache.keys()) {
      const s = Number(k.slice(0, k.indexOf(':')));
      if (s < step || s > step + 1) this.cache.delete(k);
    }
    this.cacheStep = step;
  }

  private depthAt(epochMs: number, n: number, e: number): number {
    return this.src.depth ? Math.min(DEEP_M, this.src.depth(epochMs, n, e)) : DEEP_M;
  }

  /** March upwind from (n, e) until land; average the current along the waves on the way. */
  private ray(epochMs: number, n: number, e: number, dirTo: number): FetchRay {
    const dn = -Math.cos(dirTo);
    const de = -Math.sin(dirTo);
    const along = (c: NE) => -(c.n * dn + c.e * de);
    if (!this.src.depth) {
      // Open sea all round: the whole open-sea fetch, with the stream sampled along it.
      let total = 0;
      for (let d = 0; d < OPEN_SEA_FETCH_M; d += OPEN_STEP_M) total += along(this.src.current(epochMs, n + dn * d, e + de * d)) * OPEN_STEP_M;
      return { fetch: OPEN_SEA_FETCH_M, meanAlong: total / OPEN_SEA_FETCH_M };
    }
    let sum = along(this.src.current(epochMs, n, e)) * RAY_STEP_M;
    let d = 0;
    while (d < MAX_RAY_M) {
      const pn = n + dn * (d + RAY_STEP_M);
      const pe = e + de * (d + RAY_STEP_M);
      if (this.src.inDomain && !this.src.inDomain(pn, pe)) {
        // Off the map over water: the open sea beyond, where the stream is not modelled (taken as slack).
        return { fetch: d + OPEN_SEA_FETCH_M, meanAlong: sum / (d + RAY_STEP_M + OPEN_SEA_FETCH_M) };
      }
      if (this.src.depth(epochMs, pn, pe) <= 0.2) break;
      d += RAY_STEP_M;
      sum += along(this.src.current(epochMs, pn, pe)) * RAY_STEP_M;
    }
    return { fetch: d, meanAlong: d > 0 ? sum / (d + RAY_STEP_M) : 0 };
  }

  private evaluate(epochMs: number, n: number, e: number): SeaState {
    const w = this.src.wind(epochMs, n, e);
    const c = this.src.current(epochMs, n, e);
    const h = this.depthAt(epochMs, n, e);
    // Wind relative to the water drives the waves; they travel with it.
    const rn = w.n - c.n;
    const re = w.e - c.e;
    const u = Math.hypot(rn, re);
    const dirTo = Math.atan2(re, rn);
    const local = c.n * Math.cos(dirTo) + c.e * Math.sin(dirTo);
    const calm = (fetch: number): SeaState => ({
      hs: 0, tp: 0, wavelength: 0, dirTo, steepness: 0, whitecaps: 0, currentAlong: local, fetch,
      slack: { hs: 0, wavelength: 0, steepness: 0 }, windAgainstTide: false, blocked: false,
    });
    if (h <= 0.2 || u < CALM_WIND) return calm(0);
    const ray = this.ray(epochMs, n, e, dirTo);
    if (ray.fetch <= 0) return calm(0);

    // Slack water reference: the same wind and fetch with no current.
    const ref = jonswap(u, ray.fetch);
    const kRef = wavenumber((2 * Math.PI) / ref.tp, h);
    const lRef = (2 * Math.PI) / kRef;
    const hsRef = Math.min(ref.hs, STEEPNESS_MAX * lRef, DEPTH_BREAKING * h);

    // Generation over the fetch with the mean current along the waves (effective fetch, iterated).
    const ub = ray.meanAlong;
    let gen = ref;
    let blocked = false;
    for (let i = 0; i < 4; i++) {
      const cg = groupVelocity(wavenumber((2 * Math.PI) / gen.tp, DEEP_M), DEEP_M);
      const ground = cg + ub;
      blocked = ground <= 0.1 * cg;
      gen = jonswap(u, blocked ? ray.fetch * 10 : Math.min(ray.fetch * 10, (ray.fetch * cg) / ground));
    }
    const sig0 = (2 * Math.PI) / gen.tp;
    const k0 = wavenumber(sig0, DEEP_M);
    const omega = sig0 + k0 * ub;
    const cg0 = groupVelocity(k0, DEEP_M);

    // From the fetch to here: conserve ω and wave action.
    let k = omega > 0 ? wavenumberOnCurrent(omega, local, h) : undefined;
    let hs: number;
    if (k === undefined) {
      blocked = true;
      // At the blocking point (deep water): k = g / (4U²).
      k = local < 0 ? G / (4 * local * local) : wavenumber(sig0, h);
      hs = STEEPNESS_MAX * ((2 * Math.PI) / k);
    } else {
      const sig = sigma(k, h);
      const ratio = ((cg0 + ub) * sig) / Math.max(1e-3, (groupVelocity(k, h) + local) * sig0);
      hs = gen.hs * Math.sqrt(Math.max(0, ratio));
    }
    const wavelength = (2 * Math.PI) / k;
    hs = Math.min(hs, STEEPNESS_MAX * wavelength, DEPTH_BREAKING * h);
    const steepness = hs / wavelength;
    const refSteep = hsRef / lRef;
    const steepen = refSteep > 0 ? steepness / refSteep : 1;
    let whitecaps = whitecapFraction(u) * steepen * steepen;
    if (blocked || steepness >= 0.98 * STEEPNESS_MAX) whitecaps = Math.max(whitecaps, 0.15);
    return {
      hs,
      tp: omega > 0 ? (2 * Math.PI) / omega : gen.tp,
      wavelength,
      dirTo,
      steepness,
      whitecaps: Math.min(0.6, whitecaps),
      currentAlong: local,
      fetch: ray.fetch,
      slack: { hs: hsRef, wavelength: lRef, steepness: refSteep },
      windAgainstTide: local < -0.25 && u > 4 && steepen > 1.15,
      blocked,
    };
  }
}

/** Linear blend of two sea states (direction along the shorter arc). */
function blend(a: SeaState, b: SeaState, f: number): SeaState {
  if (f <= 0) return a;
  if (f >= 1) return b;
  const l = (x: number, y: number) => x + (y - x) * f;
  let dd = b.dirTo - a.dirTo;
  dd -= 2 * Math.PI * Math.round(dd / (2 * Math.PI));
  return {
    hs: l(a.hs, b.hs),
    tp: l(a.tp, b.tp),
    wavelength: l(a.wavelength, b.wavelength),
    dirTo: a.dirTo + dd * f,
    steepness: l(a.steepness, b.steepness),
    whitecaps: l(a.whitecaps, b.whitecaps),
    currentAlong: l(a.currentAlong, b.currentAlong),
    fetch: l(a.fetch, b.fetch),
    slack: { hs: l(a.slack.hs, b.slack.hs), wavelength: l(a.slack.wavelength, b.slack.wavelength), steepness: l(a.slack.steepness, b.slack.steepness) },
    windAgainstTide: f < 0.5 ? a.windAgainstTide : b.windAgainstTide,
    blocked: f < 0.5 ? a.blocked : b.blocked,
  };
}
