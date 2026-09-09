import type { ResolvedDurableObject, ResolvedUpgrade } from './worker-entry.js';
export declare class NardukRealtimeConfigurationError extends Error {
    constructor(message: string);
}
/**
 * Validate and resolve the `realtime.durableObjects` map.
 *
 * Entries are returned sorted by class name so that the generated Worker entry
 * is byte-identical across builds of the same configuration.
 */
export declare function resolveDurableObjects(durableObjects: Record<string, string>, rootDir: string): ResolvedDurableObject[];
/**
 * One declared WebSocket upgrade route.
 *
 * A route is answered by the Durable Object named by `binding`, never by the
 * Nitro app, and never without `authorize` having agreed. See the README section
 * "Routing a WebSocket upgrade to a Durable Object" for the full example.
 */
export interface NardukRealtimeUpgrade {
    /**
     * h3-style route pattern: literal segments and `:param`.
     *
     * @example '/api/app/vessels/:vesselId/live'
     */
    path: string;
    /** `env` binding name of the Durable Object namespace, e.g. `'VESSEL_DO'`. */
    binding: string;
    /**
     * Which name the object is addressed by: a route parameter name from `path`,
     * or `name:<literal>` for a single shared object.
     */
    idFrom: string;
    /**
     * Module whose `default` export decides whether the upgrade may proceed.
     *
     * Resolved like a `durableObjects` entry: a relative or absolute path against
     * the app's `rootDir` (extension optional), anything else a bare specifier.
     * The export's signature is
     * `(context: UpgradeAuthorizeContext) => Promise<Response | { ok: true, headers?: Record<string, string> }>`.
     */
    authorize?: string;
    /**
     * Headers to forward to the object that the router would otherwise drop
     * (`cookie`, `authorization`, the handshake and hop-by-hop set). Never
     * `x-narduk-*`: that prefix is the router's own trust channel.
     */
    forwardHeaders?: string[];
}
/**
 * Validate and resolve `realtime.upgrades`.
 *
 * Everything that can be known at configuration time is checked here -- the
 * path pattern, the binding name, that `idFrom` names a parameter the path
 * actually declares, the forwarded-header allowlist, and that the `authorize`
 * module exists -- so a typo fails `nuxt build` immediately instead of becoming
 * a 500 on a deployed upgrade. Declaration order is preserved: the first
 * matching route wins at runtime.
 */
export declare function resolveUpgrades(upgrades: readonly NardukRealtimeUpgrade[] | undefined, rootDir: string): ResolvedUpgrade[];
//# sourceMappingURL=options.d.ts.map