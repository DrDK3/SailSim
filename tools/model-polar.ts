/**
 * Model-output polar: steady speed through the water at each true wind speed/angle with the autopilot holding
 * TWA and the max-drive trim helper setting the sheets. THIS IS MODEL OUTPUT FROM ESTIMATED COEFFICIENTS,
 * NOT MEASURED SQUIB PERFORMANCE.   Usage: npm run polar [-- out.csv]
 */
import { writeFileSync } from 'node:fs';
import { DEG, msToKn, runScenario } from '../src/sim/index';

const twsList = [6, 10, 15];
const twaList = [35, 40, 45, 52, 60, 75, 90, 110, 135, 150, 165, 175];
const rows = [['twa_deg', ...twsList.map((t) => `stw_kn_tws${t}`), ...twsList.map((t) => `heel_deg_tws${t}`)].join(',')];
const table: string[] = [`| TWA | ${twsList.map((t) => `${t} kn: STW (heel)`).join(' | ')} |`, `|---|${twsList.map(() => '---').join('|')}|`];
for (const twa of twaList) {
  const stw: number[] = [];
  const heel: number[] = [];
  for (const tws of twsList) {
    const sim = runScenario({ name: 'polar', durationS: 150, conditions: { twsKn: tws, twdDeg: 0 }, initial: { headingDeg: -twa, speedKn: 4 }, autopilot: { mode: 'twa', targetDeg: twa }, optimiseTrim: true });
    const s = sim.snapshot();
    stw.push(msToKn(s.stw));
    heel.push(Math.abs(s.heel) / DEG);
  }
  rows.push([twa, ...stw.map((v) => v.toFixed(2)), ...heel.map((v) => v.toFixed(1))].join(','));
  table.push(`| ${twa}° | ${stw.map((v, i) => `${v.toFixed(2)} (${heel[i]!.toFixed(0)}°)`).join(' | ')} |`);
}
const out = process.argv[2] ?? 'out/model-polar.csv';
writeFileSync(out, rows.join('\n') + '\n');
console.log(table.join('\n'));
console.log(`\nwritten ${out}`);
