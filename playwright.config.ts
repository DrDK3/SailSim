import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Where the deployment tests find the site: like GitHub Pages, under a sub-path. */
export const PAGES_URL = 'http://localhost:4174/squib-dart-sim/';

/** Chromium preinstalled in the development environment, or $PW_CHROMIUM; else Playwright's own (CI installs it). */
const chromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      executablePath: chromium,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    // The app and its features, on the production build served at the root.
    { name: 'app', testIgnore: /deploy\.spec\.ts/ },
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
      // Serves dist/ (built by the first server's command) the way GitHub Pages serves a project site.
      command: 'node tools/pages-server.mjs 4174 squib-dart-sim dist',
      url: PAGES_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
