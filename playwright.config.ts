import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Where the deployment tests find the site: like GitHub Pages, under a sub-path. */
export const PAGES_URL = 'http://localhost:4174/squib-dart-sim/';

/** Chromium preinstalled in the development environment, or $PW_CHROMIUM; else Playwright's own (CI installs it). */
const chromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  // Every test opens its own page: CI shards split by test, not by file (whole files left one shard with 23 tests
  // and another with none).
  fullyParallel: true,
  // CI runners draw the 3D scene in software, several times slower than a desktop: allow more time there, run
  // one browser per job, and retry once (a test that passes only on retry is reported as flaky).
  timeout: process.env.CI ? 180_000 : 90_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  // On GitHub Actions, failures also become annotations on the run (readable without downloading the log).
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      executablePath: chromium,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    viewport: { width: 1280, height: 800 },
    // The first-visit welcome dialog is tested on its own (tests/e2e/ux.spec.ts); elsewhere it is already seen.
    storageState: {
      cookies: [],
      origins: ['http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175'].map((origin) => ({ origin, localStorage: [{ name: 'squib.welcomed.v1', value: '1' }] })),
    },
  },
  projects: [
    // The app and its features, on the production build served at the root.
    { name: 'app', testIgnore: /deploy\.spec\.ts|juniorsClub\.spec\.ts/ },
    // The club table against the local mock endpoint (a build with the flag on).
    { name: 'club', testMatch: /juniorsClub\.spec\.ts/, use: { baseURL: 'http://localhost:4175' } },
    // Phase 6 acceptance: the production build served under a sub-path, missing and stale data.
    { name: 'deploy', testMatch: /deploy\.spec\.ts/, use: { baseURL: PAGES_URL } },
  ],
  webServer: [
    {
      command: 'npx vite build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The club table (juniors round, layer B): a build with the flag on, pointed at the local mock endpoint, and
      // the headless tools (the verifier) built from the same code. Only tests/e2e/juniorsClub.spec.ts uses it.
      command: 'VITE_CLUB_TABLE_URL=http://localhost:8787 npx vite build --outDir dist-club --emptyOutDir && npx vite build -c vite.tools.config.ts && npx vite preview --outDir dist-club --port 4175 --strictPort',
      url: 'http://localhost:4175',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: 'node server/club-table/mock.mjs 8787 e2e-admin-token',
      url: 'http://localhost:8787/status?token=' + '0'.repeat(64),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Serves dist/ (built by the first server's command) the way GitHub Pages serves a project site.
      command: 'node tools/pages-server.mjs 4174 squib-dart-sim dist',
      url: PAGES_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
