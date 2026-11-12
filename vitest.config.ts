import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'dotenv';
import mathNumberInputBabelPlugin from './apps/web/mathNumberInputBabelPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Node 25+ ships a built-in Web Storage `localStorage` global that is undefined unless
// --localstorage-file is given, and it shadows jsdom's window.localStorage in tests.
// Disable it in the test workers so jsdom's implementation is used.
const nodeMajor = Number(process.versions.node.split('.')[0]);
const execArgv = nodeMajor >= 25 ? ['--no-experimental-webstorage'] : [];

// Tests must never touch the development or real-data database. They only ever see
// TEST_DATABASE_URL (from the shell or .env) as DATABASE_URL; when it is not set,
// DATABASE_URL is blanked and database integration tests skip themselves.
const envFile = resolve(__dirname, '.env');
const fileEnv = existsSync(envFile) ? parse(readFileSync(envFile)) : {};
const testDatabaseUrl = process.env.TEST_DATABASE_URL || fileEnv.TEST_DATABASE_URL || '';

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
    // Pin the JWT secret to the code's development fallback, which many tests sign with.
    // Exporting it also reaches API processes that tests spawn, which would otherwise read
    // the developer's .env secret and reject test tokens. Test-only; never used for real logins.
    env: { DATABASE_URL: testDatabaseUrl, JWT_SECRET: 'edp-secret-change-in-production' },
  },
});