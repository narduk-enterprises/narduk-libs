import { useRuntimeConfig } from 'nitropack/runtime'

import type { H3Event } from 'h3'

/**
 * The runtime-config view this package's server code is allowed to rely on.
 *
 * A consumer's Nitro type program does not pick up the runtime-config
 * augmentation this module registers (`runtime/shared/types/runtime-config.d.ts`),
 * so inside a consumer `useRuntimeConfig(event)` is the bare `@nuxt/schema`
 * `RuntimeConfig`, which extends `Record<string, unknown>`. Every key is
 * `unknown` there while being precisely typed in this workspace — which is
 * how `useHyperdriveConnectionString` indexed `{}` and failed with TS2538 in
 * every consumer while this package's own `nuxt typecheck` stayed green
 * (narduk-libs#656, the same gap as #649 and #621).
 *
 * This type promises only what `src/module.ts` actually writes. Anything else
 * stays `unknown` and keeps going through the defensive readers in
 * `runtime-env.ts`. `posthogHost`, for example, has no module default, so it
 * is not named here.
 */
export type CoreServerRuntimeConfig = Record<string, unknown> & {
  /**
   * Wrangler Hyperdrive binding name. `src/module.ts` defaults it to
   * `'HYPERDRIVE'` when `NUXT_HYPERDRIVE_BINDING` is unset, so it is a string
   * whenever this module is installed.
   */
  hyperdriveBinding: string
  public: Record<string, unknown> & {
    /** `NUXT_PUBLIC_ALLOW_GEOLOCATION`, default `false`. */
    allowGeolocation: boolean
    /** `APP_VERSION`, the package version, or `''`. */
    appVersion: string
    /** `BUILD_TIME`, or the time the module was set up. */
    buildTime: string
    /** `BUILD_VERSION`, a commit SHA, or `appVersion`. */
    buildVersion: string
    /** `CSP_CONNECT_SRC`, or `''`. */
    cspConnectSrc: string
    /** `CSP_FRAME_SRC`, or `''`. */
    cspFrameSrc: string
    /** `CSP_MEDIA_SRC`, or `''`. */
    cspMediaSrc: string
    /** `CSP_SCRIPT_SRC`, or `''`. */
    cspScriptSrc: string
    /** `CSP_WORKER_SRC`, or `''`. */
    cspWorkerSrc: string
  }
}

/**
 * Read runtime config for this package's server code.
 *
 * Callers use this instead of `useRuntimeConfig` directly so the type is the
 * same in this workspace and in a consumer's Nitro program. The cast lives
 * here.
 */
export function coreRuntimeConfig(event?: H3Event): CoreServerRuntimeConfig {
  // Through `unknown` because `tsconfig.layer-tooling.json` typechecks this
  // file against nitropack's own `NitroRuntimeConfig`, which is an empty
  // interface until Nuxt's augmentation fills it in. A direct cast is TS2352
  // there. Nuxt's server program and a consumer see different returns (the
  // augmented config, and `Record<string, unknown>`), and `unknown` is the
  // one spelling that is legal in all three. The runtime value is unchanged.
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  return config as unknown as CoreServerRuntimeConfig
}
