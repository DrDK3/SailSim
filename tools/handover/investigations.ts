/**
 * Design handover of 23 Nov 2026: the software part of two investigations, run headless on the model.
 * MODEL OUTPUT FROM ESTIMATED COEFFICIENTS, NOT VALIDATION: for sailors and instructors to review.
 *
 *  - Item 16 (sail controls): at fixed conditions, what each control (kicker, cunningham, outhaul, jib lead) does to
 *    speed, VMG, heel and helm, one at a time from the default, with the auto-trim on and the helm on a TWA autopilot.
 *  - Item 17 (recoverable mistakes): from stopped head to wind (in irons), on each side, whether the controls the
 *    player has (helm hard over; helm and sheets eased) get the boat sailing again, and how long it takes.
 *
 *   npx tsx tools/handover/investigations.ts        (writes out/handover-investigations.json and .md)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEG, wrapPi } from '../../src/sim/math/angles';
import { msToKn } from '../../src/sim/units';
import { squibParams } from '../../src/sim/boat/squib';
import { uniformEnvironment } from '../../src/sim/env/environment';
import { Simulation, type ControlInput } from '../../src/sim/simulation';
import { autopilotHelm } from '../../src/sim/control/autopilot';

const params = squibParams();
const env = (tws: number) => uniformEnvironment({ twsKn: tws, twdDeg: 0 });
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Mean speed, VMG, heel and rudder over the last `measure` seconds of `seconds`, at a TWA held by the autopilot. */
function steady(tws: number, twaDeg: number, extra: Partial<ControlInput>, seconds = 60, measure = 30) {
  const sim = new Simulation({
    params,
    env: env(tws),
    initial: { headingDeg: -twaDeg, speedKn: 4 },
    input: { autoMain: true, autoJib: true, autoCrew: true, ...extra },
    logInputs: false,
    controller: (s) => ({ helm: autopilotHelm(s, { mode: 'twa', target: twaDeg * DEG }) }),
  });
  let n = 0;
  const acc = { stw: 0, vmg: 0, heel: 0, rudder: 0 };
  const steps = Math.round(seconds / 0.01);
  for (let i = 0; i < steps; i++) {
    sim.stepOnce();
    if (i >= steps - measure / 0.01 && i % 10 === 0) {
      const sn = sim.snapshot(false);
      acc.stw += msToKn(sn.stw);
      acc.vmg += msToKn(sn.vmg);
      acc.heel += Math.abs(sn.heel) / DEG;
      acc.rudder += Math.abs(sn.rudder) / DEG;
      n++;
    }
  }
  return { stw: r2(acc.stw / n), vmg: r2(acc.vmg / n), heel: r1(acc.heel / n), rudder: r1(acc.rudder / n) };
}

function sailControls() {
  const rows: Record<string, unknown>[] = [];
  for (const tws of [8, 14]) {
    for (const twa of [45, 90]) {
      const base = steady(tws, twa, {});
      rows.push({ tws, twa, control: 'default (all 0, lead set)', ...base });
      for (const [control, values] of [
        ['kicker', [1]],
        ['cunningham', [1]],
        ['outhaul', [1]],
        ['jibLead', [-1, 1]],
      ] as const) {
        for (const v of values) {
          const m = steady(tws, twa, { [control]: v });
          rows.push({ tws, twa, control: `${control} ${v}`, ...m, dStw: r2(m.stw - base.stw), dHeel: r1(m.heel - base.heel), dRudder: r1(m.rudder - base.rudder) });
        }
      }
    }
  }
  return rows;
}

/** From stopped head to wind, a recovery policy for up to 60 s: when (if) the boat is sailing again. */
type Policy = 'helm' | 'helm+ease' | 'ease, then trim';
function irons(tws: number, side: 1 | -1, policy: Policy) {
  const sim = new Simulation({
    params,
    env: env(tws),
    initial: { headingDeg: side * 2, speedKn: 0.2 },
    input: { autoMain: policy === 'helm', autoJib: policy === 'helm', autoCrew: true, helm: side, ...(policy !== 'helm' ? { mainSheet: 1, jibSheet: 1 } : {}) },
    logInputs: false,
    // Ease, then trim: sheets out and helm over until the bow is 60° off the wind, then the auto-trim sheets in.
    ...(policy === 'ease, then trim'
      ? { controller: (st: Simulation) => (Math.abs(wrapPi(-st.state.psi)) / DEG > 60 ? { autoMain: true, autoJib: true, helm: 0 } : { autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1, helm: side }) }
      : {}),
  });
  for (let i = 0; i < 6000; i++) {
    sim.stepOnce();
    const sn = sim.snapshot(false);
    const twa = Math.abs(wrapPi(-sim.state.psi)) / DEG;
    if (twa > 50 && msToKn(sn.stw) > 1.5) return { recovered: true, seconds: r1(sn.t), twa: r1(twa) };
  }
  const sn = sim.snapshot(false);
  return { recovered: false, seconds: 60, twa: r1(Math.abs(wrapPi(-sim.state.psi)) / DEG), stw: r2(msToKn(sn.stw)) };
}

function ironsTable() {
  const rows: Record<string, unknown>[] = [];
  for (const tws of [6, 10, 16]) for (const side of [1, -1] as const) for (const policy of ['helm', 'helm+ease', 'ease, then trim'] as const) rows.push({ tws, side: side === 1 ? 'helm to starboard' : 'helm to port', policy, ...irons(tws, side, policy) });
  return rows;
}

const label = 'MODEL OUTPUT from estimated coefficients, not validation.';
const report = { label, created: new Date().toISOString(), sailControls: sailControls(), irons: ironsTable() };
mkdirSync('out', { recursive: true });
writeFileSync('out/handover-investigations.json', JSON.stringify(report, null, 1) + '\n');
const table = (rows: Record<string, unknown>[]) => {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${keys.map((k) => String(r[k] ?? '')).join(' | ')} |`)].join('\n');
};
const md = `# Handover investigations (model output)\n\n${label}\n\n## Item 16: sail controls, one at a time\n\n${table(report.sailControls)}\n\n## Item 17: out of irons\n\n${table(report.irons)}\n`;
writeFileSync('out/handover-investigations.md', md);
console.log(md);
