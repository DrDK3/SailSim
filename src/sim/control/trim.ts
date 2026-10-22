import { computeForces, sailTarget, sheetLimit } from '../boat/dynamics';
import type { SailParams } from '../boat/params';
import type { Simulation } from '../simulation';

/**
 * Find the sheet settings that maximise sail drive (forward force) at the boat's current state, assuming
 * each sail settles at its sheet-limited angle. Used by the acceptance tests ("properly trimmed") and as a
 * reference for trim indicators. Each sail is optimised independently (no jib–main interaction in Phase 1).
 */
export function optimalSheets(sim: Simulation, steps = 100): { mainSheet: number; jibSheet: number } {
  const awa = sim.effectiveAwa();
  const best = (sail: 'main' | 'jib'): number => {
    const sp: SailParams = sim.params[sail];
    const side = sail === 'main' ? sim.act.mainSide : sim.act.jibSide;
    let bestSheet = 0;
    let bestDrive = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const sheet = i / steps;
      const angle = sailTarget(side, awa, sheetLimit(sp, sheet));
      const act = { ...sim.act, [sail === 'main' ? 'boomMain' : 'boomJib']: angle };
      const s = sim.state;
      const f = computeForces(sim.params, s, act, sim.env.wind(sim.time, s.n, s.e), sim.env.current(sim.time, s.n, s.e), sim.fluids);
      const drive = sail === 'main' ? f.main.x : f.jib.x;
      if (drive > bestDrive + 1e-9) {
        bestDrive = drive;
        bestSheet = sheet;
      }
    }
    return bestSheet;
  };
  return { mainSheet: best('main'), jibSheet: best('jib') };
}
