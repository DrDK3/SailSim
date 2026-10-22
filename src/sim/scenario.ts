import { DEG } from './math/angles';
import { msToKn } from './units';
import { autopilotHelm, type AutopilotSettings } from './control/autopilot';
import { optimalSheets } from './control/trim';
import { uniformEnvironment, type UniformConditions } from './env/environment';
import { buildConditions, type ConditionsSettings } from './env/conditions';
import { squibParams } from './boat/squib';
import type { BoatParams } from './boat/params';
import { Simulation, type BoatSnapshot, type ControlInput, type InitialConditions } from './simulation';

/** A repeatable, data-only description of a run (see scenarios/*.json). */
export interface Scenario {
  name: string;
  description?: string;
  durationS: number;
  sampleEveryS?: number;
  /** Either simple uniform steady conditions, or a full ConditionsSettings (gusts, tide, live data…). */
  conditions: UniformConditions | ConditionsSettings;
  initial: InitialConditions;
  input?: Partial<ControlInput>;
  /** Time-tagged input changes. */
  events?: { t: number; input?: Partial<ControlInput>; autopilot?: ScenarioAutopilot | null; optimiseTrim?: boolean }[];
  /** Autopilot active from t = 0 (degrees in the JSON). */
  autopilot?: ScenarioAutopilot;
  /** Keep the sheets at the max-drive setting throughout. */
  optimiseTrim?: boolean;
}

export interface ScenarioAutopilot {
  mode: 'heading' | 'twa';
  targetDeg: number;
}

export const SAMPLE_COLUMNS = [
  't', 'n', 'e', 'heading_deg', 'stw_kn', 'sog_kn', 'cog_deg', 'u_ms', 'v_ms', 'r_degs', 'leeway_deg',
  'tws_kn', 'twa_deg', 'aws_kn', 'awa_deg', 'vmg_kn', 'heel_deg', 'rudder_deg', 'boom_main_deg', 'boom_jib_deg',
  'alpha_main_deg', 'alpha_jib_deg', 'luff_main', 'luff_jib', 'drive_n', 'side_n', 'yaw_nm', 'resistance_n',
] as const;

export function sampleRow(s: BoatSnapshot): number[] {
  const f = s.forces;
  return [
    s.t, s.n, s.e, s.heading / DEG, msToKn(s.stw), msToKn(s.sog), s.cog / DEG, s.u, s.v, s.r / DEG, s.leeway / DEG,
    msToKn(s.tws), s.twa / DEG, msToKn(s.aws), s.awa / DEG, msToKn(s.vmg), s.heel / DEG, s.rudder / DEG,
    s.boomMain / DEG, s.boomJib / DEG, f.main.incidence / DEG, f.jib.incidence / DEG, f.main.luff, f.jib.luff,
    f.main.x + f.jib.x, f.main.y + f.jib.y, f.total.n, f.hull.total,
  ];
}

/**
 * Run a scenario headlessly. Deterministic: the same scenario always produces the same samples. `params`
 * replaces the default Squib parameters (calibration studies); scenario files themselves never carry params.
 */
export function runScenario(scn: Scenario, onSample?: (s: BoatSnapshot) => void, params: BoatParams = squibParams()): Simulation {
  let ap: AutopilotSettings | null = scn.autopilot ? { mode: scn.autopilot.mode, target: scn.autopilot.targetDeg * DEG } : null;
  let optimise = scn.optimiseTrim ?? false;
  const events = [...(scn.events ?? [])].sort((a, b) => a.t - b.t);
  let next = 0;
  const sim = new Simulation({
    params,
    env: 'weather' in scn.conditions ? buildConditions(scn.conditions).env : uniformEnvironment(scn.conditions),
    initial: scn.initial,
    input: scn.input,
    controller: (s) => {
      while (next < events.length && events[next]!.t <= s.time + 1e-9) {
        const ev = events[next++]!;
        if (ev.input) s.setInput(ev.input);
        if (ev.autopilot !== undefined) ap = ev.autopilot ? { mode: ev.autopilot.mode, target: ev.autopilot.targetDeg * DEG } : null;
        if (ev.optimiseTrim !== undefined) optimise = ev.optimiseTrim;
      }
      const change: Partial<ControlInput> = {};
      if (ap) change.helm = autopilotHelm(s, ap);
      if (optimise && s.step % 10 === 0) Object.assign(change, optimalSheets(s), { autoMain: false, autoJib: false });
      return change;
    },
  });
  const every = Math.max(1, Math.round((scn.sampleEveryS ?? 0.1) / 0.01));
  onSample?.(sim.snapshot());
  const steps = Math.round(scn.durationS / 0.01);
  for (let i = 0; i < steps; i++) {
    sim.stepOnce();
    if (onSample && sim.step % every === 0) onSample(sim.snapshot());
  }
  return sim;
}
