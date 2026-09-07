import { defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  projects: [{
    name: 'mobile-chromium',
    use: {
      ...devices['Desktop Chrome'],
      hasTouch: true,
      launchOptions: {
        executablePath: chromiumExecutablePath,
      },
    },
  }],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --config apps/web/vite.config.ts --port 4173',
    url: 'http://127.0.0.1:4173/e2e/fixtures/instrument-workspace.html',
    reuseExistingServer: !process.env.CI,
  },
});