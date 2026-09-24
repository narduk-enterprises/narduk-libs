import { defineConfig, devices } from '@playwright/test'

const PORT = 4318
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * Runs against the prerendered build; `test:e2e` builds it first. The server
 * is always started fresh (never reused), so the suite cannot pass against a
 * stale build from another checkout that happens to hold the port.
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: ORIGIN },
  webServer: {
    command: `node scripts/serve.mts ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
