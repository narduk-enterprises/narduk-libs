import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const coreServerUtils = join(packageRoot, '../narduk-core/runtime/server/utils')

export default defineConfig({
  root: packageRoot,
  resolve: {
    // The real narduk-core logging bridge, so record tests see what an app's
    // Worker writes (narduk-logging's sanitizer included). Route tests that
    // only care about behaviour still replace these with `vi.mock`.
    alias: {
      '#layer/server/utils/logger': join(coreServerUtils, 'logger.ts'),
      'nitropack/runtime': join(packageRoot, 'tests/stubs/nitropack-runtime.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
