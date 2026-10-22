/// <reference lib="webworker" />
/**
 * Model polar sweep off the main thread: for each TWA, run a headless simulation with the autopilot holding
 * the angle and the max-drive trim helper on the sheets, and report the settled speed through the water.
 * Uniform steady wind, no current. MODEL OUTPUT FROM ESTIMATED COEFFICIENTS, NOT MEASURED PERFORMANCE.
 */
import { DEG, msToKn, runScenario } from '../sim/index';

export interface PolarRequest {
  twsKn: number;
  twaDeg: number[];
  durationS: number;
}

export interface PolarPoint {
  twaDeg: number;
  stwKn: number;
  heelDeg: number;
  vmgKn: number;
}

export type PolarMessage = { type: 'point'; twsKn: number; point: PolarPoint; done: number; total: number } | { type: 'done'; twsKn: number };

self.onmessage = (ev: MessageEvent<PolarRequest>) => {
  const { twsKn, twaDeg, durationS } = ev.data;
  twaDeg.forEach((twa, i) => {
    const sim = runScenario({
      name: 'polar',
      durationS,
      conditions: { twsKn, twdDeg: 0 },
      initial: { headingDeg: -twa, speedKn: 4 },
      autopilot: { mode: 'twa', targetDeg: twa },
      optimiseTrim: true,
    });
    const s = sim.snapshot();
    const point: PolarPoint = { twaDeg: twa, stwKn: msToKn(s.stw), heelDeg: Math.abs(s.heel) / DEG, vmgKn: msToKn(s.vmg) };
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'point', twsKn, point, done: i + 1, total: twaDeg.length } satisfies PolarMessage);
  });
  (self as DedicatedWorkerGlobalScope).postMessage({ type: 'done', twsKn } satisfies PolarMessage);
};
