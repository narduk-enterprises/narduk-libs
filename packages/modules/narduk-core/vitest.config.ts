import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  root: packageRoot,
  resolve: {
    // The module points this alias at the app's schema choice; tests that load
    // pg-schema.ts directly get the default (`public`) unless they mock it.
    alias: {
      '#narduk-core/postgres-schema': join(packageRoot, 'runtime/internal/postgres-schema.ts'),
    },
  },
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
