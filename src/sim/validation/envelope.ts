import { DEG, wrapPi } from '../math/angles';
import { knToMs, msToKn } from '../units';
import { windVelocity, type NE } from '../boat/forces';
import { squibParams } from '../boat/squib';
import type { BoatParams } from '../boat/params';
import { uniformEnvironment, type Environment } from '../env/environment';
import { Simulation, type ControlInput } from '../simulation';
import { autopilotHelm } from '../control/autopilot';
import { aiSheetInput } from '../ai/sheets';
import { Polar, crewPolicyPoint, paramsFingerprint } from '../ai/polar';
import { AI_POLAR } from '../ai/polarData';
import { CONTACT, Fleet, type CircleObstacle } from '../race/fleet';
import { COMMITTEE_OUTLINE } from '../race/anchored';
import { BOW_X } from '../race/hull';

/**
 * The behaviour envelope (comprehensive review §4 and docs/review/ACCEPTANCE_SCENARIOS.md): the acceptance
 * scenarios run headless, deterministically, and reported. THIS IS MODEL OUTPUT FROM ESTIMATED COEFFICIENTS,
 * NOT VALIDATION: the numbers are what the simulator does, to be judged against the sailors' answers
 * (docs/review/VALIDATION_SHEET.md). Regression tests pin some of them; realism bands are agreed separately.
 */

export type Measure = number | boolean | string | null;

export interface EnvelopeResult {
  /** Scenario id (A-PH-1 …, A-CO-1 …). */
  id: string;
  title: string;
  /** Initial conditions and inputs, in words. */
  setup: string;
  rows: Record<string, Measure>[];
}

export interface EnvelopeReport {
  label: string;
  paramsFingerprint: string;
  results: EnvelopeResult[];
}

