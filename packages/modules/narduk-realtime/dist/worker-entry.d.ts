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
 * A validated `realtime.upgrades` entry, ready to emit into the entry.
 *
 * The three optional flags are present only when the app opted into them, so the
 * generated entry stays byte-identical for a configuration that left them off.
 */
export interface ResolvedUpgrade {
    path: string;
    binding: string;
    idFrom: string;
    forwardHeaders: string[];
    /** Origins allowed to open the socket. Absent keeps the same-origin default. */
    allowedOrigins?: string[];
    /** Allow a client that sends no `Origin` header at all. */
    allowMissingOrigin?: true;
    /** The route deliberately has no authoriser. */
    allowUnauthenticated?: true;
    authorizeModulePath?: string;
}
/**
 * Specifier the generated entry imports the runtime router from.
 *
 * A bare specifier, resolved from the *app's* `node_modules` by the Nitro
 * bundler, rather than an absolute path into this package's own install
 * location: the generated file lives inside the app's build directory, and the
 * app depends on this package, so this is the resolution the rest of its module
 * graph already uses.
 */
export declare const UPGRADE_ROUTER_MODULE = "@narduk-enterprises/narduk-realtime/worker/upgrade-router";
/**
 * Compose the generated Worker entry.
 *
 * Nitro pins the entry chunk name to `index.mjs`, so wrapping its entry this way
 * leaves the wrangler `main` path unchanged; the built Worker simply gains one
 * named export per Durable Object class alongside the default fetch handler.
 *
 * With no `upgrades` declared the entry re-exports Nitro's `default` untouched.
 * With upgrades it imports that default instead and exports it wrapped in the
 * upgrade router, so a matching `Upgrade: websocket` request is authorised and
 * handed to a Durable Object *before* Nitro's `localFetch` -- which cannot carry
 * a 101 -- ever sees it. Every other request, upgrade or not, reaches Nitro
 * exactly as it would have.
 */
export declare function buildWorkerEntrySource(nitroEntry: string, durableObjects: readonly ResolvedDurableObject[], upgrades?: readonly ResolvedUpgrade[]): string;
/**
 * Build the Nitro `rollup:before` handler that re-exports every declared
 * Durable Object class from the Cloudflare Worker entry.
 *
 * The handler is a no-op for any Nitro build that is not the Cloudflare preset
 * build, and a no-op when no Durable Objects are declared.
 */
export declare function createWorkerEntryHook(durableObjects: readonly ResolvedDurableObject[], upgrades?: readonly ResolvedUpgrade[]): (nitro: NitroEntryContext, rollupConfig: RollupEntryConfig) => void;
//# sourceMappingURL=worker-entry.d.ts.map