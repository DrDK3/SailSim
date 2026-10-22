import { Simulation } from '../simulation';
import { squibParams } from '../boat/squib';
import { uniformEnvironment } from '../env/environment';
import { autopilotHelm } from '../control/autopilot';
import { DEG } from '../math/angles';

/**
 * A fixed scripted run used to compare Node and browser results bit-for-bit (acceptance criterion 11).
 */
export function determinismSim(): Simulation {
  let phase = 0;
  return new Simulation({
    params: squibParams(),
    env: uniformEnvironment({ twsKn: 12, twdDeg: 225, currentSetDeg: 40, currentRateKn: 0.8 }),
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
  return [s.n, s.e, s.psi, s.u, s.v, s.r, a.rudder, a.boomMain, a.boomJib, a.heel, a.crewY, a.mainSide, a.jibSide];
}