const LABEL = 'MODEL OUTPUT from estimated coefficients, not validation. Judge against the validation sheet.';
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The crew policy (the player's assists and the AI): TWA autopilot (or none), auto-trim with easing and flattening. */
function crewSim(params: BoatParams, env: Environment, initial: { headingDeg: number; speedKn: number; n?: number; e?: number }, twaAt: (t: number) => number | null, extra?: (t: number) => Partial<ControlInput>): Simulation {
  const sheets = { ease: 0 };
  return new Simulation({
    params,
    env,
    initial,
    input: { autoMain: true, autoJib: true, autoCrew: true },
    logInputs: false,
    controller: (s) => {
      const twa = twaAt(s.time);
      const helm = twa === null ? {} : { helm: autopilotHelm(s, { mode: 'twa', target: (twa === 180 ? 179.5 : twa) * DEG }) };
      return { ...aiSheetInput(s, sheets), ...helm, ...(extra?.(s.time) ?? {}) };
    },
  });
}

interface Sample {
  t: number;
  stw: number;
  twa: number;
  heel: number;
  n: number;
  e: number;
  rudder: number;
}

function sampleRun(sim: Simulation, seconds: number, every = 0.1): Sample[] {
  const out: Sample[] = [];
  const steps = Math.round(seconds / 0.01);
  const each = Math.max(1, Math.round(every / 0.01));
  for (let i = 0; i < steps; i++) {
    sim.stepOnce();
    if (i % each === 0) {
      const s = sim.state;
      const twa = wrapPi(-s.psi); // wind from 000° in these runs
      out.push({ t: sim.time, stw: msToKn(Math.hypot(s.u, s.v)), twa: twa / DEG, heel: s.phi / DEG, n: s.n, e: s.e, rudder: sim.act.rudder / DEG });
    }
  }
  return out;
}

const steadyEnv = (twsKn: number) => uniformEnvironment({ twsKn, twdDeg: 0 });

// ------------------------------------------------------------------------------------------------ physics

export function upwind(params = squibParams(), winds = [6, 10, 14, 18]): EnvelopeResult {
  const polar = new Polar(AI_POLAR);
  return {
    id: 'A-PH-1',
    title: 'Upwind at the best-VMG angle',
    setup: 'Uniform steady wind, flat water; autopilot at the polar\'s best-VMG TWA; crew policy (auto-trim, easing, flattening); 150 s, then a 20 s average.',
    rows: winds.map((tws) => {
      const twa = Math.round(polar.beat(tws).twa / DEG);
      const p = crewPolicyPoint(params, tws, twa, 150);
      return { tws_kn: tws, twa_deg: twa, stw_kn: r2(p.stwKn), vmg_kn: r2(p.vmgKn), heel_deg: r1(p.heelDeg), leeway_deg: r1(p.leewayDeg), weather_helm_deg: r1(p.rudderDeg), settled: p.settled };
    }),
  };
}

export function reaching(params = squibParams(), winds = [8, 12, 16]): EnvelopeResult {
  return {
    id: 'A-PH-2',
    title: 'Beam reach (TWA 90°)',
    setup: 'As A-PH-1, TWA 90°.',
    rows: winds.map((tws) => {
      const p = crewPolicyPoint(params, tws, 90, 150);
      return { tws_kn: tws, stw_kn: r2(p.stwKn), heel_deg: r1(p.heelDeg), weather_helm_deg: r1(p.rudderDeg), settled: p.settled };
    }),
  };
}

export function running(params = squibParams(), angles = [120, 135, 150, 165, 178]): EnvelopeResult {
  return {
    id: 'A-PH-3',
    title: 'Downwind in 10 kn, no spinnaker (not modelled yet)',
    setup: 'As A-PH-1, TWS 10 kn.',
    rows: angles.map((twa) => {
      const p = crewPolicyPoint(params, 10, twa, 150);
      return { twa_deg: twa, stw_kn: r2(p.stwKn), settled: p.settled };
    }),
  };
}

export function acceleration(params = squibParams()): EnvelopeResult {
  const sim = crewSim(params, steadyEnv(10), { headingDeg: -60, speedKn: 0.01 }, () => 60);
  const tr = sampleRun(sim, 90);
  const v = tr[tr.length - 1]!.stw;
  const at = (f: number) => {
    const hit = tr.find((r) => r.stw >= f * v);
    return hit ? r2(hit.t) : null;
  };
  return { id: 'A-PH-4', title: 'Acceleration from rest', setup: 'TWS 10 kn, TWA 60°, from 0.01 kn; crew policy.', rows: [{ final_kn: r2(v), t50_s: at(0.5), t90_s: at(0.9) }] };
}

export function coastDown(params = squibParams()): EnvelopeResult {
  const sim = new Simulation({ params, env: steadyEnv(0), initial: { headingDeg: 0, speedKn: 5 }, input: { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, autoCrew: false }, logInputs: false });
  const tr = sampleRun(sim, 120);
  const at = (k: number) => tr.find((r) => r.stw <= k);
  // Slowing throughout (a few thousandths of a knot of sway wobble allowed).
  const monotonic = tr.every((r, i) => i === 0 || r.stw <= tr[i - 1]!.stw + 0.005);
  return { id: 'A-PH-5', title: 'Coast-down from 5 kn', setup: 'No wind, sails free, helm central.', rows: [{ t_to_3kn_s: at(3) ? r2(at(3)!.t) : null, t_to_1kn_s: at(1) ? r2(at(1)!.t) : null, distance_to_1kn_m: at(1) ? r1(at(1)!.n) : null, monotonic }] };
}

/** A tack or gybe: settled on `fromTwa` for 60 s, then the autopilot turns to `toTwa`; 60 s more. */
export function manoeuvre(params: BoatParams, tws: number, fromTwa: number, toTwa: number): Record<string, Measure> {
  const sim = crewSim(params, steadyEnv(tws), { headingDeg: -fromTwa, speedKn: 4 }, (t) => (t < 60 ? fromTwa : toTwa));
  const tr = sampleRun(sim, 120);
  const before = tr.find((r) => r.t >= 59.9)!;
  const after = tr[tr.length - 1]!;
  const window = tr.filter((r) => r.t >= 60 && r.t <= 80);
  const minV = Math.min(...window.map((r) => r.stw));
  const settle = tr.find((r) => r.t > 61 && Math.abs(Math.abs(r.twa) - Math.abs(toTwa)) < 3)?.t;
  const recov = tr.find((r) => r.t > (settle ?? 61) && r.stw >= 0.9 * after.stw)?.t;
  const towardsWind = Math.cos(Math.abs(fromTwa) * DEG) >= 0;
  // Distance made to windward (north) in the last 60 s against a boat that held her steady VMG.
  const made = after.n - before.n;
  const steady = knToMs(before.stw) * Math.cos(Math.abs(fromTwa) * DEG) * 60;
  return {
    tws_kn: tws,
    from_twa_deg: fromTwa,
    to_twa_deg: toTwa,
    from_kn: r2(before.stw),
    min_kn: r2(minV),
    turn_s: settle === undefined ? null : r1(settle - 60),
    recover90_s: recov === undefined ? null : r1(recov - 60),
    end_kn: r2(after.stw),
    [towardsWind ? 'windward_loss_m' : 'leeward_loss_m']: r1(towardsWind ? steady - made : made - steady),
    max_heel_deg: r1(Math.max(...window.map((r) => Math.abs(r.heel)))),
  };
}

export function tacks(params = squibParams(), winds = [6, 10, 15]): EnvelopeResult {
  const polar = new Polar(AI_POLAR);
  return {
    id: 'A-PH-6',
    title: 'Tacks',
    setup: 'Close-hauled at the best-VMG angle, settled 60 s; the autopilot tacks onto the other side (helm as the autopilot turns it); crew policy.',
    rows: winds.map((tws) => {
      const a = Math.round(polar.beat(tws).twa / DEG);
      return manoeuvre(params, tws, a, -a);
    }),
  };
}

export function gybesAndCircle(params = squibParams()): EnvelopeResult {
  const rows = [10, 18].map((tws) => manoeuvre(params, tws, 150, -150));
  // Turning circle: 10 kn wind, from a beam reach at 4.5 kn, helm hard over; track extent after 20 s.
  const sim = new Simulation({ params, env: steadyEnv(10), initial: { headingDeg: 90, speedKn: 4.5 }, input: { helm: 1, autoMain: true, autoJib: true, autoCrew: true }, logInputs: false });
  const tr = sampleRun(sim, 80).filter((r) => r.t > 20);
  const ns = tr.map((r) => r.n);
  const es = tr.map((r) => r.e);
  rows.push({ turning_circle_m: r1(Math.max(Math.max(...ns) - Math.min(...ns), Math.max(...es) - Math.min(...es))), mean_speed_kn: r2(tr.reduce((a, r) => a + r.stw, 0) / tr.length) });
  return { id: 'A-PH-8', title: 'Gybes and the turning circle', setup: 'Gybes: TWA 150° to the other gybe. Circle: 10 kn wind, helm hard over from 4.5 kn.', rows };
}

export function irons(params = squibParams()): EnvelopeResult {
  // Head to wind, stopped, 8 kn: helm hard over and the sails on auto (there is no "back the jib" yet).
  const sim = new Simulation({ params, env: steadyEnv(8), initial: { headingDeg: 0, speedKn: 0 }, input: { helm: 1, autoMain: true, autoJib: true, autoCrew: true }, logInputs: false });
  const tr = sampleRun(sim, 60);
  const out = tr.find((r) => Math.abs(r.twa) > 50 && r.stw > 1);
  const last = tr[tr.length - 1]!;
  return {
    id: 'A-PH-11',
    title: 'Getting out of irons',
    setup: 'TWS 8 kn, head to wind, stopped; helm hard over, sails on auto-trim (no "back the jib" control yet).',
    rows: [{ recovered_s: out ? r1(out.t) : null, twa_after_60s_deg: r1(last.twa), stw_after_60s_kn: r2(last.stw), sternway: last.stw > 0.05 && Math.abs(last.twa) < 30 }],
  };
}

/** A wind that steps from `fromKn` to `toKn` over `rampS` seconds at `atS`, from 000°. */
function stepGustEnv(fromKn: number, toKn: number, atS: number, rampS: number): Environment {
  const zero: NE = { n: 0, e: 0 };
  return {
    wind: (t) => {
      const f = Math.min(1, Math.max(0, (t - atS) / rampS));
      return windVelocity(knToMs(fromKn + (toKn - fromKn) * f), 0);
    },
    current: () => zero,
    label: `Step gust ${fromKn} → ${toKn} kn`,
  };
}

export function stepGust(params = squibParams()): EnvelopeResult {
  const polar = new Polar(AI_POLAR);
  const twa = Math.round(polar.beat(10).twa / DEG);
  const sim = crewSim(params, stepGustEnv(10, 16, 60, 2), { headingDeg: -twa, speedKn: 4 }, () => twa);
  const tr = sampleRun(sim, 120);
  const before = tr.find((r) => r.t >= 59.9)!;
  const after = tr.filter((r) => r.t >= 60);
  const peak = after.reduce((a, r) => (Math.abs(r.heel) > Math.abs(a.heel) ? r : a), after[0]!);
  return {
    id: 'A-PH-12',
    title: 'Step gust close-hauled',
    setup: `TWS 10 kn close-hauled (TWA ${twa}°), settled; the wind rises to 16 kn over 2 s at 60 s; autopilot and crew policy.`,
    rows: [{
      heel_before_deg: r1(Math.abs(before.heel)),
      peak_heel_deg: r1(Math.abs(peak.heel)),
      time_to_peak_s: r1(peak.t - 60),
      stw_before_kn: r2(before.stw),
      stw_min_kn: r2(Math.min(...after.map((r) => r.stw))),
      stw_after_60s_kn: r2(tr[tr.length - 1]!.stw),
      peak_rudder_deg: r1(Math.max(...after.map((r) => Math.abs(r.rudder)))),
      max_course_error_deg: r1(Math.max(...after.map((r) => Math.abs(r.twa - twa)))),
    }],
  };
}

export function broachSweep(params = squibParams(), winds = [16, 20, 24], angles = [70, 80, 90, 100, 110, 120]): EnvelopeResult {
  const rows: Record<string, Measure>[] = [];
  for (const tws of winds) {
    for (const twa of angles) {
      const row: Record<string, Measure> = { tws_kn: tws, twa_deg: twa };
      for (const mode of ['held', 'crew'] as const) {
        // held: the auto-trim alone (no easing, no flattening); crew: the full crew policy.
        const sim = mode === 'crew'
          ? crewSim(params, steadyEnv(tws), { headingDeg: -twa, speedKn: 5 }, () => twa)
          : new Simulation({ params, env: steadyEnv(tws), initial: { headingDeg: -twa, speedKn: 5 }, input: { autoMain: true, autoJib: true, autoCrew: true }, logInputs: false, controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twa * DEG }) }) });
        const tr = sampleRun(sim, 60);
        const maxErr = Math.max(...tr.filter((r) => r.t > 10).map((r) => Math.abs(r.twa - twa)));
        row[`${mode}_broach`] = maxErr > 30;
        row[`${mode}_max_heel_deg`] = r1(Math.max(...tr.map((r) => Math.abs(r.heel))));
      }
      rows.push(row);
    }
  }
  return { id: 'A-PH-13', title: 'Broach sweep (no spinnaker)', setup: 'TWS 16/20/24 kn, TWA 70–120°, 60 s; "held" = auto-trim alone, "crew" = crew policy. Broach = more than 30° off course with the autopilot steering.', rows };
}

