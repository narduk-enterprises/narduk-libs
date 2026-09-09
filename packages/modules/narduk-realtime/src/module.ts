import { defineNuxtModule } from '@nuxt/kit'

import { installDurableObjectExports } from './setup.js'
import type { NuxtHookRegistry } from './setup.js'

export interface NardukRealtimeModuleOptions {
  /**
   * Durable Object classes to re-export from the Cloudflare Worker entry.
   *
   * The key is the class name exactly as it is exported from the module and
   * named in `wrangler.jsonc` under `durable_objects.bindings[].class_name`.
   * The value is the module that exports it, resolved from the Nuxt app's
   * `rootDir` when it is relative, and passed through untouched when it is a
   * bare package specifier.
   *
   * @example
   * ```ts
   * realtime: { durableObjects: { VesselDO: './server/durable/vessel-do' } }
   * ```
   */
  durableObjects?: Record<string, string>
}

export default defineNuxtModule<NardukRealtimeModuleOptions>({
  meta: {
    name: '@narduk-enterprises/narduk-realtime',
    configKey: 'realtime',
    compatibility: {
      nuxt: '>=3.16.0',
    },
  },
  defaults: {
    durableObjects: {},
  },
  setup(options, nuxt) {
    installDurableObjectExports(
      options.durableObjects ?? {},
      nuxt.options.rootDir,
      // See the NuxtHookRegistry doc comment: `nitro:init` is not part of the
      // standalone `NuxtHooks` type.
      nuxt.hooks as unknown as NuxtHookRegistry,
    )
  },
})

export { NardukRealtimeConfigurationError, resolveDurableObjects } from './options.js'
export { installDurableObjectExports } from './setup.js'
export type { NitroHookHost, NuxtHookRegistry } from './setup.js'
export {
  buildWorkerEntrySource,
  CLOUDFLARE_PRESET_ENTRY_MARKER,
  createWorkerEntryHook,
  WORKER_ENTRY_FILENAME,
} from './worker-entry.js'
export type { NitroEntryContext, ResolvedDurableObject, RollupEntryConfig } from './worker-entry.js'
