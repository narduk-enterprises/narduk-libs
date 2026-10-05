import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: packageRoot,
  // `useSeo` declares the card only on the server, as Nuxt compiles it.
  define: { 'import.meta.server': 'true' },
  resolve: {
    alias: {
      '#imports': fileURLToPath(new URL('./tests/fixtures/nuxt-imports.ts', import.meta.url)),
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
