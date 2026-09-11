import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // AppMapKit and AppMapKitCallout are mounted for real, so their SFCs have
  // to be compiled.
  plugins: [vue()],
  resolve: {
    alias: {
      // `useMapKit.ts` imports `useRuntimeConfig` from Nuxt's `#imports`
      // auto-import, which has no real module outside a Nuxt build. See
      // `test/fixtures/nuxt-imports.ts` for why this is safe under SSR.
      '#imports': fileURLToPath(new URL('./test/fixtures/nuxt-imports.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
