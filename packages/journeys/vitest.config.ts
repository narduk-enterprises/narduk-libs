import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

// Unit suite only. The browser e2e lives behind vitest.e2e.config.ts and runs
// where a Playwright toolchain exists: locally via `pnpm run test`, and in CI
// on the dedicated playwright-isolated pool — the linux-ci package lane is
// browserless by estate design, so the split is declared topology, not a
// runtime skip.
export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/web-e2e.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
