import { defineConfig, devices } from '@playwright/test'

const componentBaseURL = 'http://127.0.0.1:5180'
const siteBaseURL = 'http://127.0.0.1:5181'

const componentServer = {
  command: 'npx vite --config vite.e2e.config.ts --host 127.0.0.1',
  url: `${componentBaseURL}/`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
}

const siteServer = {
  command: 'npx vite --config site/vite.config.ts --host 127.0.0.1 --port 5181 --strictPort',
  url: `${siteBaseURL}/`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
}

const target = process.env.PLAYWRIGHT_TARGET
const webServer =
  target === 'components'
    ? [componentServer]
    : target === 'site'
      ? [siteServer]
      : [componentServer, siteServer]

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
    {
      name: 'ui-quality',
      testDir: './site/tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: siteBaseURL },
    },
  ],
  webServer,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 120,
      threshold: 0.2,
    },
  },
})
