import type { H3Event } from 'h3'

/**
 * The runtime-config view this package's server code is allowed to rely on.
 *
 * A consumer's Nitro type program does **not** pick up the runtime-config
 * augmentation this module registers (`app/types/runtime-config.d.ts`), so
 * inside a consumer `useRuntimeConfig(event)` is the bare `@nuxt/schema`
 * `RuntimeConfig`, which extends `Record<string, unknown>`. Every key is
 * therefore `unknown` there while being precisely typed in this workspace —
 * which is exactly how a consumer-only typecheck failure shipped green from
 * our own package lane (narduk-libs#621).
 *
 * This type is the package's own answer to that, and it deliberately promises
 * only what `src/module.ts` actually guarantees: the three private keys it
 * defaults with `defu` are always present as strings once this module is
 * installed, and nothing else is claimed. Keys such as
 * `googleServiceAccountKey`, `gscSiteUrl` and `posthogApiKey` have no module
 * default, so they stay `unknown` and keep going through the defensive readers
 * in `@narduk-enterprises/narduk-core/server/utils/runtime-env`.
 */
export type AnalyticsServerRuntimeConfig = Record<string, unknown> & {
  /** Defaulted to `''` by `src/module.ts`. */
  indexNowKey: string
  /** Defaulted to `''` by `src/module.ts`. */
  ownerTagSecret: string
  /** Defaulted to `''` by `src/module.ts`. */
  posthogOwnerDistinctId: string
  public: Record<string, unknown>
}

/**
 * Read runtime config for this package's server code.
 *
 * Server code in this package calls this instead of `useRuntimeConfig`
 * directly so its view of the config is the same in our workspace and in a
 * consumer's Nitro build, rather than depending on a type augmentation that
 * only takes effect on one of the two. The single cast lives here; every
 * caller gets a type that is true in both programs.
 */
export function analyticsRuntimeConfig(event?: H3Event): AnalyticsServerRuntimeConfig {
  return (event ? useRuntimeConfig(event) : useRuntimeConfig()) as AnalyticsServerRuntimeConfig
}
