import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'app-responsive.spec.ts',
  timeout: 120_000,
  use: { ...base.use, actionTimeout: 8_000 },
  projects: [
    { name: 'small-phone', use: { ...devices['Pixel 5'], viewport: { width: 320, height: 780 } } },
    { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'landscape', use: { ...devices['Pixel 5'], viewport: { width: 844, height: 390 } } },
    { name: 'tablet', use: { ...devices['Pixel 5'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
