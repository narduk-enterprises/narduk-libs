/**
 * Nuxt builds Nitro twice: once for the prerenderer and once for the deployment
 * preset. Only the preset build produces the Cloudflare Worker entry with a
 * `default` export; the prerenderer entry has none, so re-exporting `default`
 * from it would fail the build. This marker is what distinguishes them.
 */
export declare const CLOUDFLARE_PRESET_ENTRY_MARKER = "/presets/cloudflare/";
/** Name of the generated entry written into the Nitro build directory. */
export declare const WORKER_ENTRY_FILENAME = "narduk-realtime-worker-entry.mjs";
/** The subset of the Nitro instance this module reads. */
export interface NitroEntryContext {
    options: {
        buildDir: string;
        entry: string;
    };
}
/** The subset of the rollup config this module writes. */
export interface RollupEntryConfig {
    input?: unknown;
}
/** A resolved Durable Object: exported class name to absolute module path. */
export interface ResolvedDurableObject {
    className: string;
    modulePath: string;
}
/**
 * Compose the generated Worker entry.
 *
 * Nitro pins the entry chunk name to `index.mjs`, so wrapping its entry this way
 * leaves the wrangler `main` path unchanged; the built Worker simply gains one
 * named export per Durable Object class alongside the default fetch handler.
 */
export declare function buildWorkerEntrySource(nitroEntry: string, durableObjects: readonly ResolvedDurableObject[]): string;
/**
 * Build the Nitro `rollup:before` handler that re-exports every declared
 * Durable Object class from the Cloudflare Worker entry.
 *
 * The handler is a no-op for any Nitro build that is not the Cloudflare preset
 * build, and a no-op when no Durable Objects are declared.
 */
export declare function createWorkerEntryHook(durableObjects: readonly ResolvedDurableObject[]): (nitro: NitroEntryContext, rollupConfig: RollupEntryConfig) => void;
//# sourceMappingURL=worker-entry.d.ts.map