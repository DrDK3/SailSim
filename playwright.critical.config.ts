import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The critical check set (design handover item 9, 23 Nov 2026): the flows a release must not break (the app reaching
 * a sailable state, keyboard and on-screen input, a lesson to its result, a race to its results, saving and its
 * failure notice), run by Deploy on the very build it then publishes. Tests join the set with `{ tag: '@critical' }`.
 *
 * Unlike playwright.config.ts it does not build: it serves the `dist/` already built (and unit-tested) in the same
 * job, so the checked artifact is the published one. The full suite still runs in CI on every pull request.
 */
export default defineConfig({
  ...base,
  grep: /@critical/,
  projects: [{ name: 'critical', testIgnore: /deploy\.spec\.ts|juniorsClub\.spec\.ts/ }],
  reporter: [['list'], ['json', { outputFile: 'out/critical-checks.json' }], ...(process.env.CI ? ([['github']] as const) : [])],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
