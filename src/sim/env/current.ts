import { DEG } from '../math/angles';
import { knToMs } from '../units';
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

/**
 * PROVISIONAL channel-following tidal stream over the River Dart: the precomputed tidal-prism pattern
 * (tools/geodata/current.py) scaled by the entrance stream from the tide timing, as in `tidalStream`
 * (peak rates = mean speed across the entrance at mid-tide), plus river outflow along its own pattern.
 * Faster in the narrows, slack in the creeks; not measured current data.
 */
export function dartStream(tide: TideSource, geo: StreamPattern, s: TidalStreamSettings): CurrentModel {
  return {
    kind: 'tidal',
    label: `Tidal stream (modelled, channel-following): entrance flood ${s.peakFloodKn} kn, ebb ${s.peakEbbKn} kn`,
    notes: [
      'Provisional model: pattern from tidal-prism continuity on estimated depths, scaled to the entrance stream; not measured current data.',
      'Rates are the mean across the entrance (castle to castle) at mid-tide; the narrows run faster, creeks and bays slower.',
      `Tide timing from: ${tide.label}.`,
      ...(s.riverEbbKn > 0 ? [`Includes ${s.riverEbbKn} kn river outflow at the entrance.`] : []),
    ],
    at(t: number, n: number, e: number) {
      const ph = tide.at(t).phase;
      // Positive = flood (up-river), i.e. against the ebb-direction pattern.
      const flood = knToMs(ph >= 0 ? ph * s.peakFloodKn : ph * s.peakEbbKn);
      const river = knToMs(s.riverEbbKn);
      const f = geo.streamPattern(n, e);
      return { n: -flood * f.tidal.n + river * f.river.n, e: -flood * f.tidal.e + river * f.river.e };
    },
  };
}
