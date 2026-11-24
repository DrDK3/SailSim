/**
 * Design handover (23 Nov 2026), item 9: releases are protected by relevant checks. Held here, from the files:
 * - Deploy publishes only after the build, the unit tests and the critical browser checks have passed for the same
 *   commit, in a job the publishing job depends on;
 * - the publishing job publishes the checked build (an artifact) and does not build again;
 * - the critical check set serves the existing build (it does not rebuild) and covers the release flows: a sailable
 *   state, input, a lesson, a race and saving;
 * - the post-deploy check still runs after Deploy.
 * (Whether a failing check really stops a publish is GitHub's `needs:` semantics; the order is what can be held here.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const job = (name: string) => {
  const start = deploy.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(0);
  const rest = deploy.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

describe('Deploy gates publication on the checks', () => {
  it('verify: build, unit tests, then the critical browser checks, then the build is kept as an artifact', () => {
    const v = job('verify');
    const at = (s: string) => {
      const i = v.indexOf(s);
      expect(i, s).toBeGreaterThan(0);
      return i;
    };
    const build = at('run: npm run build');
    const unit = at('run: npm test');
    const critical = at('playwright test -c playwright.critical.config.ts');
    const keep = at('name: site-dist');
    expect(build).toBeLessThan(unit);
    expect(unit).toBeLessThan(critical);
    expect(critical).toBeLessThan(keep);
    // The artifact upload has no `if: always()`: a failed check leaves nothing to publish.
    expect(v.slice(critical, keep)).not.toMatch(/Keep the checked build[\s\S]*if: always\(\)/);
    expect(v.slice(v.lastIndexOf('- name: Keep the checked build'))).not.toMatch(/if:/);
  });

  it('publish: needs verify, takes the checked build, does not build or install again', () => {
    const p = job('publish');
    expect(p).toMatch(/needs: verify/);
    expect(p).toMatch(/download-artifact@v\d+[\s\S]*name: site-dist/);
    expect(p).toMatch(/publish-pages\.sh dist/);
    expect(p).not.toMatch(/npm (ci|run build|test)|vite build/);
    // Pushes to gh-pages stay serialised with the live-data jobs.
    expect(p).toMatch(/group: gh-pages/);
  });

  it('the post-deploy check still follows Deploy', () => {
    const post = readFileSync('.github/workflows/post-deploy-check.yml', 'utf8');
    expect(post).toMatch(/workflows: \[Deploy\]/);
    expect(deploy).toMatch(/^name: Deploy$/m);
  });
});

describe('the critical check set', () => {
  const config = readFileSync('playwright.critical.config.ts', 'utf8');
  it('serves the build already made, and selects the tagged tests', () => {
    expect(config).toMatch(/grep: \/@critical\//);
    expect(config).toMatch(/command: 'npx vite preview --port 4173 --strictPort'/);
    expect(config).not.toMatch(/vite build/);
  });

  it('covers a sailable state, input, a lesson, a race and saving', () => {
    const tagged = readdirSync('tests/e2e')
      .filter((f) => f.endsWith('.spec.ts'))
      .flatMap((f) => readFileSync(`tests/e2e/${f}`, 'utf8').split('\n').filter((l) => l.includes("tag: '@critical'")));
    const has = (re: RegExp) => expect(tagged.some((l) => re.test(l)), String(re)).toBe(true);
    has(/simulation runs without errors/);
    has(/keyboard helm/);
    has(/steering button works from the keyboard/);
    has(/a lesson ends on a result card/);
    has(/a race against AI boats/);
    has(/a save that fails says so/);
  });
});
