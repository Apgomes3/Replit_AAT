import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mathNumberInputBabelPlugin from './apps/web/mathNumberInputBabelPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Node 25+ ships a built-in Web Storage `localStorage` global that is undefined unless
// --localstorage-file is given, and it shadows jsdom's window.localStorage in tests.
// Disable it in the test workers so jsdom's implementation is used.
const nodeMajor = Number(process.versions.node.split('.')[0]);
const execArgv = nodeMajor >= 25 ? ['--no-experimental-webstorage'] : [];

export default defineConfig({
  plugins: [react({ babel: { plugins: [mathNumberInputBabelPlugin] } })],
  resolve: {
    alias: {
      '@web': resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./apps/web/src/test/setup.ts'],
    include: ['./apps/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['./apps/web/e2e/**'],
    clearMocks: true,
    execArgv,
  },
});