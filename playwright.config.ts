import { defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: './apps/web/e2e',
  // This integration scenario needs a migrated database; the dedicated command
  // starts the API, while the fixture-only browser suite stays self-contained.
  testIgnore: process.env.FOLLOW_RECORD_E2E ? [] : ['record-following.spec.ts'],
  fullyParallel: true,
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        hasTouch: true,
        launchOptions: {
          executablePath: chromiumExecutablePath,
        },
      },
    },
    {
      name: 'firefox',
      testMatch: 'custom-footprint-reference.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'webkit',
      testMatch: 'custom-footprint-reference.spec.ts',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    ...(process.env.FOLLOW_RECORD_E2E ? [{
      command: 'npx tsx apps/api/src/index.ts',
      url: 'http://127.0.0.1:3000/api/live',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }] : []),
    {
      command: 'npx vite --config apps/web/vite.config.ts --port 4173',
      url: 'http://127.0.0.1:4173/e2e/fixtures/instrument-workspace.html',
      reuseExistingServer: !process.env.CI,
    },
  ],
});