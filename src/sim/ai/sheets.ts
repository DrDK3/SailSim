import { clamp, DEG } from '../math/angles';
import { DT, type ControlInput, type Simulation } from '../simulation';

/**
 * How the AI crews handle the sheets: the auto-trim assist on both sails, plus two things the assist does not
 * do. They ease the main when overpowered: beyond `heelLimit` the main is eased in proportion, at a finite
 * rate, as a crew dumps the main in a gust. And they ease it on request (`depower`, 0…1) to slow down, e.g.
 * before the start. The heel limit is an estimate (E).
 */
export interface SheetState {
  /** Extra main ease currently applied (0…1 of the sheet travel). */
  ease: number;
}

export const AI_HEEL_LIMIT = 24 * DEG;
const EASE_PER_RAD = 1 / (14 * DEG);
const EASE_RATE = 0.6; // sheet travel per second

export function aiSheetInput(sim: Simulation, st: SheetState, depower = 0, heelLimit = AI_HEEL_LIMIT): Partial<ControlInput> {
  const over = Math.max(0, Math.abs(sim.state.phi) - heelLimit) * EASE_PER_RAD;
  const want = clamp(Math.max(depower, over), 0, 1);
  st.ease += clamp(want - st.ease, -EASE_RATE * DT, EASE_RATE * DT);
  if (st.ease < 1e-3) return { autoMain: true, autoJib: true, autoCrew: true };
  const auto = sim.autoSheetValue('main');
  return {
    autoMain: false,
    autoJib: depower < 0.95,
    jibSheet: depower >= 0.95 ? 1 : sim.input.jibSheet,
    mainSheet: clamp(auto + st.ease * (1 - auto), 0, 1),
    autoCrew: true,
  };
}
