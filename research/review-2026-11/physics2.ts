import { runScenario, DEG, msToKn } from '../../src/sim/index';
import { squibParams } from '../../src/sim/boat/squib';
import type { BoatParams } from '../../src/sim/boat/params';
const steady = (tws: number, twa: number, p?: BoatParams, dur = 150) => runScenario({ name: 's', durationS: dur, conditions: { twsKn: tws, twdDeg: 0 }, initial: { headingDeg: -twa, speedKn: 3 }, autopilot: { mode: 'twa', targetDeg: twa }, optimiseTrim: true }, undefined, p).snapshot();
const base = squibParams();
console.log('residuary table (Fn, R/W):', JSON.stringify(base.residuary));
for (const [name, k] of [['residuary x0.8', 0.8], ['residuary x1.2', 1.2]] as const) {
  const p = { ...structuredClone(base), residuary: base.residuary.map(([fn, r]) => [fn, r * k] as [number, number]) };
  console.log(name, [6, 12, 18].map((tws) => [60, 90].map((twa) => `${tws}kn/${twa}°: ${msToKn(steady(tws, twa, p).stw).toFixed(2)}`).join(' ')).join(' | '));
}
console.log('base          ', [6, 12, 18].map((tws) => [60, 90].map((twa) => `${tws}kn/${twa}°: ${msToKn(steady(tws, twa).stw).toFixed(2)}`).join(' ')).join(' | '));
// 22 kn close-hauled anomaly: trace.
const tr: string[] = [];
runScenario({ name: 'a', durationS: 150, conditions: { twsKn: 22, twdDeg: 0 }, initial: { headingDeg: -42, speedKn: 3 }, autopilot: { mode: 'twa', targetDeg: 42 }, optimiseTrim: true }, (s) => { if (Math.abs(s.t % 15) < 0.05) tr.push(`t${s.t.toFixed(0)} twa${(s.twa / DEG).toFixed(0)} stw${msToKn(s.stw).toFixed(1)} heel${(s.heel / DEG).toFixed(0)} boom${(s.boomMain / DEG).toFixed(0)} luffMain${s.forces.main.luff.toFixed(2)} rud${(s.rudder / DEG).toFixed(0)} water${s.cockpitWater.toFixed(0)}`); });
console.log(tr.join('\n'));
// Same with the app's auto-trim (crew-like) instead of the max-drive helper.
const tr2: string[] = [];
runScenario({ name: 'b', durationS: 150, conditions: { twsKn: 22, twdDeg: 0 }, initial: { headingDeg: -42, speedKn: 3 }, autopilot: { mode: 'twa', targetDeg: 42 }, input: { helm: 0, mainSheet: 0.3, jibSheet: 0.3, autoMain: true, autoJib: true, crewHike: 0.6, autoCrew: true, flatten: 1 } }, (s) => { if (Math.abs(s.t % 30) < 0.05) tr2.push(`t${s.t.toFixed(0)} stw${msToKn(s.stw).toFixed(1)} heel${(s.heel / DEG).toFixed(0)} boom${(s.boomMain / DEG).toFixed(0)}`); });
console.log('auto trim + flatten 22 kn:', tr2.join(' | '));
