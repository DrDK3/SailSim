/**
 * Phase 6 acceptance: no secrets in the bundle. Scans every file of the built site (dist/, source maps
 * included) and the client source for credential patterns, secret-named VITE_ variables and the exact values
 * of secret-named environment variables (see tools/secrets.ts). Run by `npm run build`; exits non-zero on
 * any finding.
 *   npx tsx tools/check-secrets.ts [dist]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanText, scanViteEnvNames, secretEnvValues, type Finding } from './secrets';

const TEXT = /\.(?:html|js|mjs|css|json|map|txt|svg|xml|webmanifest)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const dist = process.argv[2] ?? 'dist';
const known = secretEnvValues(process.env);
const findings: Finding[] = [];
let files = 0;
let bytes = 0;
for (const f of walk(dist)) {
  if (!TEXT.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  files++;
  bytes += text.length;
  findings.push(...scanText(relative('.', f), text, known));
}
for (const f of walk('src')) {
  if (!/\.(?:ts|tsx)$/.test(f)) continue;
  findings.push(...scanViteEnvNames(relative('.', f), readFileSync(f, 'utf8')));
}

if (findings.length) {
  console.error(`Secret check FAILED: ${findings.length} finding(s)`);
  for (const x of findings) console.error(`  ${x.file}:${x.line}  ${x.rule}: ${x.excerpt}`);
  process.exit(1);
}
console.log(
  `Secret check passed: ${files} files (${(bytes / 1e6).toFixed(1)} MB) in ${dist}/, ${known.length} secret environment value(s) checked, no secret-named VITE_ variables.`,
);