// ------------------------------------------------------------------------------------------------ contact

const REL: Partial<ControlInput> = { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, crewHike: 0, autoCrew: false };
const ke = (s: Simulation) => 0.5 * s.params.mass * (s.state.u ** 2 + s.state.v ** 2);

function boat(params: BoatParams, env: Environment, n: number, e: number, headingDeg: number, kn: number): Simulation {
  return new Simulation({ params, env, ownsEnvironment: false, initial: { n, e, headingDeg, speedKn: kn }, input: REL, logInputs: false });
}

function fleetOf(env: Environment, ...sims: Simulation[]): Fleet {
  const f = new Fleet(env);
  sims.forEach((s, i) => f.add({ id: `b${i}`, name: `Boat ${i + 1}`, sailNumber: `${i + 1}`, colour: 0, kind: 'human', sim: s }));
  return f;
}

const effects = (s: Simulation) => s.impacts.map((x) => `${x.region} ${x.speed.toFixed(2)} m/s ${Math.round(x.energy)} J${x.effects.length ? `: ${x.effects.join(', ')}` : ''}`).join('; ') || 'none';

/** A boat driven square or at an angle onto a fixed jetty (a line across n = 8 m). */
export function jettyImpact(params: BoatParams, kn: number, width: number, headingDeg = 0, seconds = 6): { passedThrough: boolean; restitution: number; maxKeGain: number; endKn: number; impacts: string; maxN: number } {
  const env = steadyEnv(0);
  const s = boat(params, env, 0, 0, headingDeg, kn);
  const f = fleetOf(env, s);
  f.setObstacles({ piers: [{ name: 'test jetty', floating: false, line: [[-60, 8], [60, 8]], width }] });
  const ke0 = ke(s);
  let maxN = -Infinity;
  let maxKe = 0;
  let vn = 0;
  for (let i = 0; i < seconds * 100; i++) {
    f.stepOnce();
    maxN = Math.max(maxN, s.state.n);
    maxKe = Math.max(maxKe, ke(s));
    vn = s.state.u * Math.cos(s.state.psi) - s.state.v * Math.sin(s.state.psi);
  }
  const vIn = knToMs(kn) * Math.cos(headingDeg * DEG);
  return {
    passedThrough: maxN > 8 + width / 2 + BOW_X,
    restitution: vIn > 0 ? Math.max(0, -vn) / vIn : 0,
    maxKeGain: maxKe - ke0,
    endKn: msToKn(Math.hypot(s.state.u, s.state.v)),
    impacts: effects(s),
    maxN,
  };
}

