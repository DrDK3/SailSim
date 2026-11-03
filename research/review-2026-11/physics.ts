// Review diagnostics (not production): Squib physics foundations and behaviour envelope.
import { runScenario, DEG, msToKn, type Simulation } from '../../src/sim/index';
import { squibParams } from '../../src/sim/boat/squib';
import type { BoatParams } from '../../src/sim/boat/params';
const AUTO = { helm: 0, mainSheet: 0.3, jibSheet: 0.3, autoMain: true, autoJib: true, crewHike: 0.6, autoCrew: true };
const out: Record<string, unknown> = {};
const kn = (x: number) => +msToKn(x).toFixed(2);
const d = (x: number) => +(x / DEG).toFixed(1);
const steady = (tws: number, twa: number, p?: BoatParams, extra: Record<string, unknown> = {}) => {
  const sim = runScenario({ name: 's', durationS: 150, conditions: { twsKn: tws, twdDeg: 0, ...extra }, initial: { headingDeg: -twa, speedKn: 3 }, autopilot: { mode: 'twa', targetDeg: twa }, optimiseTrim: true }, undefined, p);
  return sim;
};
// 1. Symmetry: port vs starboard (TWA +x vs -x).
out.symmetry = [45, 90, 150].map((twa) => {
  const a = steady(10, twa).snapshot(); const b = steady(10, -twa).snapshot();
  return { twa, stw: [kn(a.stw), kn(b.stw)], heel: [d(a.heel), d(b.heel)], leeway: [d(a.leeway), d(b.leeway)], rudder: [d(a.rudder), d(b.rudder)] };
});
// 2. Force balance at steady state (TWA 60, 10 kn): residual surge force and yaw moment.
{ const s = steady(10, 60).snapshot(); const f = s.forces; out.forceBalance = { stw: kn(s.stw), totalX_N: +f.total.x.toFixed(2), totalY_N: +f.total.y.toFixed(2), totalN_Nm: +f.total.n.toFixed(2), drive_N: +(f.main.x + f.jib.x).toFixed(1), hull_N: +f.hull.total.toFixed(1) }; }
// 3. Current: no wind, uniform 1 kn current set 090: SOG ≈ 1 kn east, STW ≈ 0.
{ const sim = runScenario({ name: 'c', durationS: 120, conditions: { twsKn: 0, twdDeg: 0, currentSetDeg: 90, currentRateKn: 1 }, initial: { headingDeg: 0, speedKn: 0 }, input: { ...AUTO, autoMain: false, autoJib: false, mainSheet: 1, jibSheet: 1 } });
  const s = sim.snapshot(); out.currentDrift = { stw: kn(s.stw), sog: kn(s.sog), cog: d(s.cog), east_m: +s.e.toFixed(1), expected_east_m: +(1 * 0.514444 * 120).toFixed(1) }; }
// 4. Coasting to a stop: 5 kn, no wind.
{ const tr: number[][] = []; runScenario({ name: 'stop', durationS: 120, conditions: { twsKn: 0, twdDeg: 0 }, initial: { headingDeg: 0, speedKn: 5 }, input: AUTO }, (s) => tr.push([s.t, msToKn(s.stw), s.n]));
  const at = (k: number) => tr.find((r) => r[1]! <= k);
  out.coastNoWind = { t_to_3kn: at(3)?.[0], t_to_1kn: at(1)?.[0], t_to_0p25kn: at(0.25)?.[0], dist_m_to_1kn: at(1)?.[2]?.toFixed(1), monotonic: tr.every((r, i) => i === 0 || r[1]! <= tr[i - 1]![1]! + 1e-9) }; }
// 5. Acceleration from rest at TWA 60 in 10 kn (auto trim + autopilot).
{ const tr: number[][] = []; runScenario({ name: 'acc', durationS: 90, conditions: { twsKn: 10, twdDeg: 0 }, initial: { headingDeg: -60, speedKn: 0.01 }, input: AUTO, autopilot: { mode: 'twa', targetDeg: 60 } }, (s) => tr.push([s.t, msToKn(s.stw)]));
  const vmax = tr[tr.length - 1]![1]!; const at = (f: number) => tr.find((r) => r[1]! >= f * vmax)?.[0];
  out.accel10kn60 = { final_kn: +vmax.toFixed(2), t50: at(0.5), t90: at(0.9) }; }
