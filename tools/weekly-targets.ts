/**
 * The week's model-sailed targets (juniors round §6.3), for the scheduled Action (.github/workflows/weekly-targets.yml):
 *
 *   npm run tools:build && node dist-tools/weekly-targets.mjs <site>/weekly [--at ISO-time] [--seeds 1,2,3] [--geo public/geo/]
 *
 * Writes <dir>/<week>.json (written to a temporary file and renamed, so a reader never sees half a file) and
 * <dir>/index.json (the latest week). Built with Vite (vite.tools.config.ts) because the app's course library is.
 * Exit 0 on success, 1 on failure (the app then says "targets not available this week").
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { weeklyCourse } from '../src/app/weekly';
import { sailTargets } from '../src/app/weeklyTargets';
import { loadDartAppNode } from './lib/dartGeoNode';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'out/weekly');
const at = flag('at') ? new Date(flag('at')!) : new Date();
const seeds = (flag('seeds') ?? '1,2,3').split(',').map(Number);
const geoDir = pathToFileURL(resolve(flag('geo') ?? 'public/geo') + '/');
/** Weeks of targets kept on the site (older files are removed: no history is needed). */
const KEEP_WEEKS = Number(flag('keep') ?? 4);

const w = weeklyCourse(at);
const t0 = Date.now();
const dart = w.scenario.startLocation === 'start-bay-practice' ? {} : loadDartAppNode(geoDir);
const build = process.env.BUILD_ID ?? 'local';
const file = sailTargets(w, dart, { seeds, build });
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => {
  const tmp = join(outDir, `.${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, join(outDir, name));
};
write(`${w.week.key}.json`, file);
write('index.json', { latest: w.week.key, generated: file.generated });
const old = readdirSync(outDir).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).sort().slice(0, -KEEP_WEEKS);
for (const f of old) rmSync(join(outDir, f));
console.log(`${w.week.key} ${w.name}: ${file.targets.map((t) => `${t.medal} ${t.timeS} s (${t.runs.join(', ')})`).join('; ')} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (file.targets.length < 3) {
  console.error('not every level finished');
  process.exit(1);
}
