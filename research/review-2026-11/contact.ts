// Review diagnostics (not production): contact, grounding, damage.
import { Simulation, DEG, msToKn } from '../../src/sim/index';
import { uniformEnvironment } from '../../src/sim/env/environment';
import { Fleet } from '../../src/sim/race/fleet';
import { squibParams } from '../../src/sim/boat/squib';
const P = squibParams();
const mTot = P.mass ?? 0;
const IN = { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, crewHike: 0, autoCrew: false };
const env = uniformEnvironment({ twsKn: 0, twdDeg: 0 });
const boat = (n: number, e: number, hdg: number, kn: number) => new Simulation({ params: P, env, ownsEnvironment: false, initial: { n, e, headingDeg: hdg, speedKn: kn }, input: IN });
const ke = (s: Simulation) => { const st = (s as unknown as { state: { u: number; v: number; r: number } }).state; return 0.5 * 880 * (st.u ** 2 + st.v ** 2); };
const out: Record<string, unknown> = {};
// C1 head-on, each 3 kn (closing 6 kn), offset 0.
const run2 = (label: string, a: Simulation, b: Simulation, secs = 8) => {
  const f = new Fleet(env);
  f.add({ id: 'a', name: 'A', sailNumber: 'A', colour: 0, kind: 'human', sim: a });
  f.add({ id: 'b', name: 'B', sailNumber: 'B', colour: 0, kind: 'human', sim: b });
  const ke0 = ke(a) + ke(b); let minD = Infinity; let keMaxAfter = 0; let contactSteps = 0;
  for (let i = 0; i < secs * 100; i++) {
    const ev = f.stepOnce(); if (ev.length) contactSteps++;
    const sa = a.snapshot(false), sb = b.snapshot(false);
    minD = Math.min(minD, Math.hypot(sa.n - sb.n, sa.e - sb.e));
    if (contactSteps > 0) keMaxAfter = Math.max(keMaxAfter, ke(a) + ke(b));
  }
  const sa = a.snapshot(false), sb = b.snapshot(false);
  return { label, ke0_J: Math.round(ke0), keMaxDuringOrAfter_J: Math.round(keMaxAfter), keEnd_J: Math.round(ke(a) + ke(b)), minCentreDist_m: +minD.toFixed(2), endSpeeds_kn: [+msToKn(sa.stw).toFixed(2), +msToKn(sb.stw).toFixed(2)], endHeadings: [+(sa.heading / DEG).toFixed(0), +(sb.heading / DEG).toFixed(0)], events: f.events.length, damageA: a.damage, impactsA: a.impacts.map((x) => `${x.what}:${x.region}:${x.speed.toFixed(2)}m/s:${Math.round(x.energy)}J:${x.effects.join('/')}`) };
};
out.headOn6kn = run2('head-on 3+3 kn', boat(0, 0, 0, 3), boat(12, 0, 180, 3));
out.headOn12kn = run2('head-on 6+6 kn', boat(0, 0, 0, 6), boat(14, 0, 180, 6));
out.tbone4kn = run2('T-bone: A 4 kn into B side', boat(0, 0, 0, 4), boat(8, 0, 90, 0));
out.glancing = run2('glancing 15° at 4 kn', boat(0, -0.9, 0, 4), boat(8, 0.9, 15, 0));
// C3/C4: a thin fixed jetty (0.3 m wide line) across the path at 8 kn, and a boat pinned by wind.
const runPier = (label: string, kn: number, width: number, hdg = 0, secs = 6, windKn = 0) => {
  const e2 = uniformEnvironment({ twsKn: windKn, twdDeg: 180 });
  const s = new Simulation({ params: P, env: e2, ownsEnvironment: false, initial: { n: 0, e: 0, headingDeg: hdg, speedKn: kn }, input: windKn ? { ...IN, mainSheet: 0.3, jibSheet: 0.3, autoMain: true, autoJib: true, autoCrew: true } : IN });
  const f = new Fleet(e2);
  f.add({ id: 'a', name: 'A', sailNumber: 'A', colour: 0, kind: 'human', sim: s });
  f.setObstacles({ piers: [{ name: 'test', floating: false, line: [[-20, 8], [20, 8]], width }] });
  let maxN = -Infinity; const forces: number[] = [];
  for (let i = 0; i < secs * 100; i++) { const ev = f.stepOnce(); const sn = s.snapshot(false); maxN = Math.max(maxN, sn.n); if (ev.length) forces.push(1); else forces.push(0); }
  const sn = s.snapshot(false);
  const toggles = forces.reduce((a, x, i) => a + (i && x !== forces[i - 1] ? 1 : 0), 0);
  return { label, maxBowCentreN_m: +maxN.toFixed(2), jettyFace_n: 8 - width / 2, passedThrough: maxN > 8 + width / 2 + 3, endN: +sn.n.toFixed(2), endSpeed_kn: +msToKn(sn.stw).toFixed(2), endHeading: +(sn.heading / DEG).toFixed(0), contactOnOffToggles: toggles, damage: s.damage, impacts: s.impacts.map((x) => `${x.region}:${x.speed.toFixed(2)}m/s:${Math.round(x.energy)}J:${x.effects.join('/')}`) };
};
out.pier8kn = runPier('8 kn square into a 0.3 m jetty', 8, 0.3);
out.pier5kn20deg = runPier('5 kn at 70° (glancing 20°) to a jetty', 5, 1.5, 70);
out.pinnedByWind = runPier('pinned: 18 kn wind from 180 pressing onto the jetty, sails auto', 0.5, 1.5, 0, 40, 18);
console.log(JSON.stringify(out, null, 1));
void mTot;
