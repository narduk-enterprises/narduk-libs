import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Existing tests build checkouts in temp directories, some with no app
    // config on purpose. File mode is the pre-portal behaviour they were
    // written against, and it keeps a developer's own portal token and network
    // out of the suite. Tests of the portal path set the mode themselves.
    env: { NARDUK_APP_CONFIG_SOURCE: 'file' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
