import type { NardukRealtimeUpgrade } from './options.js';
import type { NitroEntryContext, ResolvedDurableObject, ResolvedUpgrade, RollupEntryConfig } from './worker-entry.js';
/** The Nitro instance surface used to register the rollup hook. */
export interface NitroHookHost {
    hooks: {
        hook(name: 'rollup:before', handler: (nitro: NitroEntryContext, rollupConfig: RollupEntryConfig) => void): void;
    };
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
    hook(name: 'nitro:init', handler: (nitro: NitroHookHost) => void): void;
}
/** What the module wired into the Worker build. */
export interface RealtimeInstallation {
    durableObjects: ResolvedDurableObject[];
    upgrades: ResolvedUpgrade[];
}
/** Everything the module reads out of its options plus the app's root. */
export interface RealtimeInstallOptions {
    durableObjects?: Record<string, string> | undefined;
    upgrades?: readonly NardukRealtimeUpgrade[] | undefined;
    rootDir: string;
    hooks: NuxtHookRegistry;
}
/**
 * Wire the declared Durable Objects and upgrade routes into the Worker build.
 *
 * Resolution happens here rather than inside the build hook so that a typo in a
 * class name, a missing module, or an upgrade route whose `idFrom` names no
 * parameter fails the configuration immediately instead of midway through a
 * Cloudflare build -- or, worse, at request time on a deployed Worker. Returns
 * what was wired so a caller (and the tests) can see exactly that.
 */
export declare function installRealtimeWorkerEntry(options: RealtimeInstallOptions): RealtimeInstallation;
/**
 * Wire the declared Durable Objects into the Cloudflare Worker build.
 *
 * The 0.1.0 entry point, kept for callers that only export classes.
 * {@link installRealtimeWorkerEntry} is the full surface.
 */
export declare function installDurableObjectExports(durableObjects: Record<string, string>, rootDir: string, hooks: NuxtHookRegistry): ResolvedDurableObject[];
//# sourceMappingURL=setup.d.ts.map