export function jettyImpacts(params = squibParams()): EnvelopeResult {
  return {
    id: 'A-CO-1',
    title: 'Square impact on a fixed jetty',
    setup: 'No wind, sails free; heading normal to a 0.3 m-wide fixed jetty; 6 s.',
    rows: [4, 8].map((kn) => {
      const r = jettyImpact(params, kn, 0.3);
      return { speed_kn: kn, restitution: r2(r.restitution), rebound_kn: r2(r.endKn), passed_through: r.passedThrough, energy_gain_J: Math.round(Math.max(0, r.maxKeGain)), impacts: r.impacts };
    }),
  };
}

/** Two boats: A at `aKn` on `aHdg` from the origin, B at (bn, be) on `bHdg` at `bKn`; 8 s. */
export function boatImpact(params: BoatParams, a: [number, number, number, number], b: [number, number, number, number]): { keGain: number; aImpacts: string; bImpacts: string; aEndKn: number; bEndKn: number } {
  const env = steadyEnv(0);
  const A = boat(params, env, a[0], a[1], a[2], a[3]);
  const B = boat(params, env, b[0], b[1], b[2], b[3]);
  const f = fleetOf(env, A, B);
  const ke0 = ke(A) + ke(B);
  let maxKe = 0;
  for (let i = 0; i < 800; i++) {
    f.stepOnce();
    maxKe = Math.max(maxKe, ke(A) + ke(B));
  }
  return { keGain: maxKe - ke0, aImpacts: effects(A), bImpacts: effects(B), aEndKn: msToKn(Math.hypot(A.state.u, A.state.v)), bEndKn: msToKn(Math.hypot(B.state.u, B.state.v)) };
}

