import { DEG, msToKn, runScenario, type Scenario } from '../../src/sim/index';

export const GOLDEN_COLUMNS = ['t', 'n', 'e', 'heading_deg', 'stw_kn', 'heel_deg', 'rudder_deg', 'boom_deg'] as const;

/** Tolerances per column for the regression comparison. */
export const GOLDEN_TOLERANCE: Record<(typeof GOLDEN_COLUMNS)[number], number> = {
  t: 1e-9, n: 0.05, e: 0.05, heading_deg: 0.05, stw_kn: 0.005, heel_deg: 0.05, rudder_deg: 0.05, boom_deg: 0.1,
};

/** Package B: scenarios with the spinnaker aboard add its state (how much is up, how full, the pole's side). */
export const SPIN_COLUMNS = ['spin_deployed', 'spin_fill', 'spin_pole'] as const;
export const SPIN_TOLERANCE: Record<(typeof SPIN_COLUMNS)[number], number> = { spin_deployed: 0.005, spin_fill: 0.005, spin_pole: 0 };

export function goldenTrace(scn: Scenario): { columns: readonly string[]; rows: number[][] } {
  const rows: number[][] = [];
  runScenario({ ...scn, sampleEveryS: 1 }, (s) => {
    const row = [s.t, s.n, s.e, s.heading / DEG, msToKn(s.stw), s.heel / DEG, s.rudder / DEG, s.boomMain / DEG];
    if (scn.spinnaker) row.push(s.spin?.deployed ?? 0, s.spin?.fill ?? 0, s.spin?.poleSide ?? 0);
    rows.push(row.map((v) => Number(v.toFixed(6))));
  });
  return { columns: scn.spinnaker ? [...GOLDEN_COLUMNS, ...SPIN_COLUMNS] : GOLDEN_COLUMNS, rows };
}
