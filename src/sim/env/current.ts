import { DEG } from '../math/angles';
import { knToMs } from '../units';
import { northerlyOutflowKn, offshoreStream, offshoreWeight, type DepthWeight } from './streamAnomalies';
import type { NE } from '../boat/forces';
import type { TideSource } from './tide';

/**
 * Current (water velocity over ground). Phase 2 provides uniform currents, a tide-driven uniform stream and
 * analytic test fields; Phase 3 adds the spatial channel-following pattern for the Dart.
 */
export interface CurrentModel {
  readonly kind: 'none' | 'uniform' | 'tidal' | 'test-field';
  readonly label: string;
  readonly notes: string[];
  at(epochMs: number, n: number, e: number): NE;
}

export const NO_CURRENT: CurrentModel = { kind: 'none', label: 'No current', notes: [], at: () => ({ n: 0, e: 0 }) };

/** Steady uniform current: rate (kn) flowing TOWARDS `setDeg`. */
export function uniformCurrent(setDeg: number, rateKn: number): CurrentModel {
  const r = knToMs(rateKn);
  const v = { n: r * Math.cos(setDeg * DEG), e: r * Math.sin(setDeg * DEG) };
  return {
    kind: rateKn > 0 ? 'uniform' : 'none',
    label: rateKn > 0 ? `Uniform current ${rateKn.toFixed(1)} kn setting ${Math.round(setDeg)}°` : 'No current',
    notes: rateKn > 0 ? ['Scenario setting, not measured.'] : [],
    at: () => v,
  };
}

export interface TidalStreamSettings {
  /** Direction the flood runs TOWARDS (deg true); the ebb runs the opposite way. */
  floodSetDeg: number;
  /** Peak flood and ebb rates (kn) at mid-tide. */
  peakFloodKn: number;
  peakEbbKn: number;
  /** Extra steady seaward flow from the river (kn, in the ebb direction), e.g. after heavy rain. */
  riverEbbKn: number;
}

/** Default rates: DHNA states the entrance stream "seldom exceeds 2 knots" (docs/RESEARCH_REPORT.md §4). */
export const DEFAULT_TIDAL_STREAM: TidalStreamSettings = { floodSetDeg: 330, peakFloodKn: 1.5, peakEbbKn: 2.0, riverEbbKn: 0 };

/**
 * PROVISIONAL uniform tidal stream driven by real tide timing: rate ∝ the normalised rate of change of the
 * tide height (slack near HW and LW, strongest at mid-tide, as in a standing-wave estuary), scaled by the
 * peak rates, plus a steady river component. Not measured; the spatial pattern comes in Phase 3.
 */
export function tidalStream(tide: TideSource, s: TidalStreamSettings): CurrentModel {
  const fn = Math.cos(s.floodSetDeg * DEG);
  const fe = Math.sin(s.floodSetDeg * DEG);
  return {
    kind: 'tidal',
    label: `Tidal stream (modelled): flood ${s.peakFloodKn} kn → ${Math.round(s.floodSetDeg)}°, ebb ${s.peakEbbKn} kn`,
    notes: [
      'Provisional model: rate follows the rate of change of the tide height; not measured current data.',
      `Tide timing from: ${tide.label}.`,
      ...(s.riverEbbKn > 0 ? [`Includes ${s.riverEbbKn} kn river outflow in the ebb direction.`] : []),
    ],
    at(t: number) {
      const ph = tide.at(t).phase;
      const rate = knToMs(ph >= 0 ? ph * s.peakFloodKn : ph * s.peakEbbKn) - knToMs(s.riverEbbKn);
      return { n: rate * fn, e: rate * fe };
    },
  };
}

/** Analytic test field: linear shear, east-going current growing with northing (c_e = k·n). */
export function shearCurrent(k: number): CurrentModel {
  return { kind: 'test-field', label: `Test shear current k=${k}`, notes: ['Analytic test field.'], at: (_t, n) => ({ n: 0, e: k * n }) };
}

/** Stream patterns over the River Dart (unit mean speed across the entrance, ebb direction). */
export interface StreamPattern {
  streamPattern(n: number, e: number): { tidal: NE; river: NE };
}