export function boatImpacts(params = squibParams()): EnvelopeResult {
  const cases: [string, [number, number, number, number], [number, number, number, number]][] = [
    ['T-bone: A at 4 kn into B\'s side (A-CO-2)', [0, 0, 0, 4], [8, 0, 90, 0]],
    ['Head-on 3 + 3 kn (A-CO-3)', [0, 0, 0, 3], [12, 0, 180, 3]],
    ['Head-on 6 + 6 kn (A-CO-3)', [0, 0, 0, 6], [14, 0, 180, 6]],
    ['Glancing 15° at 4 kn (A-CO-4)', [0, -0.9, 0, 4], [8, 0.9, 15, 0]],
  ];
  return {
    id: 'A-CO-2/3/4',
    title: 'Boat against boat',
    setup: 'No wind, sails free; 8 s. Damage classes as the model assigns them (thresholds E).',
    rows: cases.map(([label, a, b]) => {
      const r = boatImpact(params, a, b);
      return { case: label, energy_gain_J: Math.round(Math.max(0, r.keGain)), a_end_kn: r2(r.aEndKn), b_end_kn: r2(r.bEndKn), a_impacts: r.aImpacts, b_impacts: r.bImpacts };
    }),
  };
}

/**
 * A Squib on a straight course past the committee boat's stern (the committee boat at the origin, wind from
 * 000°, so she lies with her bow to the north and her stern 5.41 m south). `overlapM` > 0 makes the Squib's
 * side overlap the drawn hull by that much; < 0 passes clear by that much.
 */
export function committeePass(params: BoatParams, overlapM: number): { contact: boolean; firstContactE: number | null } {
  const env = steadyEnv(6);
  const stern = -COMMITTEE_OUTLINE.x.reduce((a, x) => Math.max(a, -x), 0);
  const half = params.beam / 2;
  // Sailing east (heading 090°): the port side faces north, toward the stern. The Squib's widest point is
  // used, at the committee boat's stern (her transom spans the middle 0.64 of her beam).
  const s = new Simulation({ params, env, ownsEnvironment: false, initial: { n: stern - half + overlapM, e: -12, headingDeg: 90, speedKn: 2 }, input: { ...REL, helm: 0 }, logInputs: false, lockHeading: true });
  const f = fleetOf(env, s);
  const cb: CircleObstacle = { id: 'mark-RC', label: 'Committee boat', kind: 'committee-boat', n: 0, e: 0, radius: COMMITTEE_OUTLINE.radius, stiffness: CONTACT.hardStiffness, damping: CONTACT.hardDamping, hull: COMMITTEE_OUTLINE };
  f.setObstacles({ marks: [cb] });
  let first: number | null = null;
  for (let i = 0; i < 1500 && first === null; i++) {
    const ev = f.stepOnce();
    if (ev.some((x) => x.kind === 'committee-boat')) first = s.state.e;
  }
  return { contact: first !== null, firstContactE: first };
}

