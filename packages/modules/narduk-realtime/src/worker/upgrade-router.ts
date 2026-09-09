import { NARDUK_ROUTER_HEADER_PREFIX } from './principal.js'
import { matchUpgradePath, parseUpgradePath } from './upgrade-path.js'
import type { UpgradePathSegment } from './upgrade-path.js'

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
  waitUntil(promise: Promise<unknown>): void
}

/** A Durable Object stub: the only method the router calls. */
export interface UpgradeDurableObjectStub {
  fetch(request: Request): Promise<Response> | Response
}

/** A Durable Object namespace binding, narrowed to what the router calls. */
export interface UpgradeDurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): UpgradeDurableObjectStub
}

/** The `init` the router hands to Nitro's `localFetch`. */
export interface UpgradeLocalFetchInit {
  method: string
  headers: Headers
  host: string
  protocol: string
  context: Record<string, unknown>
}

/** Nitro's `localFetch`, narrowed to the call the router makes. */
export type UpgradeLocalFetch = (
  path: string,
  init: UpgradeLocalFetchInit,
) => Promise<Response> | Response

/** The outcome of an in-process route probe. */
export interface UpgradeRouteProbe {
  /** `true` for a 2xx. Anything else is a refusal to return to the client. */
  ok: boolean
  /** The route's own response, untouched. */
  response: Response
}

/** What an authoriser is handed. */
export interface UpgradeAuthorizeContext<Env = unknown> {
  /** The original upgrade request, with every `x-narduk-*` header removed. */
  readonly request: Request
  /** The Worker `env`, so an authoriser can reach its own bindings. */
  readonly env: Env
  /** The Worker `ExecutionContext`. */
  readonly executionContext: UpgradeExecutionContext
  /** The parsed request URL. */
  readonly url: URL
  /** The configured route pattern that matched, e.g. `/api/live/:id`. */
  readonly path: string
  /** Parameters extracted from the pattern, percent-decoded. */
  readonly params: Readonly<Record<string, string>>
  /** The name the router will pass to `idFromName`. */
  readonly objectName: string
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
  authorizeViaRoute(request: Request, routePath?: string): Promise<UpgradeRouteProbe>
}

/** An authoriser's verdict: a refusal to send back, or a go-ahead. */
export type UpgradeAuthorizeResult =
  | Response
  | { ok: true; headers?: Record<string, string> | undefined }

/** An upgrade authoriser. */
export type UpgradeAuthorizer<Env = unknown> = (
  context: UpgradeAuthorizeContext<Env>,
) => Promise<UpgradeAuthorizeResult> | UpgradeAuthorizeResult

/** One configured upgrade route. */
export interface UpgradeRoute<Env = unknown> {
  /** h3-style pattern: literal segments and `:param`. No wildcards. */
  path: string
  /** `env` binding name of the Durable Object namespace. */
  binding: string
  /** A route parameter name, or `name:<literal>`, feeding `idFromName`. */
  idFrom: string
  /** Decides whether the upgrade may proceed. Absent means "no check". */
  authorize?: UpgradeAuthorizer<Env> | undefined
  /** Headers to forward that the default deny list would otherwise drop. */
  forwardHeaders?: readonly string[] | undefined
}

/** Router configuration. */
export interface UpgradeRouterOptions<Env = unknown> {
  upgrades: ReadonlyArray<UpgradeRoute<Env>>
  /** Nitro's `localFetch`, required only by {@link UpgradeAuthorizeContext.authorizeViaRoute}. */
  localFetch?: UpgradeLocalFetch | undefined
}

/** The wrapped `fetch`: handles a matching upgrade, else defers to `next`. */
export type UpgradeRouterFetch<Env = unknown> = (
  request: Request,
  env: Env,
  executionContext: UpgradeExecutionContext,
  next: (request: Request) => Promise<Response> | Response,
) => Promise<Response>

/** A Worker default export, narrowed to the handler the router wraps. */
export interface UpgradeWrappableHandler<Env = unknown> {
  fetch(
    request: Request,
    env: Env,
    executionContext: UpgradeExecutionContext,
  ): Promise<Response> | Response
}

