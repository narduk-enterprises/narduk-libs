import type { NardukRealtimeUpgrade } from './options.js';
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
    durableObjects?: Record<string, string>;
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
    upgrades?: NardukRealtimeUpgrade[];
}
declare const _default: import("nuxt/schema").NuxtModule<NardukRealtimeModuleOptions, NardukRealtimeModuleOptions, false>;
export default _default;
export { NardukRealtimeConfigurationError, resolveDurableObjects, resolveUpgrades, } from './options.js';
export type { NardukRealtimeUpgrade } from './options.js';
export { installDurableObjectExports, installRealtimeWorkerEntry } from './setup.js';
export type { NitroHookHost, NuxtHookRegistry, RealtimeInstallation, RealtimeInstallOptions, } from './setup.js';
export { buildWorkerEntrySource, CLOUDFLARE_PRESET_ENTRY_MARKER, createWorkerEntryHook, UPGRADE_ROUTER_MODULE, WORKER_ENTRY_FILENAME, } from './worker-entry.js';
export type { NitroEntryContext, ResolvedDurableObject, ResolvedUpgrade, RollupEntryConfig, } from './worker-entry.js';
export type { UpgradeAuthorizeContext, UpgradeAuthorizeResult, UpgradeAuthorizer, UpgradeDurableObjectNamespace, UpgradeDurableObjectStub, UpgradeExecutionContext, UpgradeLocalFetch, UpgradeLocalFetchInit, UpgradeRoute, UpgradeRouteProbe, UpgradeRouterFetch, UpgradeRouterOptions, UpgradeWrappableHandler, } from './worker/upgrade-router.js';
export type { PrincipalCarrier } from './worker/principal.js';
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER } from './worker/principal.js';
//# sourceMappingURL=module.d.ts.map