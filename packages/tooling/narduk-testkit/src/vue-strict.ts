/**
 * One Vitest setup entry for a Nuxt app's Vue unit tests: a `[Vue warn]` fails
 * the test, and the pieces a plain `mount()` lacks are supplied so the
 * warnings that remain are real ones (narduk-libs#1403).
 *
 * ```ts
 * // vitest.config.ts
 * test: { environment: 'happy-dom', setupFiles: ['@narduk-enterprises/narduk-testkit/vue-strict-setup'] }
 * ```
 *
 * It is {@link installVueWarnGuard} (fail in `afterEach`) plus, for every
 * `@vue/test-utils` `mount()`, {@link createVueTestEnv} as a default global
 * plugin: a memory router, `NuxtLink`, `ClientOnly`, `NuxtImg`, and a
 * default-slot stub for every Nuxt UI `U*` component. An app that needs its own
 * `allow` list or stub names writes a three-line setup file of its own:
 *
 * ```ts
 * import { installVueStrict } from '@narduk-enterprises/narduk-testkit/vue-strict'
 *
 * installVueStrict({ stubNames: ['KitTile', 'KitPanel'], stubPatterns: [/^Kit[A-Z]/] })
 * ```
 *
 * A stub is a double. A test whose assertions depend on a child's real output
 * (its text, its `href`, an emitted event) must mount the real child, not rely
 * on a stub; a stub renders only its default slot.
 *
 * The failure is raised from `afterEach`, not by throwing out of Vue's
 * `warnHandler`: Vue runs the handler inside a render or watcher, where its own
 * error handling catches a throw, so a throwing handler can leave the test
 * green. See {@link installVueWarnGuard}. Needs `vitest`, `vue`, `vue-router`
 * and `@vue/test-utils`, all peers.
 */
import { config } from '@vue/test-utils'
import { afterEach, beforeEach } from 'vitest'

import { NUXT_UI_PATTERN, createVueTestEnv } from './vue-test-env.js'
import { installVueWarnGuard } from './vue-warn-guard.js'

import type { VueTestEnvOptions } from './vue-test-env.js'
import type { VueWarnGuard, VueWarnGuardOptions } from './vue-warn-guard.js'

export { allowVueWarning, expectVueWarn } from './vue-warn-guard.js'
export type { VueWarnAllowance, VueWarnGuard, VueWarnGuardOptions } from './vue-warn-guard.js'

export interface VueStrictOptions
  extends
    VueWarnGuardOptions,
    Pick<
      VueTestEnvOptions,
      'components' | 'initialPath' | 'routes' | 'stubNames' | 'stubPatterns'
    > {
  /**
   * Stub every Nuxt UI `U*` component with a default-slot double (default
   * `true`). `false` for an app that imports the real ones (`@nuxt/ui/vite`).
   */
  ui?: boolean
}

const INSTALLED = Symbol.for('narduk-testkit.vue-strict')

export function installVueStrict(options: VueStrictOptions = {}): VueWarnGuard {
  const guard = installVueWarnGuard({ allow: options.allow })
  const marked = globalThis as Record<symbol, boolean | undefined>
  if (marked[INSTALLED]) return guard
  marked[INSTALLED] = true

  let previous = config.global.plugins
  beforeEach(() => {
    previous = config.global.plugins
    config.global.plugins = [
      ...previous,
      createVueTestEnv({
        components: options.components,
        fallback: true,
        initialPath: options.initialPath,
        routes: options.routes,
        stubNames: options.stubNames,
        stubPatterns: [
          ...(options.ui === false ? [] : [NUXT_UI_PATTERN]),
          ...(options.stubPatterns ?? []),
        ],
      }),
    ]
  })
  afterEach(() => {
    config.global.plugins = previous
  })
  return guard
}
