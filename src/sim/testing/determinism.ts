import { Simulation } from '../simulation';
import { squibParams } from '../boat/squib';
import { buildConditions } from '../env/conditions';
import { autopilotHelm } from '../control/autopilot';
import { DEG } from '../math/angles';

/**
 * A fixed scripted run used to compare Node and browser results bit-for-bit (acceptance criterion 11).
 */
export function determinismSim(): Simulation {
  let phase = 0;
  return new Simulation({
    params: squibParams(),
    // Gusts, shifts and a tide-driven stream so the probe exercises the whole Phase 2 environment.
    env: buildConditions({
      startTime: '2026-07-15T11:00:00Z',
      weather: { source: 'manual', twsKn: 12, twdDeg: 225 },
      gusts: { preset: 'moderate', seed: 7 },
      current: { mode: 'tidal', stream: { floodSetDeg: 40, peakFloodKn: 1.2, peakEbbKn: 1.6, riverEbbKn: 0.2 } },
      tide: { mode: 'manual', hwTime: '2026-07-15T14:00:00Z', hwHeightM: 4.6, lwHeightM: 1.2 },
    }).env,
    initial: { headingDeg: 180, speedKn: 3 },
    input: { autoMain: true, autoJib: true },
    controller: (s) => {
      const t = s.time;
      if (t > 100 && phase === 0) phase = 1;
      if (t > 250 && phase === 1) phase = 2;
      if (t > 400 && phase === 2) phase = 3;
      const targets = [45, -45, 150, -120];
      const change: Record<string, number | boolean> = { helm: autopilotHelm(s, { mode: 'twa', target: targets[phase]! * DEG }) };
      if (t > 500) change.autoMain = false;
      if (t > 500) change.mainSheet = 0.4;
      return change;
    },
  });
}

export function runDeterminismProbe(seconds: number): string {
  const sim = determinismSim();
  sim.advance(seconds);
  return sim.stateHash();
}

/** Full state vector after a probe run, for cross-engine tolerance comparisons. */
export function runDeterminismState(seconds: number): number[] {
  const sim = determinismSim();
  sim.advance(seconds);
  const s = sim.state;
  const a = sim.act;
  return [s.n, s.e, s.psi, s.u, s.v, s.r, s.phi, s.p, a.rudder, a.boomMain, a.boomRate, a.boomJib, a.crewY, a.mainSide, a.jibSide];
}
