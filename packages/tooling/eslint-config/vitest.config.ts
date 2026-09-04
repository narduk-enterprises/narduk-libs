import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // tests/composition/*.test.ts (packs, prettier-last, security-scope,
    // tailwind-theme-override, no-restricted-imports) each `beforeAll`-import
    // eslint-app-config.mjs, which pulls in the full ESLint plugin graph
    // (typescript-eslint, eslint-plugin-vue, eslint-plugin-unicorn,
    // eslint-plugin-security, ...). That import is fine locally but exceeded
    // vitest's 10s default hookTimeout on the CI runner: ci / package /
    // eslint-config, run 30764151785, failed with "Hook timed out in 10000ms"
    // at tests/composition/prettier-last.test.ts:35 (the beforeAll doing the
    // import), while sibling composition suites in that same run were already
    // finishing their own beforeAll-plus-tests in 7-9s — clearly a slow-runner
    // margin problem, not a hung import. Raise the ceiling generously instead
    // of special-casing one test file; testTimeout is bumped too as a
    // defensive margin for the same import cost, even though only the hook
    // was observed to exceed the default.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
})
