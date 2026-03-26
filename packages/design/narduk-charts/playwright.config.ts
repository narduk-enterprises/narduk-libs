import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --config vite.e2e.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:5180/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 120,
      threshold: 0.2,
    },
  },
})
