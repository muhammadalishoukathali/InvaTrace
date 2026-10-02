import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['events.spec.ts', 'events-audit.spec.ts', 'iteration3-audit.spec.ts', 'follow-up-outcomes.spec.ts', 'report-event.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5175', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'VITE_ENABLE_MOCKS=false VITE_API_BASE_URL=http://localhost:8800 npm run dev -- --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
