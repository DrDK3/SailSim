/// <reference lib="webworker" />
/**
 * Model polar sweep off the main thread: for each TWA, the boat's steady state with the crew policy the
 * player's assists and the AI use (`crewPolicyPoint`, the one polar generator: the AI's target table comes from
 * the same function). Uniform steady wind, flat water, no current. Points where the boat has not settled
 * (speed or heel still swinging) are flagged. MODEL OUTPUT FROM ESTIMATED COEFFICIENTS, NOT MEASURED PERFORMANCE.
 */
import { crewPolicyPoint } from '../sim/ai/polar';
import { squibParams } from '../sim/boat/squib';

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
  /** False when speed or heel was still swinging at the end (not a steady state). */
  settled: boolean;
  stwRangeKn: number;
  heelRangeDeg: number;
}

export type PolarMessage = { type: 'point'; twsKn: number; point: PolarPoint; done: number; total: number } | { type: 'done'; twsKn: number };

self.onmessage = (ev: MessageEvent<PolarRequest>) => {
  const { twsKn, twaDeg, durationS } = ev.data;
  const params = squibParams();
  twaDeg.forEach((twa, i) => {
    const p = crewPolicyPoint(params, twsKn, twa, durationS);
    const point: PolarPoint = { twaDeg: twa, stwKn: p.stwKn, heelDeg: p.heelDeg, vmgKn: p.vmgKn, settled: p.settled, stwRangeKn: p.stwRangeKn, heelRangeDeg: p.heelRangeDeg };
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'point', twsKn, point, done: i + 1, total: twaDeg.length } satisfies PolarMessage);
  });
  (self as DedicatedWorkerGlobalScope).postMessage({ type: 'done', twsKn } satisfies PolarMessage);
};
