import { defineNuxtModule } from '@nuxt/kit'

import type { NardukRealtimeUpgrade } from './options.js'
import { installRealtimeWorkerEntry } from './setup.js'
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

  /**
   * WebSocket upgrades to route to a Durable Object.
   *
   * Each entry names a route the Worker answers itself: on `Upgrade: websocket`
   * the generated entry runs the route's `authorize` module (which normally
   * re-uses the app's own guards through `authorizeViaRoute`) and then forwards
   * the socket to `env[binding].get(idFromName(...))`. The Durable Object's
   * `acceptWebSocket` produces the only 101; nothing here does.
   *
   * Leave `nitro.experimental.websocket` **off**. It hands every upgrade to
   * crossws before the h3 app, which answers an unauthenticated 101 on every
   * path with a non-hibernating socket -- see the README.
   *
   * @example
   * ```ts
   * realtime: {
   *   durableObjects: { VesselDO: './server/durable/vessel-do' },
   *   upgrades: [
   *     {
   *       path: '/api/app/vessels/:vesselId/live',
   *       binding: 'VESSEL_DO',
   *       idFrom: 'vesselId',
   *       authorize: './server/upgrades/vessel-live',
   *     },
   *   ],
   * }
   * ```
   */
  upgrades?: NardukRealtimeUpgrade[]
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
    upgrades: [],
  },
  setup(options, nuxt) {
    installRealtimeWorkerEntry({
      durableObjects: options.durableObjects ?? {},
      upgrades: options.upgrades ?? [],
      rootDir: nuxt.options.rootDir,
      // See the NuxtHookRegistry doc comment: `nitro:init` is not part of the
      // standalone `NuxtHooks` type.
      hooks: nuxt.hooks as unknown as NuxtHookRegistry,
    })
  },
})

export {
  NardukRealtimeConfigurationError,
  resolveDurableObjects,
  resolveUpgrades,
} from './options.js'
export type { NardukRealtimeUpgrade } from './options.js'
export { installDurableObjectExports, installRealtimeWorkerEntry } from './setup.js'
export type {
  NitroHookHost,
  NuxtHookRegistry,
  RealtimeInstallation,
  RealtimeInstallOptions,
} from './setup.js'
export {
  buildWorkerEntrySource,
  CLOUDFLARE_PRESET_ENTRY_MARKER,
  createWorkerEntryHook,
  UPGRADE_ROUTER_MODULE,
  WORKER_ENTRY_FILENAME,
} from './worker-entry.js'
export type {
  NitroEntryContext,
  ResolvedDurableObject,
  ResolvedUpgrade,
  RollupEntryConfig,
} from './worker-entry.js'
// The authoriser context and verdict types, so an app's `authorize` module can
// be typed from the package it already imports. Types only: no Worker runtime
// code is pulled into the build-time module.
export type {
  UpgradeAuthorizeContext,
  UpgradeAuthorizeResult,
  UpgradeAuthorizer,
  UpgradeDurableObjectNamespace,
  UpgradeDurableObjectStub,
  UpgradeExecutionContext,
  UpgradeLocalFetch,
  UpgradeLocalFetchInit,
  UpgradeRoute,
  UpgradeRouteProbe,
  UpgradeRouterFetch,
  UpgradeRouterOptions,
  UpgradeWrappableHandler,
} from './worker/upgrade-router.js'
export type { PrincipalCarrier } from './worker/principal.js'
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER } from './worker/principal.js'
