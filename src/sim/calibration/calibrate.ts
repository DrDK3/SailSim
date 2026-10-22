import { DEG } from '../math/angles';
import { msToKn } from '../units';
import type { BoatParams } from '../boat/params';
import { runScenario } from '../scenario';

/**
 * Calibration against observed steady-state sailing points (docs/CALIBRATION.md).
 *
 * An observation is a settled condition: true wind speed and angle, and what the boat did (speed through the
 * water, heel, leeway). The model is run to steady state at each point with the same procedure as the model
 * polar (autopilot holding the TWA, max-drive sheet setting), and residuals are model − observed.
 *
 * Fitting adjusts a small number of dimensionless multipliers ("knobs") on groups of estimated coefficients;
 * it never edits data files. A fitted value is adopted by hand, with tag C and the observation set as source.
 */
export interface ObservedPoint {
  twsKn: number;
  twaDeg: number;
  stwKn?: number;
  heelDeg?: number;
  leewayDeg?: number;
  /** Relative weight (default 1). */
  weight?: number;
  /** Where the observation came from (required: no anonymous data). */
  source: string;
}

export interface ModelPoint {
  stwKn: number;
  heelDeg: number;
  leewayDeg: number;
}

export interface Residual {
  obs: ObservedPoint;
  model: ModelPoint;
  dStwKn?: number;
  dHeelDeg?: number;
  dLeewayDeg?: number;
}

export interface Knob {
  id: string;
  label: string;
  /** Plausible multiplier range searched by the fit. */
  range: [number, number];
  apply(p: BoatParams, x: number): BoatParams;
}

const scaleTable = (t: [number, number][], x: number): [number, number][] => t.map(([a, b]) => [a, b * x]);

/** Groups of estimated coefficients that observations can constrain. Multipliers, nominal 1. */
export const KNOBS: Record<string, Knob> = {
  sailLift: {
    id: 'sailLift',
    label: 'Sail maximum lift (main and jib clMax)',
    range: [0.7, 1.3],
    apply: (p, x) => ({
      ...p,
      main: { ...p.main, coeff: { ...p.main.coeff, clMax: p.main.coeff.clMax * x } },
      jib: { ...p.jib, coeff: { ...p.jib.coeff, clMax: p.jib.coeff.clMax * x } },
    }),
  },
  residuary: {
    id: 'residuary',
    label: 'Residuary (wave) resistance table',
    range: [0.5, 2],
    apply: (p, x) => ({ ...p, residuary: scaleTable(p.residuary, x) }),
  },
  friction: {
    id: 'friction',
    label: 'Friction form factor',
    range: [0.8, 1.6],
    apply: (p, x) => ({ ...p, formFactor: p.formFactor * x }),
  },
  righting: {
    id: 'righting',
    label: 'Righting arm (GZ curve)',
    range: [0.6, 1.5],
    apply: (p, x) => ({ ...p, gz: scaleTable(p.gz, x), gm: p.gm * x }),
  },
};

export interface SteadyOptions {
  /** Simulated seconds per point (default 120; speed settles in ~30–60 s). */
  durationS?: number;
}

/** The model's settled state at one condition (uniform steady wind, flat water, no current). */
export function modelPoint(params: BoatParams, twsKn: number, twaDeg: number, o: SteadyOptions = {}): ModelPoint {
  const sim = runScenario(
    {
      name: 'calibration-point',
      durationS: o.durationS ?? 120,
      conditions: { twsKn, twdDeg: 0 },
      initial: { headingDeg: -twaDeg, speedKn: 4 },
      autopilot: { mode: 'twa', targetDeg: twaDeg },
      optimiseTrim: true,
    },
    undefined,
    params,
  );
  const s = sim.snapshot(false);
  return { stwKn: msToKn(s.stw), heelDeg: Math.abs(s.heel) / DEG, leewayDeg: Math.abs(s.leeway) / DEG };
}

export function residuals(params: BoatParams, obs: ObservedPoint[], o: SteadyOptions = {}): Residual[] {
  return obs.map((ob) => {
    const m = modelPoint(params, ob.twsKn, ob.twaDeg, o);
    return {
      obs: ob,
      model: m,
      dStwKn: ob.stwKn === undefined ? undefined : m.stwKn - ob.stwKn,
      dHeelDeg: ob.heelDeg === undefined ? undefined : m.heelDeg - ob.heelDeg,
      dLeewayDeg: ob.leewayDeg === undefined ? undefined : m.leewayDeg - ob.leewayDeg,
    };
  });
}

/** Typical observation uncertainty used to make the residual types comparable (1 kn ≙ 10° heel ≙ 2° leeway). */
export const SCALES = { stwKn: 0.1, heelDeg: 1, leewayDeg: 0.5 };

/** Weighted sum of squared, scaled residuals. */
export function cost(rs: Residual[]): number {
  let c = 0;
  for (const r of rs) {
    const w = r.obs.weight ?? 1;
    if (r.dStwKn !== undefined) c += w * (r.dStwKn / SCALES.stwKn) ** 2;
    if (r.dHeelDeg !== undefined) c += w * (r.dHeelDeg / SCALES.heelDeg) ** 2;
    if (r.dLeewayDeg !== undefined) c += w * (r.dLeewayDeg / SCALES.leewayDeg) ** 2;
  }
  return c;
}

