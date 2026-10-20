import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  resolve: {
    // One module id for this package's tests and narduk-core's logger bridge.
    alias: {
      'nitropack/runtime': join(packageRoot, 'tests/stubs/nitropack-runtime.ts'),
      // narduk-core's Postgres tables read their schema name from a Nuxt alias.
      '#narduk-core/postgres-schema': join(
        packageRoot,
        '../narduk-core/runtime/internal/postgres-schema.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
