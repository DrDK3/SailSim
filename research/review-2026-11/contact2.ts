import { Simulation, DEG, msToKn } from '../../src/sim/index';
import { uniformEnvironment } from '../../src/sim/env/environment';
import { buildConditions } from '../../src/sim/env/conditions';
import { Fleet } from '../../src/sim/race/fleet';
import { squibParams } from '../../src/sim/boat/squib';
import { loadDartGeoNode } from '../../tools/lib/dartGeoNode';
const P = squibParams();
const REL = { helm: 0, mainSheet: 1, jibSheet: 1, autoMain: false, autoJib: false, crewHike: 0, autoCrew: false };
const out: Record<string, unknown> = {};
// Glancing: 5 kn at 20° to a jetty face (heading 20° off parallel, approaching).
{ const env = uniformEnvironment({ twsKn: 0, twdDeg: 0 });
  const s = new Simulation({ params: P, env, ownsEnvironment: false, initial: { n: 4, e: 0, headingDeg: 70, speedKn: 5 }, input: REL });
  const f = new Fleet(env); f.add({ id: 'a', name: 'A', sailNumber: 'A', colour: 0, kind: 'human', sim: s });
  f.setObstacles({ piers: [{ name: 't', floating: false, line: [[-50, 8], [80, 8]], width: 1.5 }] });
  const tr: string[] = []; let inContact = 0;
  for (let i = 0; i < 1000; i++) { const ev = f.stepOnce(); if (ev.length) inContact++; if (i % 100 === 0) { const sn = s.snapshot(false); tr.push(`t${(i / 100).toFixed(0)} n${sn.n.toFixed(2)} hdg${(sn.heading / DEG).toFixed(0)} ${msToKn(sn.stw).toFixed(2)}kn`); } }
  out.glancingJetty = { trace: tr, stepsInContact: inContact, impacts: s.impacts.map((x) => `${x.region}:${x.speed.toFixed(2)}m/s:${Math.round(x.energy)}J:${x.effects.join('/')}`), events: f.events.length }; }
// Pinned: stopped boat beam-on, sails released, 20 kn wind pressing it onto the jetty.
{ const env = uniformEnvironment({ twsKn: 20, twdDeg: 180 });
  const s = new Simulation({ params: P, env, ownsEnvironment: false, initial: { n: 6.0, e: 0, headingDeg: 90, speedKn: 0 }, input: REL });
  const f = new Fleet(env); f.add({ id: 'a', name: 'A', sailNumber: 'A', colour: 0, kind: 'human', sim: s });
  f.setObstacles({ piers: [{ name: 't', floating: true, line: [[-50, 8], [80, 8]], width: 2 }] });
  const ns: number[] = []; const hs: number[] = [];
  for (let i = 0; i < 4000; i++) { f.stepOnce(); const sn = s.snapshot(false); ns.push(sn.n); hs.push(sn.heel / DEG); }
  const last = ns.slice(-1000); const mean = last.reduce((a, x) => a + x, 0) / last.length; const jit = Math.max(...last) - Math.min(...last);
  out.pinned = { meanN_last10s: +mean.toFixed(3), jitter_last10s_m: +jit.toFixed(4), heelRange_last10s: [+Math.min(...hs.slice(-1000)).toFixed(1), +Math.max(...hs.slice(-1000)).toFixed(1)], drift_e_m: +s.snapshot(false).e.toFixed(2), impacts: s.impacts.length, events: f.events.length }; }
// Grounding and release on a rising tide (River Dart bed; manual tide, HW in 3 h).
{ const geo = loadDartGeoNode();
  const cond = { startTime: '2026-07-15T09:00:00Z', weather: { source: 'manual' as const, twsKn: 6, twdDeg: 90 }, gusts: { preset: 'steady' as const, seed: 1 }, tide: { mode: 'manual' as const, hwTime: '2026-07-15T12:00:00Z', hwHeightM: 4.6, lwHeightM: 1.2 }, current: { mode: 'none' as const } };
  const env = buildConditions(cond, geo).env;
  // Off Dartmouth, sailing west at the bank (as the e2e grounding test: off RDYC, heading 270).
  const s = new Simulation({ params: P, env, seabed: geo, initial: { n: 0, e: -150, headingDeg: 270, speedKn: 3 }, input: { ...REL, mainSheet: 0.5, jibSheet: 0.5, autoMain: true, autoJib: true, autoCrew: true } });
  let groundedAt = -1, releasedAt = -1; const lv: string[] = [];
  for (let i = 0; i < 3 * 3600 * 100; i++) {
    s.stepOnce();
    if (i % 100 !== 0) continue;
    const sn = s.snapshot(false);
    if (groundedAt < 0 && sn.grounded) groundedAt = sn.t;
    if (groundedAt >= 0 && releasedAt < 0 && !sn.grounded) { releasedAt = sn.t; break; }
    if (i % (600 * 100) === 0) lv.push(`t${(sn.t / 60).toFixed(0)}min water${sn.waterLevel.toFixed(2)} depth${sn.depthAtKeel.toFixed(2)} g${sn.grounded ? 1 : 0} sog${msToKn(sn.sog).toFixed(2)}`);
  }
  out.groundRelease = { groundedAt_s: groundedAt, releasedAt_s: releasedAt, trace: lv, impacts: s.impacts.map((x) => `${x.region}:${x.speed.toFixed(2)}m/s:${Math.round(x.energy)}J:${x.effects.join('/')}`), damage: s.damage }; }
console.log(JSON.stringify(out, null, 1));
