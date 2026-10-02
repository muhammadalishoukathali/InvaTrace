import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: '**/english-language.spec.ts',
  timeout: 60_000,
  use: { ...base.use, actionTimeout: 8_000 },
  projects: [
    { name: 'english-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'english-phone', use: { ...devices['Pixel 5'] } },
  ],
})