export function committeeEdge(params = squibParams()): EnvelopeResult {
  return {
    id: 'A-CO-5',
    title: 'The committee boat collides where she is drawn',
    setup: 'SAMARITAN (10.82 × 3.57 m) at the mark, head to a 6 kn wind; a Squib at 2 kn on a fixed heading past her stern.',
    rows: [0.5, 0.2, -0.2, -0.5].map((m) => {
      const r = committeePass(params, m);
      return { overlap_m: m, contact: r.contact };
    }),
  };
}

export function pinnedOnJetty(params = squibParams()): EnvelopeResult {
  const env = uniformEnvironment({ twsKn: 20, twdDeg: 180 });
  const s = new Simulation({ params, env, ownsEnvironment: false, initial: { n: 6, e: 0, headingDeg: 90, speedKn: 0 }, input: REL, logInputs: false });
  const f = fleetOf(env, s);
  f.setObstacles({ piers: [{ name: 'test pontoon', floating: true, line: [[-50, 8], [80, 8]], width: 2 }] });
  const ns: number[] = [];
  for (let i = 0; i < 4000; i++) {
    f.stepOnce();
    ns.push(s.state.n);
  }
  const last = ns.slice(-1000);
  return { id: 'A-CO-7c', title: 'Pinned against a pontoon by 20 kn of wind', setup: 'Stopped beam-on, sails free, wind pressing her onto a floating pontoon; 40 s.', rows: [{ jitter_last_10s_mm: r1((Math.max(...last) - Math.min(...last)) * 1000) }] };
}

export function pileTunnelling(params = squibParams()): EnvelopeResult {
  // 14 kn into a 0.3 m pile (a jetty 0.3 m long and 0.3 m wide), dead centre.
  const env = steadyEnv(0);
  const s = boat(params, env, 0, 0, 0, 14);
  const f = fleetOf(env, s);
  f.setObstacles({ piers: [{ name: 'pile', floating: false, line: [[-0.15, 8], [0.15, 8]], width: 0.3 }] });
  let maxN = -Infinity;
  for (let i = 0; i < 400; i++) {
    f.stepOnce();
    maxN = Math.max(maxN, s.state.n);
  }
  return { id: 'A-CO-7a', title: 'No tunnelling at 14 kn into a 0.3 m pile', setup: 'No wind, sails free, dead centre; 4 s.', rows: [{ passed_through: maxN > 8 + 0.15 + BOW_X, max_cg_n_m: r2(maxN) }] };
}

// ------------------------------------------------------------------------------------------------ report

/** Every scenario, in the order of the acceptance list. Takes a few minutes. */
export function runEnvelope(params = squibParams()): EnvelopeReport {
  return {
    label: LABEL,
    paramsFingerprint: paramsFingerprint(params),
    results: [
      upwind(params), reaching(params), running(params), acceleration(params), coastDown(params), tacks(params), gybesAndCircle(params),
      irons(params), stepGust(params), broachSweep(params),
      jettyImpacts(params), boatImpacts(params), committeeEdge(params), pileTunnelling(params), pinnedOnJetty(params),
    ],
  };
}

/** The report as Markdown tables. */
export function envelopeMarkdown(r: EnvelopeReport): string {
  const out = ['# Behaviour envelope', '', `**${r.label}**`, '', `Boat parameters fingerprint: \`${r.paramsFingerprint}\`. Scenarios: docs/review/ACCEPTANCE_SCENARIOS.md.`, ''];
  for (const res of r.results) {
    out.push(`## ${res.id} · ${res.title}`, '', res.setup, '');
    const cols = [...new Set(res.rows.flatMap((row) => Object.keys(row)))];
    out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
    for (const row of res.rows) out.push(`| ${cols.map((c) => (row[c] === undefined || row[c] === null ? '–' : String(row[c]))).join(' | ')} |`);
    out.push('');
  }
  return out.join('\n');
}