/**
 * Headers dropped from the forwarded request unless a route lists them in
 * `forwardHeaders`.
 *
 * Two groups. **Credentials** (`cookie`, `authorization`, `proxy-*`): the
 * authoriser has already consumed them, and a Durable Object should be given a
 * principal, not a bearer it could replay. **Handshake and hop-by-hop**
 * (`connection`, `sec-websocket-key|version|extensions`, `te`, `trailer`,
 * `transfer-encoding`, `keep-alive`): these describe the *client's* connection
 * to the edge. workerd pairs the object's 101 with that connection itself, so
 * forwarding them would be describing the wrong hop.
 *
 * `upgrade` is deliberately absent -- it is the header that makes the subrequest
 * an upgrade at all -- and so is `sec-websocket-protocol`, which an object needs
 * for subprotocol negotiation.
 */
const DENIED_FORWARD_HEADERS: readonly string[] = [
  'authorization',
  'connection',
  'cookie',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-version',
  'te',
  'trailer',
  'transfer-encoding',
]

/** Headers stripped before an app route is probed in-process. */
const HANDSHAKE_HEADERS: readonly string[] = [
  'connection',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
]

/** Prefix marking an `idFrom` value as a literal rather than a parameter. */
const LITERAL_ID_PREFIX = 'name:'

interface CompiledRoute<Env> extends UpgradeRoute<Env> {
  segments: UpgradePathSegment[]
  denied: Set<string>
}

/** `true` when this request is a WebSocket upgrade. */
export function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').trim().toLowerCase() === 'websocket'
}

/** Drop every header the router owns, so an inbound one can never be believed. */
function withoutRouterHeaders(headers: Headers): Headers {
  const copy = new Headers(headers)
  for (const name of [...copy.keys()]) {
    if (name.toLowerCase().startsWith(NARDUK_ROUTER_HEADER_PREFIX)) copy.delete(name)
  }
  return copy
}

function withoutHeaders(headers: Headers, names: readonly string[]): Headers {
  const copy = new Headers(headers)
  for (const name of names) copy.delete(name)
  return copy
}

function compile<Env>(route: UpgradeRoute<Env>): CompiledRoute<Env> {
  const parsed = parseUpgradePath(route.path)
  if (!parsed.ok) {
    throw new TypeError(`Upgrade route "${route.path}" ${parsed.reason}.`)
  }

  const allowed = new Set((route.forwardHeaders ?? []).map((name) => name.toLowerCase()))

  return {
    ...route,
    segments: parsed.segments,
    denied: new Set(DENIED_FORWARD_HEADERS.filter((name) => !allowed.has(name))),
  }
}

function objectNameFor<Env>(
  route: CompiledRoute<Env>,
  params: Record<string, string>,
): string | undefined {
  if (route.idFrom.startsWith(LITERAL_ID_PREFIX)) {
    const literal = route.idFrom.slice(LITERAL_ID_PREFIX.length)
    return literal.length > 0 ? literal : undefined
  }
  return params[route.idFrom]
}

function namespaceFor(env: unknown, binding: string): UpgradeDurableObjectNamespace | undefined {
  const candidate = (env as Record<string, unknown> | null | undefined)?.[binding]
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const namespace = candidate as Partial<UpgradeDurableObjectNamespace>
  if (typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    return undefined
  }

  return namespace as UpgradeDurableObjectNamespace
}

function interpolate(routePath: string, params: Record<string, string>): string {
  return routePath
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const value = params[segment.slice(1)]
      if (value === undefined) {
        throw new TypeError(
          `authorizeViaRoute("${routePath}") needs the route parameter "${segment.slice(1)}", which this upgrade route does not declare.`,
        )
      }
      return encodeURIComponent(value)
    })
    .join('/')
}

