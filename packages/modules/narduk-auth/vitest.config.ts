import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  resolve: {
    // Nuxt layer aliases resolved to lightweight stubs so server route modules
    // can be imported and their body contracts exercised without a Nuxt app.
    // Each key is an exact module id: no other `#layer` / `#narduk-*` import in
    // this package shares one of these as a prefix.
    alias: {
      '#layer/server/database/schema': join(packageRoot, 'tests/stubs/layer-schema.ts'),
      '#layer/server/utils/auth': join(packageRoot, 'tests/stubs/layer-auth.ts'),
      '#layer/server/utils/database': join(packageRoot, 'tests/stubs/layer-database.ts'),
      // Resolved to the real narduk-core helper: the list-query contract is
      // what the route tests exercise, so it is never stubbed.
      '#layer/server/utils/listQuery': join(
        packageRoot,
        '../narduk-core/runtime/server/utils/listQuery.ts',
      ),
      '#layer/server/utils/mutation': join(packageRoot, 'tests/stubs/layer-mutation.ts'),
      '#layer/server/utils/rateLimit': join(packageRoot, 'tests/stubs/layer-rate-limit.ts'),
      '#narduk-auth-server/utils/app-auth': join(packageRoot, 'tests/stubs/app-auth.ts'),
      '#narduk-auth-server/utils/auth-callback': join(packageRoot, 'tests/stubs/auth-callback.ts'),
      '#narduk-auth-server/utils/notifications': join(packageRoot, 'server/utils/notifications.ts'),
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
