import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  resolve: {
    alias: {
      // `cloudflare:workers` is a runtime-provided module that only exists
      // inside workerd. Types come from @cloudflare/workers-types; the unit
      // tests run on Node, so the import is aliased to a minimal stub.
      'cloudflare:workers': join(packageRoot, 'tests/stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'html'],
    },
  },
})
