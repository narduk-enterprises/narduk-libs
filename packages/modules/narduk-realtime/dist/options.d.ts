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
 * Nitro app, and never without `authorize` having agreed -- declaring one, or
 * declaring `allowUnauthenticated: true` in its place, is required. See the README section
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
     * **Required** unless `allowUnauthenticated` is `true`. Resolved like a
     * `durableObjects` entry: a relative or absolute path against the app's
     * `rootDir` (extension optional), anything else a bare specifier. The export's
     * signature is
     * `(context: UpgradeAuthorizeContext) => Promise<Response | { ok: true, headers?: Record<string, string> }>`.
     */
    authorize?: string;
    /**
     * Declare that this route intentionally has no authoriser.
     *
     * The only legitimate reason is a Durable Object that authorises the socket
     * itself (from a signed token in the subprotocol, say). Anything else is an
     * open socket, which is why the absence of `authorize` has to be written out
     * rather than inferred from an omission.
     */
    allowUnauthenticated?: boolean;
    /**
     * Headers to forward to the object that the router would otherwise drop
     * (`cookie`, `authorization`, the handshake and hop-by-hop set). Never
     * `x-narduk-*`: that prefix is the router's own trust channel.
     */
    forwardHeaders?: string[];
    /**
     * Origins allowed to open this socket, e.g. `['https://app.example']`.
     *
     * Absent means same-origin over https against the request's own `Host`, which
     * is what a deployed app wants. A list **replaces** that default rather than
     * adding to it, and `*` is rejected: a WebSocket handshake is exempt from CORS,
     * so this comparison is what stops another site opening a socket with the
     * viewer's cookies attached.
     */
    allowedOrigins?: string[];
    /**
     * Allow a client that sends no `Origin` header at all (default `false`).
     *
     * A browser always sends one; a non-browser client -- an edge device posting
     * telemetry, a server-to-server relay -- sends none. Set it only on a route
     * whose credential is not a cookie.
     */
    allowMissingOrigin?: boolean;
}
/**
 * Validate and resolve `realtime.upgrades`.
 *
 * Everything that can be known at configuration time is checked here -- the
 * path pattern, the binding name, that `idFrom` names a parameter the path
 * actually declares, the forwarded-header allowlist, the origin policy, that an
 * authoriser is declared at all, and that the `authorize` module exists -- so a typo fails `nuxt build` immediately instead of becoming
 * a 500 on a deployed upgrade. Declaration order is preserved: the first
 * matching route wins at runtime.
 */
export declare function resolveUpgrades(upgrades: readonly NardukRealtimeUpgrade[] | undefined, rootDir: string): ResolvedUpgrade[];
//# sourceMappingURL=options.d.ts.map