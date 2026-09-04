import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  resolve: {
    // Nuxt layer aliases resolved to lightweight stubs so server route modules
    // can be imported and their body contracts exercised without a Nuxt app.
    alias: {
      '#layer/server/database/schema': join(packageRoot, 'tests/stubs/layer-schema.ts'),
      '#layer/server/utils/database': join(packageRoot, 'tests/stubs/layer-database.ts'),
      '#layer/server/utils/mutation': join(packageRoot, 'tests/stubs/layer-mutation.ts'),
      '#layer/server/utils/rateLimit': join(packageRoot, 'tests/stubs/layer-rate-limit.ts'),
      '#narduk-auth-server/utils/app-auth': join(packageRoot, 'tests/stubs/app-auth.ts'),
      '#narduk-auth-server/utils/auth-callback': join(packageRoot, 'tests/stubs/auth-callback.ts'),
      '#narduk-core/schema': join(packageRoot, 'tests/stubs/core-schema.ts'),
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
