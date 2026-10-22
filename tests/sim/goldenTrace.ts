import { DEG, msToKn, runScenario, type Scenario } from '../../src/sim/index';

export const GOLDEN_COLUMNS = ['t', 'n', 'e', 'heading_deg', 'stw_kn', 'heel_deg', 'rudder_deg', 'boom_deg'] as const;

/** Tolerances per column for the regression comparison. */
export const GOLDEN_TOLERANCE: Record<(typeof GOLDEN_COLUMNS)[number], number> = {
  t: 1e-9, n: 0.05, e: 0.05, heading_deg: 0.05, stw_kn: 0.005, heel_deg: 0.05, rudder_deg: 0.05, boom_deg: 0.1,
};

export function goldenTrace(scn: Scenario): { columns: readonly string[]; rows: number[][] } {
  const rows: number[][] = [];
  runScenario({ ...scn, sampleEveryS: 1 }, (s) => {
    rows.push([s.t, s.n, s.e, s.heading / DEG, msToKn(s.stw), s.heel / DEG, s.rudder / DEG, s.boomMain / DEG].map((v) => Number(v.toFixed(6))));
  });
  return { columns: GOLDEN_COLUMNS, rows };
}
