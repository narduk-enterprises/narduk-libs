/**
 * WebSocket upgrade routing for a Cloudflare Worker built from a Nitro app.
 *
 * ## Why this exists at all
 *
 * Nitro's `cloudflare_module` entry sends every request through
 * `nitroApp.localFetch`, which rebuilds a `Response` from a mocked Node
 * response. A `101` carrying a `webSocket` cannot survive that -- outside
 * workerd `new Response(null, { status: 101 })` is refused outright. So an h3
 * route handler can authorise an upgrade but can never *answer* one.
 *
 * This router runs **outside** the Nitro app, in the generated Worker entry,
 * where the real `Request`, `env` and `ExecutionContext` are in hand. It
 * authorises by calling the app's own route in-process (so session and tenancy
 * guards keep one home) and then hands the socket to a Durable Object, whose
 * `ctx.acceptWebSocket()` produces the only 101 in the system. The router itself
 * never constructs a 101.
 *
 * ## What the router refuses before it authorises anything
 *
 * A route is served only for a `GET` (RFC 6455 s4.1 -- any other method is handed
 * back to the app, because the authorising probe is a GET and the object must not
 * see a method the guard never did), and only for an allowed `Origin`. A
 * WebSocket handshake is exempt from CORS, so for a socket authorised from a
 * cookie the origin comparison is the only thing standing between a viewer's
 * session and a socket opened by another site: see `UpgradeRoute.allowedOrigins`.
 * A route with no `authorize` and no explicit `allowUnauthenticated` is refused
 * when the router is built, not on the first request.
 *
 * ## Why not crossws / `nitro.experimental.websocket`
 *
 * `experimental.websocket: true` makes the preset entry answer **every**
 * `Upgrade: websocket` request through crossws *before* the h3 app runs. With no
 * `defineWebSocketHandler` in the app, crossws finds no `upgrade` hook and
 * completes the handshake unconditionally -- an unauthenticated 101 on every
 * path -- using `server.accept()`, i.e. a non-hibernating socket pinned in the
 * Worker isolate for the life of the connection. The `resolveDurableStub` option
 * that would redirect it is read only by `crossws/adapters/cloudflare-durable`,
 * which this preset does not use. Leave the flag **off** and use this router.
 */
/** The `ExecutionContext` surface the router uses. */
export interface UpgradeExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
}
/** A Durable Object stub: the only method the router calls. */
export interface UpgradeDurableObjectStub {
    fetch(request: Request): Promise<Response> | Response;
}
/** A Durable Object namespace binding, narrowed to what the router calls. */
export interface UpgradeDurableObjectNamespace {
    idFromName(name: string): unknown;
    get(id: unknown): UpgradeDurableObjectStub;
}
/** The `init` the router hands to Nitro's `localFetch`. */
export interface UpgradeLocalFetchInit {
    method: string;
    headers: Headers;
    host: string;
    protocol: string;
    context: Record<string, unknown>;
}
/** Nitro's `localFetch`, narrowed to the call the router makes. */
export type UpgradeLocalFetch = (path: string, init: UpgradeLocalFetchInit) => Promise<Response> | Response;
/** The outcome of an in-process route probe. */
export interface UpgradeRouteProbe {
    /** `true` for a 2xx. Anything else is a refusal to return to the client. */
    ok: boolean;
    /** The route's own response, untouched. */
    response: Response;
}
/** What an authoriser is handed. */
export interface UpgradeAuthorizeContext<Env = unknown> {
    /** The original upgrade request, with every `x-narduk-*` header removed. */
    readonly request: Request;
    /** The Worker `env`, so an authoriser can reach its own bindings. */
    readonly env: Env;
    /** The Worker `ExecutionContext`. */
    readonly executionContext: UpgradeExecutionContext;
    /** The parsed request URL. */
    readonly url: URL;
    /** The configured route pattern that matched, e.g. `/api/live/:id`. */
    readonly path: string;
    /** Parameters extracted from the pattern, percent-decoded. */
    readonly params: Readonly<Record<string, string>>;
    /** The name the router will pass to `idFromName`. */
    readonly objectName: string;
    /**
     * GET an app route in-process, reusing this request's cookies and headers.
     *
     * The handshake headers (`upgrade`, `connection`, `sec-websocket-*`) and every
     * `x-narduk-*` header are stripped; cookies are kept, which is the point --
     * the route sees the caller exactly as it would on a plain request, with the
     * Worker bindings attached, so `requireOrgRole` and friends behave identically.
     *
     * `routePath` defaults to the upgrade's own path and query. Pass a different
     * path (a pattern with `:param` is interpolated from {@link params}) to
     * authorise against another route. A non-2xx comes back with `ok: false` and
     * is meant to be returned verbatim as the upgrade response, which is how
     * 401/403/404 reach the client.
     */
    authorizeViaRoute(request: Request, routePath?: string): Promise<UpgradeRouteProbe>;
}
/** A go-ahead, optionally adding headers only this router can set. */
export interface UpgradeAllowed {
    ok: true;
    headers?: Record<string, string> | undefined;
}
/**
 * An authoriser's verdict: a `Response` to send back verbatim, or a go-ahead.
 *
 * Two named arms rather than an inline union, for the Prettier-version reason
 * documented on `UpgradePathParse`.
 */