/** A refusal produced by the router itself, never by a Durable Object. */
function routerFailure(message: string): Response {
  return new Response(message, {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Build the upgrade router.
 *
 * Every route pattern is compiled once, here, so a bad pattern fails when the
 * Worker's module graph evaluates rather than on a request. The module's
 * build-time validator has already rejected one, so this only catches a
 * hand-written configuration.
 */
export function createUpgradeRouter<Env = unknown>(
  options: UpgradeRouterOptions<Env>,
): UpgradeRouterFetch<Env> {
  const routes = options.upgrades.map((route) => compile(route))
  const { localFetch } = options

  return async (request, env, executionContext, next) => {
    if (!isWebSocketUpgrade(request)) return next(request)

    const url = new URL(request.url)
    let matched: { route: CompiledRoute<Env>; params: Record<string, string> } | undefined
    for (const route of routes) {
      const params = matchUpgradePath(route.segments, url.pathname)
      if (params) {
        matched = { route, params }
        break
      }
    }
    // Not an upgrade this app declared: hand it back untouched. The app answers
    // it exactly as it would have without this router installed.
    if (!matched) return next(request)

    const { route, params } = matched
    const objectName = objectNameFor(route, params)
    if (objectName === undefined) {
      return routerFailure(
        `Upgrade route "${route.path}" resolves no Durable Object name from idFrom "${route.idFrom}".`,
      )
    }

    const namespace = namespaceFor(env, route.binding)
    if (!namespace) {
      return routerFailure(
        `Upgrade route "${route.path}" has no Durable Object namespace bound as "${route.binding}".`,
      )
    }

    // A spoofed principal header dies here, before the authoriser and before
    // the app route sees the request.
    const trusted = new Request(request, { headers: withoutRouterHeaders(request.headers) })

    const verdict = route.authorize
      ? await route.authorize(
          authorizeContext({
            env,
            executionContext,
            localFetch,
            objectName,
            params,
            path: route.path,
            request: trusted,
            url,
          }),
        )
      : { ok: true as const }

    if (verdict instanceof Response) {
      // Only a Durable Object's `acceptWebSocket` may answer 101. An authoriser
      // that returns one is a bug that would otherwise reach a client as a
      // handshake nothing is listening behind.
      if (verdict.status === 101) {
        return routerFailure(
          `The authoriser for "${route.path}" answered 101. Only the Durable Object may complete a handshake.`,
        )
      }
      return verdict
    }

    const forwarded = new Request(url, {
      method: trusted.method,
      headers: forwardedHeaders(trusted.headers, route.denied, verdict.headers),
    })

    return namespace.get(namespace.idFromName(objectName)).fetch(forwarded)
  }
}

function forwardedHeaders(
  headers: Headers,
  denied: ReadonlySet<string>,
  added: Record<string, string> | undefined,
): Headers {
  const forwarded = withoutHeaders(headers, [...denied])
  for (const [name, value] of Object.entries(added ?? {})) forwarded.set(name, value)
  return forwarded
}

function authorizeContext<Env>(parts: {
  env: Env
  executionContext: UpgradeExecutionContext
  localFetch: UpgradeLocalFetch | undefined
  objectName: string
  params: Record<string, string>
  path: string
  request: Request
  url: URL
}): UpgradeAuthorizeContext<Env> {
  const { env, executionContext, localFetch, objectName, params, path, request, url } = parts

  return {
    env,
    executionContext,
    objectName,
    params,
    path,
    request,
    url,
    async authorizeViaRoute(probeRequest, routePath) {
      if (!localFetch) {
        throw new TypeError(
          "authorizeViaRoute needs Nitro's localFetch. Create the router with { localFetch: (path, init) => useNitroApp().localFetch(path, init) }.",
        )
      }

      const target = routePath ? interpolate(routePath, params) : url.pathname + url.search
      const response = await localFetch(target, {
        method: 'GET',
        headers: withoutHeaders(withoutRouterHeaders(probeRequest.headers), HANDSHAKE_HEADERS),
        host: url.hostname,
        protocol: url.protocol,
        // The same context shape Nitro's own Cloudflare handler builds, so the
        // route reaches D1, KV and the rest through `event.context.cloudflare`.
        context: {
          waitUntil: (promise: Promise<unknown>) => executionContext.waitUntil(promise),
          _platform: {
            cf: (request as Request & { cf?: unknown }).cf,
            cloudflare: { request, env, context: executionContext, url },
          },
        },
      })

      return { ok: response.status >= 200 && response.status < 300, response }
    },
  }
}

/**
 * Wrap a Worker handler so `fetch` runs the upgrade router first.
 *
 * Every other handler the entry exports (`scheduled`, `queue`, `email`, `tail`,
 * `trace`) is copied across untouched, so wrapping is invisible to them.
 */
export function withUpgradeRouter<Env, Handler extends UpgradeWrappableHandler<Env>>(
  handler: Handler,
  router: UpgradeRouterFetch<Env>,
): Handler {
  return Object.assign({}, handler, {
    fetch: (request: Request, env: Env, executionContext: UpgradeExecutionContext) =>
      router(request, env, executionContext, (forwarded) =>
        handler.fetch(forwarded, env, executionContext),
      ),
  })
}

export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER, principalFromRequest } from './principal.js'
export type { PrincipalCarrier } from './principal.js'
export { matchUpgradePath, parseUpgradePath } from './upgrade-path.js'
export type { UpgradePathParse, UpgradePathSegment } from './upgrade-path.js'
