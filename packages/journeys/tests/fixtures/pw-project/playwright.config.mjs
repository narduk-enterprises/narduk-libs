import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'journeys.spec.mjs',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  outputDir: process.env.NJR_PW_ARTIFACTS ?? 'test-results',
})
