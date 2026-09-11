import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))

const AUTH_CARD_AUTO_IMPORTS = `import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import { navigateTo, useAuth, useAuthRuntimePublic, useRoute, useRuntimeConfig, useToast } from '#auth-test-imports'
`

function isRawAuthCardSfc(id: string): boolean {
  const [pathname, query] = id.split('?')
  return Boolean(pathname?.includes('/app/components/auth/') && pathname.endsWith('.vue') && !query)
}

/**
 * The Auth* cards rely on Nuxt auto-imports (`ref`, `useAuth`, …). This
 * package's vitest suite is a plain Vite compile, so those identifiers are
 * otherwise free variables in an ESM module (ReferenceError). Inject the
 * same names the layer would have provided, pointing Vue APIs at `vue` and
 * the Nuxt/auth helpers at `tests/fixtures/nuxt-auto-imports.ts`.
 */
function authCardAutoImportPlugin(): Plugin {
  return {
    name: 'narduk-auth-card-auto-imports',
    enforce: 'pre',
    transform(code, id) {
      if (!isRawAuthCardSfc(id) || code.includes('#auth-test-imports')) return null
      const scriptOpen = code.indexOf('<script setup')
      if (scriptOpen === -1) return null
      const tagEnd = code.indexOf('>', scriptOpen)
      if (tagEnd === -1) return null
      return {
        code: `${code.slice(0, tagEnd + 1)}\n${AUTH_CARD_AUTO_IMPORTS}${code.slice(tagEnd + 1)}`,
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [authCardAutoImportPlugin(), vue()],
  root: packageRoot,
  resolve: {
    // Nuxt layer aliases resolved to lightweight stubs so server route modules
    // can be imported and their body contracts exercised without a Nuxt app.
    alias: {
      '#auth-test-imports': join(packageRoot, 'tests/fixtures/nuxt-auto-imports.ts'),
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