export type UpgradeAuthorizeResult = Response | UpgradeAllowed;
/** An upgrade authoriser. */
export type UpgradeAuthorizer<Env = unknown> = (context: UpgradeAuthorizeContext<Env>) => Promise<UpgradeAuthorizeResult> | UpgradeAuthorizeResult;
/** One configured upgrade route. */
export interface UpgradeRoute<Env = unknown> {
    /** h3-style pattern: literal segments and `:param`. No wildcards. */
    path: string;
    /** `env` binding name of the Durable Object namespace. */
    binding: string;
    /** A route parameter name, or `name:<literal>`, feeding `idFromName`. */
    idFrom: string;
    /**
     * Decides whether the upgrade may proceed.
     *
     * **Required** unless {@link UpgradeRoute.allowUnauthenticated} is `true`:
     * building a router with neither throws, because a route with no check
     * forwards every matching handshake to the object unauthenticated.
     */
    authorize?: UpgradeAuthorizer<Env> | undefined;
    /**
     * Forward every matching upgrade with no check at all.
     *
     * The only legitimate reason is an object that authorises the socket itself
     * (from a signed token in the subprotocol, say), and it has to be written out
     * so that an omitted `authorize` can never become an open socket by accident.
     */
    allowUnauthenticated?: boolean | undefined;
    /** Headers to forward that the default deny list would otherwise drop. */
    forwardHeaders?: readonly string[] | undefined;
    /**
     * Origins allowed to open this socket, e.g. `['https://app.example']`.
     *
     * Absent means same-origin over https against the request's own `Host`. A list
     * **replaces** that default rather than adding to it, so an app that names a
     * partner origin and still wants its own must name both. `*` is rejected.
     */
    allowedOrigins?: readonly string[] | undefined;
    /**
     * Allow a request that sends no `Origin` header at all.
     *
     * A browser always sends one on a WebSocket handshake; a non-browser client
     * (an edge device, a server-to-server relay) sends none. Default `false`: a
     * cookie-authorised viewer route has to refuse a request with no origin,
     * because that is exactly what a replayed session looks like.
     */
    allowMissingOrigin?: boolean | undefined;
}
/** Router configuration. */
export interface UpgradeRouterOptions<Env = unknown> {
    upgrades: ReadonlyArray<UpgradeRoute<Env>>;
    /** Nitro's `localFetch`, required only by {@link UpgradeAuthorizeContext.authorizeViaRoute}. */
    localFetch?: UpgradeLocalFetch | undefined;
}
/** The wrapped `fetch`: handles a matching upgrade, else defers to `next`. */
export type UpgradeRouterFetch<Env = unknown> = (request: Request, env: Env, executionContext: UpgradeExecutionContext, next: (request: Request) => Promise<Response> | Response) => Promise<Response>;
/** A Worker default export, narrowed to the handler the router wraps. */
export interface UpgradeWrappableHandler<Env = unknown> {
    fetch(request: Request, env: Env, executionContext: UpgradeExecutionContext): Promise<Response> | Response;
}
/** `true` when this request is a WebSocket upgrade. */
export declare function isWebSocketUpgrade(request: Request): boolean;
/**
 * Build the upgrade router.
 *
 * Every route pattern is compiled once, here, so a bad pattern fails when the
 * Worker's module graph evaluates rather than on a request. The module's
 * build-time validator has already rejected one, so this only catches a
 * hand-written configuration.
 */
export declare function createUpgradeRouter<Env = unknown>(options: UpgradeRouterOptions<Env>): UpgradeRouterFetch<Env>;
/**
 * Wrap a Worker handler so `fetch` runs the upgrade router first.
 *
 * Every other handler the entry exports (`scheduled`, `queue`, `email`, `tail`,
 * `trace`) is copied across untouched, so wrapping is invisible to them.
 */
export declare function withUpgradeRouter<Env, Handler extends UpgradeWrappableHandler<Env>>(handler: Handler, router: UpgradeRouterFetch<Env>): Handler;
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER, principalFromRequest } from './principal.js';
export type { PrincipalCarrier } from './principal.js';
export { isOriginAllowed, parseUpgradeOrigin, sameOriginFor } from './upgrade-origin.js';
export type { UpgradeOriginParse, UpgradeOriginParsed, UpgradeOriginRejected, } from './upgrade-origin.js';
export { matchUpgradePath, parseUpgradePath } from './upgrade-path.js';
export type { UpgradePathParse, UpgradePathSegment } from './upgrade-path.js';
//# sourceMappingURL=upgrade-router.d.ts.map