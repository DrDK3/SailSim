/**
 * Model-output polar: the boat's steady state at each true wind speed and angle with the crew policy the
 * player's assists and the AI use (`crewPolicyPoint`, the one polar generator). Points where speed or heel
 * had not settled are marked *. THIS IS MODEL OUTPUT FROM ESTIMATED COEFFICIENTS, NOT MEASURED SQUIB
 * PERFORMANCE.   Usage: npm run polar [-- out.csv]
 */
import { writeFileSync } from 'node:fs';
import { crewPolicyPoint } from '../src/sim/ai/polar';
import { squibParams } from '../src/sim/boat/squib';

const twsList = [6, 10, 15, 20];
const twaList = [35, 40, 45, 52, 60, 75, 90, 110, 135, 150, 165, 175];
const params = squibParams();
const rows = [['twa_deg', ...twsList.map((t) => `stw_kn_tws${t}`), ...twsList.map((t) => `heel_deg_tws${t}`), ...twsList.map((t) => `settled_tws${t}`)].join(',')];
const table: string[] = [`| TWA | ${twsList.map((t) => `${t} kn: STW (heel)`).join(' | ')} |`, `|---|${twsList.map(() => '---').join('|')}|`];
for (const twa of twaList) {
  const pts = twsList.map((tws) => crewPolicyPoint(params, tws, twa, 150));
  rows.push([twa, ...pts.map((p) => p.stwKn.toFixed(2)), ...pts.map((p) => p.heelDeg.toFixed(1)), ...pts.map((p) => (p.settled ? 1 : 0))].join(','));
  table.push(`| ${twa}° | ${pts.map((p) => `${p.stwKn.toFixed(2)} (${p.heelDeg.toFixed(0)}°)${p.settled ? '' : '*'}`).join(' | ')} |`);
}
const out = process.argv[2] ?? 'out/model-polar.csv';
writeFileSync(out, rows.join('\n') + '\n');
console.log(table.join('\n'));
console.log('\n* not settled: speed or heel still swinging (20 s average shown)');
console.log(`written ${out}`);
