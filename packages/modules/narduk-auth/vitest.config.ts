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
    // Each key is an exact module id: no other `#layer` / `#narduk-*` import in
    // this package shares one of these as a prefix.
    alias: {
      'nitropack/runtime': join(packageRoot, 'tests/stubs/nitropack-runtime.ts'),
      '#auth-test-imports': join(packageRoot, 'tests/fixtures/nuxt-auto-imports.ts'),
      '#layer/server/database/schema': join(packageRoot, 'tests/stubs/layer-schema.ts'),
      '#layer/server/utils/auth': join(packageRoot, 'tests/stubs/layer-auth.ts'),
      '#layer/server/utils/database': join(packageRoot, 'tests/stubs/layer-database.ts'),
      // Resolved to the real narduk-core helper: the list-query contract is
      // what the route tests exercise, so it is never stubbed.
      '#layer/server/utils/logger': join(packageRoot, 'tests/stubs/layer-logger.ts'),
      '#layer/server/utils/listQuery': join(
        packageRoot,
        '../narduk-core/runtime/server/utils/listQuery.ts',
      ),
      '#layer/server/utils/mutation': join(packageRoot, 'tests/stubs/layer-mutation.ts'),
      '#layer/server/utils/password': join(
        packageRoot,
        '../narduk-core/runtime/server/utils/password.ts',
      ),
      '#layer/server/utils/rateLimit': join(packageRoot, 'tests/stubs/layer-rate-limit.ts'),
      '#layer/server/utils/sessionGrant': join(
        packageRoot,
        '../narduk-core/runtime/server/utils/sessionGrant.ts',
      ),
      '#narduk-auth-server/app-orm-tables': join(packageRoot, 'server/app-orm-tables.ts'),
      '#narduk-auth-server/database/app-schema': join(packageRoot, 'server/database/app-schema.ts'),
      '#narduk-auth-server/utils/app-auth': join(packageRoot, 'tests/stubs/app-auth.ts'),
      '#narduk-auth-server/utils/auth-bridge-database': join(
        packageRoot,
        'server/utils/auth-bridge-database.ts',
      ),
      '#narduk-auth-server/utils/auth-session-stability': join(
        packageRoot,
        'server/utils/auth-session-stability.ts',
      ),
      '#narduk-auth-server/utils/auth-callback': join(packageRoot, 'tests/stubs/auth-callback.ts'),
      '#narduk-auth-server/utils/auth-session-refresh-path': join(
        packageRoot,
        'server/utils/auth-session-refresh-path.ts',
      ),
      '#narduk-auth-server/utils/interactive-principal': join(
        packageRoot,
        'server/utils/interactive-principal.ts',
      ),
      '#narduk-auth-server/utils/notifications': join(packageRoot, 'server/utils/notifications.ts'),
      '#narduk-auth-server/utils/session-privilege': join(
        packageRoot,
        'server/utils/session-privilege.ts',
      ),
      '#narduk-auth-server/utils/session-grant-validator': join(
        packageRoot,
        'server/utils/session-grant-validator.ts',
      ),
      '#narduk-auth-server/utils/session-user': join(packageRoot, 'server/utils/session-user.ts'),
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
