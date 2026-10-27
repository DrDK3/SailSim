import { clamp, smoothstep } from '../math/angles';
import { msToKn } from '../units';
import { DT, type ControlInput, type Simulation } from '../simulation';

/**
 * How the AI crews handle the sheets: the auto-trim assist on both sails, which also eases the main when the
 * boat is overpowered (Simulation, OVERPOWERED), plus two things the assist does not do:
 *  - they ease the main on request (`depower`, 0…1) to slow down, e.g. before the start;
 *  - they flatten the sails as the breeze builds, from full power at 12 kn to fully flat at 20 kn of true wind
 *    where they are (E: a crew's rule of thumb, not a Squib tuning guide).
 */
export interface SheetState {
  /** Extra main ease currently applied for slowing (0…1 of the sheet travel). */
  ease: number;
}

const EASE_RATE = 0.6; // sheet travel per second
export const AI_FLATTEN_FROM_KN = 12;
export const AI_FLATTEN_FULL_KN = 20;

/** The flattening an AI crew sets for a true wind of `twsKn`. */
export function aiFlatten(twsKn: number): number {
  return smoothstep(AI_FLATTEN_FROM_KN, AI_FLATTEN_FULL_KN, twsKn);
}

export function aiSheetInput(sim: Simulation, st: SheetState, depower = 0): Partial<ControlInput> {
  st.ease += clamp(clamp(depower, 0, 1) - st.ease, -EASE_RATE * DT, EASE_RATE * DT);
  const s = sim.state;
  const w = sim.env.wind(sim.time, s.n, s.e);
  const c = sim.env.current(sim.time, s.n, s.e);
  const flatten = Math.round(aiFlatten(msToKn(Math.hypot(w.n - c.n, w.e - c.e))) * 100) / 100;
  if (st.ease < 1e-3) return { autoMain: true, autoJib: true, autoCrew: true, flatten };
  const auto = sim.autoSheetValue('main');
  return {
    autoMain: false,
    autoJib: depower < 0.95,
    jibSheet: depower >= 0.95 ? 1 : sim.input.jibSheet,
    mainSheet: clamp(auto + st.ease * (1 - auto), 0, 1),
    autoCrew: true,
    flatten,
  };
}
