import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

// A throwaway project vue-strict's own test runs a real Vitest against: the
// setup fails tests from `afterEach`, which can only be observed from outside.
export default defineConfig({
  root: here,
  test: {
    environment: 'happy-dom',
    include: ['*.fixture.ts'],
    reporters: ['default'],
    setupFiles: ['./setup.ts'],
  },
})
