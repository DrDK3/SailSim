import { defineConfig } from 'vite';

/**
 * The headless tools that run the app's own code in Node (juniors round): the weekly targets and the club-table
 * verifier. They use the app's course library, which Vite builds (import.meta.glob), so they are bundled by Vite into
 * single files in dist-tools/, one per build of the simulation (the verifier keeps the last few: docs/DEPLOYMENT.md).
 */
export default defineConfig({
  publicDir: false,
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  build: {
    ssr: true,
    outDir: 'dist-tools',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    rolldownOptions: {
      input: { 'weekly-targets': 'tools/weekly-targets.ts', 'club-verify': 'tools/club-verify.ts' },
      output: { format: 'esm', entryFileNames: '[name].mjs' },
    },
  },
  ssr: { noExternal: true },
});
