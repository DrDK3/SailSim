import { DEG } from '../math/angles';
import { knToMs } from '../units';
import { windVelocity, type NE } from '../boat/forces';
import { NO_CURRENT, uniformCurrent, type CurrentModel } from './current';
import type { TideSource, TideState } from './tide';
import type { WindField } from './wind';
import type { SkySource, SkyState } from './sky';
import { SeaStateModel, type SeaState } from './seaState';

/** Where the wind comes from, for labelling and provenance in the UI. */
export interface WeatherInfo {
  kind: 'manual' | 'model' | 'observed' | 'replay';
  label: string;
  /** Valid time of the data (ISO), for live/replay sources. */
  validTime?: string;
  attribution?: string;
  notes: string[];
}

export interface EnvironmentInfo {
  weather: WeatherInfo;
  currentLabel: string;
  currentNotes: string[];
  tide?: TideState & { label: string; notes: string[] };
  /** Wind and current more than 120° opposed with enough of both: steep, short chop (visual flag). */
  windAgainstTide: boolean;
  gustFactor: number;
  epochMs: number;
  /** Cloud, visibility and rain (visual only), with where they come from. */
  sky?: SkyState & { label: string; kind: SkySource['kind'] };
  /** Waves here (modelled from the wind, fetch and stream). */
  sea?: SeaState;
}

/**
 * The boat's surroundings. Sim time t is seconds since the scenario start; `startEpochMs` maps it to real
 * time for tides and live data.
 */
export interface Environment {
  /** True wind velocity over the ground at a point (where the air moves to), m/s. */
  wind(t: number, n: number, e: number): NE;
  /** Current (water velocity over ground), m/s. */
  current(t: number, n: number, e: number): NE;
  /** Human-readable provenance for the UI. */
  readonly label: string;
  /** Advance internal state (gusts, shifts) by one fixed step. Called once per step by the owner. */
  step?(t: number, dt: number): void;
  describe?(t: number, n: number, e: number): EnvironmentInfo;
  /** Water level (m above Ordnance Datum Newlyn) from the tide, when a vertical datum is known. */
  waterLevel?(t: number): number;
  readonly windField?: WindField;
  readonly startEpochMs?: number;
  /** Cloud, visibility and rain for the renderer. Visual only: never read by the physics. */
  readonly sky?: SkySource;
  /** Waves at a point (wind sea shaped by fetch and current, src/sim/env/seaState.ts), when modelled. */
  seaState?(t: number, n: number, e: number): SeaState;
}

export interface UniformConditions {
  twsKn: number;
  /** Direction the wind blows FROM, degrees true. */
  twdDeg: number;
  /** Direction the current flows TOWARDS (nautical "set"), degrees true. */
  currentSetDeg?: number;
  currentRateKn?: number;
}

/** Uniform, steady wind and current (Phase 1 behaviour; used by many tests). */
export function uniformEnvironment(c: UniformConditions, label = 'Manual scenario (uniform, steady)'): Environment {
  const wind = windVelocity(knToMs(c.twsKn), c.twdDeg * DEG);
  const cur = uniformCurrent(c.currentSetDeg ?? 0, c.currentRateKn ?? 0).at(0, 0, 0);
  return { wind: () => wind, current: () => cur, label };
}

export interface ComposedOptions {
  wind: WindField;
  weather: WeatherInfo;
  current?: CurrentModel;
  tide?: TideSource;
  startEpochMs: number;
  /**
   * Vertical datum for water levels: chart datum below ODN, and the level (m above CD) used when there is
   * no tide. Needed only with a seabed (the River Dart data).
   */
  datum?: { cdBelowOdn: number; meanLevelCd: number };
  sky?: SkySource;
  /** Land and water for the waves' fetch (the River Dart data); without it the sea is open all round. */
  terrain?: { bedElevation(n: number, e: number): number; inDomain(n: number, e: number): boolean };
}

/** Combine a wind field, a current model and an optional tide source into an Environment. */
export function composeEnvironment(o: ComposedOptions): Environment {
  const current = o.current ?? NO_CURRENT;
  const epoch = (t: number) => o.startEpochMs + t * 1000;
  const level = o.datum ? (t: number) => (o.tide ? o.tide.at(epoch(t)).height : o.datum!.meanLevelCd) - o.datum!.cdBelowOdn : undefined;
  const runTime = (epochMs: number) => (epochMs - o.startEpochMs) / 1000;
  const terrain = o.terrain;
  // Waves from the mean wind (gusts are too short-lived to raise a sea), the stream and the land.
  const sea = new SeaStateModel({
    startEpochMs: o.startEpochMs,
    wind: (ms, n, e) => {
      const b = o.wind.base.at(n, e, runTime(ms));
      return { n: -b.speed * Math.cos(b.fromDir), e: -b.speed * Math.sin(b.fromDir) };
    },
    current: (ms, n, e) => current.at(ms, n, e),
    depth: terrain && level ? (ms, n, e) => level(runTime(ms)) - terrain.bedElevation(n, e) : undefined,
    inDomain: terrain ? (n, e) => terrain.inDomain(n, e) : undefined,
  });
  return {
    label: o.weather.label,
    windField: o.wind,
    startEpochMs: o.startEpochMs,
    sky: o.sky,
    wind: (_t, n, e) => o.wind.wind(n, e),
    current: (t, n, e) => current.at(epoch(t), n, e),
    step: (t, dt) => o.wind.step(t, dt),
    waterLevel: level,
    seaState: (t, n, e) => sea.at(t, n, e),
    describe(t, n, e) {
      const w = o.wind.sample(n, e);
      const here = sea.at(t, n, e);
      const c = current.at(epoch(t), n, e);
      const cRate = Math.hypot(c.n, c.e);
      const windTo = { n: -Math.cos(w.fromDir), e: -Math.sin(w.fromDir) };
      const cos = cRate > 1e-9 ? (windTo.n * c.n + windTo.e * c.e) / cRate : 1;
      const tide = o.tide ? { ...o.tide.at(epoch(t)), label: o.tide.label, notes: o.tide.notes } : undefined;
      return {
        weather: o.weather,
        currentLabel: current.label,
        currentNotes: current.notes,
        tide,
        windAgainstTide: here.windAgainstTide || (cos < Math.cos(120 * DEG) && cRate > knToMs(0.5) && w.speed > knToMs(8)),
        sea: here,
        gustFactor: w.gustFactor,
        epochMs: epoch(t),
        sky: o.sky ? { ...o.sky.at(t), label: o.sky.label, kind: o.sky.kind } : undefined,
      };
    },
  };
}
