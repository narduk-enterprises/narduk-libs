import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Nuxt's virtual module. The `./nuxt` runtime imports it for `useHead`
      // and `useRuntimeConfig`; the stub lets those files be unit-tested
      // without a Nuxt build (see tests/nuxt/nuxt-imports.ts).
      '#imports': fileURLToPath(new URL('./tests/nuxt/nuxt-imports.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
