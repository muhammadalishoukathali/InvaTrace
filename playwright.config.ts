import { defineConfig, devices } from '@playwright/test'

/** Runs complete browser journeys against an isolated Vite development server.
 *  Explicit mock flags prevent an existing real-API server from changing the
 *  test environment. The mock service worker handles API calls in the page. */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['real-backend.spec.ts', 'pwa.spec.ts'],
  // The development API keeps one shared mock session, so parallel tests could
  // change the same profile or recovery code at the same time.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    env: { VITE_ENABLE_MOCKS: 'true', VITE_ENABLE_FAKE_MODEL: 'true' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [
        '**/real-backend.spec.ts',
        '**/pwa.spec.ts',
        '**/mobile-robustness.spec.ts',
        '**/model-ui-failure.spec.ts',
        '**/app-responsive.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/mobile-robustness.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
