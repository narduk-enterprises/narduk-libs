import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/fixtures/vue-warn-guard-setup.ts'],
    server: {
      deps: {
        // tests/asset-miss-no-store.test.ts runs Nitro's real cloudflare-module
        // entry, whose `#nitro-internal-*` specifiers only vi.mock can supply.
        // Node would load an externalized copy past the mocks.
        inline: [/nitropack[\\/]dist[\\/]presets[\\/]cloudflare[\\/]runtime/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