// 6. Tack: close-hauled 10 kn (TWA 42 port→stbd) with helm hard over until through, then autopilot.
const manoeuvre = (tws: number, fromTwa: number, toTwa: number, label: string) => {
  const tr: { t: number; stw: number; twa: number; n: number; e: number; heel: number }[] = [];
  const sim = runScenario({ name: label, durationS: 120, sampleEveryS: 0.1, conditions: { twsKn: tws, twdDeg: 0 }, initial: { headingDeg: -fromTwa, speedKn: 4 }, input: AUTO, autopilot: { mode: 'twa', targetDeg: fromTwa },
    events: [{ t: 60, autopilot: { mode: 'twa', targetDeg: toTwa } }] }, (s) => tr.push({ t: s.t, stw: msToKn(s.stw), twa: s.twa / DEG, n: s.n, e: s.e, heel: s.heel / DEG }));
  const before = tr.find((r) => r.t >= 59.9)!; const after = tr[tr.length - 1]!;
  const minV = Math.min(...tr.filter((r) => r.t >= 60 && r.t <= 80).map((r) => r.stw));
  const settle = tr.find((r) => r.t > 61 && Math.abs(Math.abs(r.twa) - Math.abs(toTwa)) < 3)?.t;
  const recov = tr.find((r) => r.t > (settle ?? 61) && r.stw >= 0.9 * after.stw)?.t;
  // Distance made to windward (north) during 60-120 s vs a boat that kept its steady VMG.
  const vmgMade = (after.n - before.n); const vmgSteady = before.stw * 0.514444 * Math.cos(Math.abs(fromTwa) * DEG) * 60;
  void sim;
  return { from_kn: +before.stw.toFixed(2), min_kn: +minV.toFixed(2), turn_s: settle ? +(settle - 60).toFixed(1) : null, recover90_s: recov ? +(recov - 60).toFixed(1) : null, end_kn: +after.stw.toFixed(2), windward_loss_m: +(vmgSteady - vmgMade).toFixed(1) };
};
out.tack10 = manoeuvre(10, 42, -42, 'tack10');
out.tack6 = manoeuvre(6, 42, -42, 'tack6');
out.tack15 = manoeuvre(15, 42, -42, 'tack15');
out.gybe10 = manoeuvre(10, 150, -150, 'gybe10');
out.gybe18 = manoeuvre(18, 150, -150, 'gybe18');
// 7. Turning circle: 4 kn, no wind... use 10 kn wind beam reach, full helm for 60 s: diameter from track extent.
{ const pts: number[][] = []; runScenario({ name: 'turn', durationS: 80, conditions: { twsKn: 10, twdDeg: 0 }, initial: { headingDeg: 90, speedKn: 4.5 }, input: { ...AUTO, helm: 1 } }, (s) => { if (s.t > 20) pts.push([s.n, s.e, msToKn(s.stw)]); });
  const ns = pts.map((p) => p[0]!); const es = pts.map((p) => p[1]!);
  out.turnCircle = { diameter_m: +Math.max(Math.max(...ns) - Math.min(...ns), Math.max(...es) - Math.min(...es)).toFixed(1), meanSpeed_kn: +(pts.reduce((a, p) => a + p[2]!, 0) / pts.length).toFixed(2) }; }
// 8. Heel, leeway, helm vs wind speed close-hauled (TWA 42).
out.closeHauled = [6, 10, 14, 18, 22].map((tws) => { const s = steady(tws, 42).snapshot(); return { tws, stw: kn(s.stw), heel: d(Math.abs(s.heel)), leeway: d(Math.abs(s.leeway)), rudder: d(Math.abs(s.rudder)), helmBalance: d(s.helmBalance) }; });
// 9. Downwind: TWA 130/150/170/180 at 10 kn.
out.downwind10 = [120, 135, 150, 165, 178].map((twa) => ({ twa, stw: kn(steady(10, twa).snapshot().stw) }));
// 10. Circular-random average speed at 8 and 12 kn (TWA 0-180 uniform, excluding no-go < 38: VMG beat).
const cr = (tws: number, p?: BoatParams) => {
  const twas = [38, 45, 52, 60, 75, 90, 110, 135, 150, 165, 178];
  const v = twas.map((a) => msToKn(steady(tws, a, p).snapshot().stw));
  // Upwind sector (0-38): beat at the best VMG; downwind sector (>165): run at best down-VMG.
  const bestUp = Math.max(...v.map((x, i) => x * Math.cos(twas[i]! * DEG)));
  let tSum = 0, n = 0;
  for (let a = 0; a <= 180; a += 1) {
    let sp: number;
    if (a < 38) sp = bestUp / Math.cos(a * DEG); else { let i = twas.findIndex((x) => x >= a); if (i <= 0) i = Math.max(1, i); const a0 = twas[i - 1] ?? twas[0]!, a1 = twas[i] ?? twas[twas.length - 1]!; const f = a1 === a0 ? 0 : (a - a0) / (a1 - a0); sp = v[i - 1]! + f * (v[i]! - v[i - 1]!); }
    tSum += 3600 / sp; n++;
  }
  return { avg_s_per_nm: Math.round(tSum / n), avg_kn: +(3600 / (tSum / n)).toFixed(2) };
};
out.circularRandom = { tws8: cr(8), tws12: cr(12), referenceORC_GPH_s_per_nm: 880.1 };
// 11. Sensitivity: ±20% on selected parameters → circular-random 12 kn.
const base = squibParams();
const vary = (name: string, f: (p: BoatParams, k: number) => BoatParams) => ({ name, minus20: cr(12, f(structuredClone(base), 0.8)).avg_kn, plus20: cr(12, f(structuredClone(base), 1.2)).avg_kn });
out.sensitivity12 = [
  vary('friction form factor', (p, k) => ({ ...p, formFactor: (p as unknown as { formFactor: number }).formFactor * k } as BoatParams)),
  vary('main clMax', (p, k) => ({ ...p, main: { ...p.main, coeff: { ...p.main.coeff, clMax: p.main.coeff.clMax * k } } } as BoatParams)),
  vary('sail areas', (p, k) => ({ ...p, main: { ...p.main, area: p.main.area * k }, jib: { ...p.jib, area: p.jib.area * k } } as BoatParams)),
];
console.log(JSON.stringify(out, null, 1));
