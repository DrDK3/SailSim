/**
 * Headless scenario runner: npm run scenario -- scenarios/beat-10kn.json [out.csv]
 * Writes a CSV trace (default out/<scenario-file-name>.csv) and prints a summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { SAMPLE_COLUMNS, msToKn, runScenario, sampleRow, type Scenario } from '../src/sim/index';

const [, , scenarioPath, outArg] = process.argv;
if (!scenarioPath) {
  console.error('usage: npm run scenario -- <scenario.json> [out.csv]');
  process.exit(2);
}
const scn = JSON.parse(readFileSync(scenarioPath, 'utf8')) as Scenario;
const out = resolve(outArg ?? `out/${basename(scenarioPath, '.json')}.csv`);
const rows: string[] = [SAMPLE_COLUMNS.join(',')];
const t0 = process.hrtime.bigint();
const sim = runScenario(scn, (s) => rows.push(sampleRow(s).map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(5))).join(',')));
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rows.join('\n') + '\n');
const s = sim.snapshot();
console.log(`${scn.name}: ${scn.durationS} s simulated in ${ms.toFixed(0)} ms -> ${out} (${rows.length - 1} samples)`);
console.log(
  `final: STW ${msToKn(s.stw).toFixed(2)} kn, SOG ${msToKn(s.sog).toFixed(2)} kn, heading ${((s.heading * 180) / Math.PI).toFixed(1)}°, ` +
    `TWA ${((s.twa * 180) / Math.PI).toFixed(1)}°, heel ${((s.heel * 180) / Math.PI).toFixed(1)}°, position N ${s.n.toFixed(1)} m E ${s.e.toFixed(1)} m, state hash ${sim.stateHash()}`,
);