/** Local departures from the pattern (src/sim/env/streamAnomalies.ts); each optional. */
export interface StreamExtras {
  /** Deeper water runs faster. */
  depthWeight?: DepthWeight;
  /** Start Bay's coastal stream offshore. */
  offshore?: boolean;
  /** The weather's wind at the entrance (from-direction rad, speed m/s) at an instant: northerlies drive the ebb. */
  windAt?: (epochMs: number) => { fromDir: number; speed: number };
}

/**
 * PROVISIONAL channel-following tidal stream over the River Dart: the precomputed tidal-prism pattern
 * (tools/geodata/current.py) scaled by the entrance stream from the tide timing, as in `tidalStream`
 * (peak rates = mean speed across the entrance at mid-tide), plus river outflow along its own pattern.
 * Faster in the narrows, slack in the creeks; with `extras`, faster over deep water, the coastal stream
 * offshore and more ebb in strong northerlies. Not measured current data.
 */
export function dartStream(tide: TideSource, geo: StreamPattern, s: TidalStreamSettings, extras: StreamExtras = {}): CurrentModel {
  const last = { t: NaN, flood: 0, river: 0, offshore: { n: 0, e: 0 } };
  return {
    kind: 'tidal',
    label: `Tidal stream (modelled, channel-following): entrance flood ${s.peakFloodKn} kn, ebb ${s.peakEbbKn} kn`,
    notes: [
      'Provisional model: pattern from tidal-prism continuity on estimated depths, scaled to the entrance stream; not measured current data.',
      'Rates are the mean across the entrance (castle to castle) at mid-tide; the narrows run faster, creeks and bays slower.',
      ...(extras.depthWeight ? ['Deeper water runs faster than the shallows beside it (depth^(2/3), estimated).'] : []),
      ...(extras.offshore ? ['Offshore in Start Bay the stream runs along the coast: north-east-going from HW−2 to HW+4, south-west-going from LW−2 to LW+4 (DHNA); its rate (0.7 kn at most) is estimated.'] : []),
      ...(extras.windAt ? ['Strong northerlies blowing down the river strengthen the ebb (DHNA: up to 3.5 kn at the entrance with heavy rain or strong northerlies; the amount is estimated). Heavy rain upriver: raise the river outflow.'] : []),
      `Tide timing from: ${tide.label}.`,
      ...(s.riverEbbKn > 0 ? [`Includes ${s.riverEbbKn} kn river outflow at the entrance.`] : []),
    ],
    at(t: number, n: number, e: number) {
      // What depends on the time alone, once per instant (every boat asks at the same instants).
      if (t !== last.t) {
        const st = tide.at(t);
        const ph = st.phase;
        // Positive = flood (up-river), i.e. against the ebb-direction pattern.
        last.flood = knToMs(ph >= 0 ? ph * s.peakFloodKn : ph * s.peakEbbKn);
        let riverKn = s.riverEbbKn;
        if (extras.windAt) {
          const w = extras.windAt(t);
          const more = northerlyOutflowKn(w.fromDir, w.speed);
          if (more > 0) riverKn += more;
        }
        last.river = knToMs(riverKn);
        if (extras.offshore) last.offshore = offshoreStream(st);
        last.t = t;
      }
      const flood = last.flood;
      const river = last.river;
      const f = geo.streamPattern(n, e);
      let vn = -flood * f.tidal.n + river * f.river.n;
      let ve = -flood * f.tidal.e + river * f.river.e;
      if (extras.depthWeight) {
        const k = extras.depthWeight.at(n, e);
        if (k !== 1) {
          vn *= k;
          ve *= k;
        }
      }
      if (extras.offshore) {
        const w = offshoreWeight(n, e);
        // Over the sea only (not on the land along the coast).
        const bed = (geo as { bedElevation?: (n: number, e: number) => number }).bedElevation;
        if (w > 0 && !(bed && bed.call(geo, n, e) >= 0)) {
          vn += w * last.offshore.n;
          ve += w * last.offshore.e;
        }
      }
      return { n: vn, e: ve };
    },
  };
}
