import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.venv/**', '.cache/**', 'dist', 'node_modules', 'research', 'out', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Simulation purity: the sim core must run unchanged in Node, the browser and a worker.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['three', 'three/*', 'react', 'react-dom', 'react/*'], message: 'src/sim must not import rendering or UI libraries.' },
          { group: ['**/render/**', '**/ui/**', '**/app/**'], message: 'src/sim must not depend on render/ui/app.' },
        ],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'requestAnimationFrame'],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/sim/math/rng.ts.' },
        { object: 'Date', property: 'now', message: 'Simulation time must not depend on the wall clock.' }],
    },
  },
);
