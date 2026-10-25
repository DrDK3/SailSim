import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is most of the code and changes only with its version: its own chunk stays cached across
    // deploys (as does React). The app's code is split further where panels are loaded on demand.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/sim/**/*.test.ts', 'tests/render/**/*.test.ts'],
    environment: 'node',
  },
});
