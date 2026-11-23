#!/usr/bin/env node
// The critical browser checks' record (design handover item 9): which build was checked, in what environment, and
// each check's result, as Markdown for the Deploy run's summary. Reads Playwright's JSON report.
//   node tools/ci/critical-summary.mjs out/critical-checks.json
import { readFileSync, existsSync } from 'node:fs';
import { release, platform } from 'node:os';

const file = process.argv[2] ?? 'out/critical-checks.json';
const build = process.env.BUILD_ID ?? process.env.GITHUB_SHA ?? 'local';
let pw = 'unknown';
try {
  pw = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version;
} catch {
  // not installed here
}
const lines = ['## Critical browser checks', '', `- Build: \`${build}\``, `- Environment: ${process.env.RUNNER_OS ?? platform()} ${release()}, Node ${process.version}, Playwright ${pw}, Chromium with software WebGL (SwiftShader)`];

/** Every test in the report, with its final status (the last retry's). */
function* tests(suite, path = []) {
  for (const s of suite.suites ?? []) yield* tests(s, s.title ? [...path, s.title] : path);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.at(-1);
      yield { title: [...path, spec.title].join(' › '), status: last?.status ?? 'not run', retried: (t.results?.length ?? 0) > 1 };
    }
  }
}

if (!existsSync(file)) {
  lines.push('', `No report (${file}): the checks did not run. This build was not published.`);
} else {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const all = [...tests(report)];
  const passed = all.filter((t) => t.status === 'passed');
  lines.push(`- Result: ${passed.length} of ${all.length} passed${passed.length === all.length && all.length > 0 ? '' : ': this build is not published'}`, '', '| Check | Result |', '|---|---|');
  for (const t of all) lines.push(`| ${t.title.replace(/\|/g, '\\|')} | ${t.status}${t.retried ? ' (after a retry)' : ''} |`);
  if (all.length === 0) lines.push('| (none matched @critical) | failed |');
}
lines.push('', 'These checks show the release flows work in this build. Teaching or realism claims keep their own evidence.');
console.log(lines.join('\n'));
