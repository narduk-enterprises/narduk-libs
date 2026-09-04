import { defineConfig, devices } from '@playwright/test'

const componentBaseURL = 'http://127.0.0.1:5180'

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './e2e/tests',
      use: { ...devices['Desktop Chrome'], baseURL: componentBaseURL },
    },
  ],
  webServer: {
    command: 'npx vite --config vite.e2e.config.ts --host 127.0.0.1',
    url: `${componentBaseURL}/`,
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
