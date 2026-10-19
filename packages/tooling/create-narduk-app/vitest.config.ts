import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Synthetic checkouts exercise offline inference; portal behavior has explicit cases.
    env: { NARDUK_APP_CONFIG_SOURCE: 'file' },
    include: ['tests/**/*.test.ts'],
  },
})
