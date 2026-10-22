import {
  DEG,
  Simulation,
  autopilotHelm,
  optimalSheets,
  squibParams,
  uniformEnvironment,
  type ControlInput,
  type Environment,
} from '../../src/sim/index';

export const KN = 1852 / 3600;

export interface SailOpts {
  twsKn?: number;
  twaDeg: number;
  startKn?: number;
  /** Hold the TWA with the autopilot. */
  hold?: boolean;
  /** Max-drive trim refreshed every second. */
  optimise?: boolean;
  env?: Environment;
  input?: Partial<ControlInput>;
  lockHeading?: boolean;
}

/** A Squib on a steady TWA (wind from 000°), optionally autopiloted and max-drive trimmed. */
export function sailingSim(o: SailOpts): Simulation {
  const env = o.env ?? uniformEnvironment({ twsKn: o.twsKn ?? 10, twdDeg: 0 });
  const optimise = o.optimise ?? true;
  return new Simulation({
    params: squibParams(),
    env,
    initial: { headingDeg: o.twaDeg, speedKn: o.startKn ?? 4 },
    input: { autoMain: false, autoJib: false, ...o.input },
    lockHeading: o.lockHeading,
    controller: (s) => {
      const change: Partial<ControlInput> = {};
      if (o.hold ?? true) change.helm = autopilotHelm(s, { mode: 'twa', target: o.twaDeg * DEG });
      if (optimise && s.step % 100 === 0) Object.assign(change, optimalSheets(s));
      return change;
    },
  });
}

export const toKn = (ms: number): number => ms / KN;