export function rms(rs: Residual[]): { stwKn?: number; heelDeg?: number; leewayDeg?: number } {
  const f = (vals: (number | undefined)[]) => {
    const v = vals.filter((x): x is number => x !== undefined);
    return v.length ? Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length) : undefined;
  };
  return { stwKn: f(rs.map((r) => r.dStwKn)), heelDeg: f(rs.map((r) => r.dHeelDeg)), leewayDeg: f(rs.map((r) => r.dLeewayDeg)) };
}

export interface FitResult {
  multipliers: Record<string, number>;
  costBefore: number;
  costAfter: number;
  evaluations: number;
  /** A multiplier that ended on the edge of its range: the knob cannot explain the data (or the range is wrong). */
  atBound: string[];
  /** Knobs whose whole range changes the cost by < 1 %: the observations do not constrain them. */
  insensitive: string[];
}

/**
 * Fit multipliers by coordinate descent with a golden-section line search on each knob. Deterministic.
 * With few observations, fit few knobs: e.g. upwind STW and heel constrain sailLift and righting, reaching
 * and running STW constrain the resistance knobs.
 */
export function fit(base: BoatParams, obs: ObservedPoint[], knobs: Knob[], o: SteadyOptions & { passes?: number; tol?: number } = {}): FitResult {
  if (!obs.length) throw new Error('No observations to fit');
  for (const ob of obs) if (!ob.source) throw new Error(`Observation at TWS ${ob.twsKn} kn TWA ${ob.twaDeg}° has no source`);
  const x: Record<string, number> = Object.fromEntries(knobs.map((k) => [k.id, 1]));
  let evaluations = 0;
  const paramsFor = (vals: Record<string, number>) => knobs.reduce((p, k) => k.apply(p, vals[k.id]!), base);
  const evaluate = (vals: Record<string, number>) => {
    evaluations++;
    return cost(residuals(paramsFor(vals), obs, o));
  };
  const costBefore = evaluate(x);
  const tol = o.tol ?? 0.005;
  const phi = (Math.sqrt(5) - 1) / 2;
  const spread: Record<string, { lo: number; hi: number }> = Object.fromEntries(knobs.map((k) => [k.id, { lo: Infinity, hi: -Infinity }]));
  for (let pass = 0; pass < (o.passes ?? (knobs.length > 1 ? 3 : 1)); pass++) {
    for (const k of knobs) {
      const at = (v: number) => {
        const c = evaluate({ ...x, [k.id]: v });
        spread[k.id]!.lo = Math.min(spread[k.id]!.lo, c);
        spread[k.id]!.hi = Math.max(spread[k.id]!.hi, c);
        return c;
      };
      // Probe both ends first, so an insensitive knob is recognised whatever the line search does.
      at(k.range[0]);
      at(k.range[1]);
      let [a, b] = k.range;
      let c = b - phi * (b - a);
      let d = a + phi * (b - a);
      let fc = at(c);
      let fd = at(d);
      while (b - a > tol) {
        if (fc < fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - phi * (b - a);
          fc = at(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + phi * (b - a);
          fd = at(d);
        }
      }
      x[k.id] = (a + b) / 2;
    }
  }
  const insensitive = knobs.filter((k) => spread[k.id]!.hi - spread[k.id]!.lo < 0.01 * Math.max(spread[k.id]!.hi, 1e-9)).map((k) => k.id);
  const atBound = knobs
    .filter((k) => !insensitive.includes(k.id) && (x[k.id]! - k.range[0] < 2 * tol || k.range[1] - x[k.id]! < 2 * tol))
    .map((k) => k.id);
  return { multipliers: x, costBefore, costAfter: evaluate(x), evaluations, atBound, insensitive };
}

/** Parse observations CSV: header with tws_kn, twa_deg and any of stw_kn, heel_deg, leeway_deg, weight, source. */
export function parseObservationsCsv(text: string): ObservedPoint[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const head = lines[0]!.split(',').map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  if (col('tws_kn') < 0 || col('twa_deg') < 0 || col('source') < 0) throw new Error('Observations CSV needs tws_kn, twa_deg and source columns');
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const num = (name: string) => {
      const j = col(name);
      if (j < 0 || cells[j] === undefined || cells[j] === '') return undefined;
      const v = Number(cells[j]);
      if (!Number.isFinite(v)) throw new Error(`Row ${i + 2}: ${name} "${cells[j]}" is not a number`);
      return v;
    };
    const source = cells[col('source')] ?? '';
    if (!source) throw new Error(`Row ${i + 2}: every observation needs a source`);
    return { twsKn: num('tws_kn')!, twaDeg: num('twa_deg')!, stwKn: num('stw_kn'), heelDeg: num('heel_deg'), leewayDeg: num('leeway_deg'), weight: num('weight'), source };
  });
}
