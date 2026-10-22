/**
 * Golden-trace regression data: npm run golden:update
 * Runs every scenarios/*.json and stores a 1 Hz trace of key variables in tests/golden/<name>.json.
 * Regenerate ONLY after an intentional physics change, and say so in the commit message.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { goldenTrace } from '../tests/sim/goldenTrace';
import type { Scenario } from '../src/sim/index';

for (const f of readdirSync('scenarios').filter((x) => x.endsWith('.json')).sort()) {
  const scn = JSON.parse(readFileSync(`scenarios/${f}`, 'utf8')) as Scenario;
  const trace = goldenTrace(scn);
  const out = `tests/golden/${basename(f, '.json')}.json`;
  writeFileSync(out, JSON.stringify({ scenario: f, generated: new Date().toISOString().slice(0, 10), columns: trace.columns, rows: trace.rows }) + '\n');
  console.log(`${out}: ${trace.rows.length} rows`);
}
