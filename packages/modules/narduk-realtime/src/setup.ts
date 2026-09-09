import { resolveDurableObjects } from './options.js'
import { createWorkerEntryHook } from './worker-entry.js'
import type { NitroEntryContext, ResolvedDurableObject, RollupEntryConfig } from './worker-entry.js'

/** The Nitro instance surface used to register the rollup hook. */
export interface NitroHookHost {
  hooks: {
    hook(
      name: 'rollup:before',
      handler: (nitro: NitroEntryContext, rollupConfig: RollupEntryConfig) => void,
    ): void
  }
}

/**
 * The Nuxt hook surface used to reach Nitro.
 *
 * `nitro:init` is contributed to `NuxtHooks` by Nitro's own module
 * augmentation, which reaches a program only through Nuxt's generated `.nuxt`
 * types. This package typechecks standalone with `tsc`, so the key is absent
 * from `NuxtHooks` here and `module.ts` casts `nuxt.hooks` to this interface.
 * The payload is narrowed immediately to the structural types in
 * `worker-entry.ts`, which are what the logic and its tests are written
 * against.
 */
export interface NuxtHookRegistry {
  hook(name: 'nitro:init', handler: (nitro: NitroHookHost) => void): void
}

/**
 * Wire the declared Durable Objects into the Cloudflare Worker build.
 *
 * Resolution happens here rather than inside the build hook so that a typo in a
 * class name or a missing module fails the configuration immediately instead of
 * midway through a Cloudflare build. Returns the resolved objects so a caller
 * (and the tests) can see exactly what was wired.
 */
export function installDurableObjectExports(
  durableObjects: Record<string, string>,
  rootDir: string,
  hooks: NuxtHookRegistry,
): ResolvedDurableObject[] {
  const resolved = resolveDurableObjects(durableObjects, rootDir)

  if (resolved.length === 0) return resolved

  const writeWorkerEntry = createWorkerEntryHook(resolved)

  hooks.hook('nitro:init', (nitro) => {
    nitro.hooks.hook('rollup:before', writeWorkerEntry)
  })

  return resolved
}
