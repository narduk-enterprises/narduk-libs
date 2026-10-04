import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

// A throwaway project the guard's own test runs a real Vitest against: the
// guard fails tests from `afterEach`, which can only be observed from outside.
export default defineConfig({
  root: here,
  test: {
    environment: 'node',
    include: ['*.fixture.ts'],
    reporters: ['default'],
    setupFiles: ['./setup.ts'],
  },
})
