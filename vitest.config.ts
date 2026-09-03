import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mathNumberInputBabelPlugin from './apps/web/mathNumberInputBabelPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    clearMocks: true,
  },
});