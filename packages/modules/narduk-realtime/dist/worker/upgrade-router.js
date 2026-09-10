import { NARDUK_ROUTER_HEADER_PREFIX } from './principal.js';
import { isOriginAllowed, parseUpgradeOrigin } from './upgrade-origin.js';
import { matchUpgradePath, parseUpgradePath } from './upgrade-path.js';
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
const DENIED_FORWARD_HEADERS = [
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
];
/** Headers stripped before an app route is probed in-process. */
const HANDSHAKE_HEADERS = [
    'connection',
    'sec-websocket-extensions',
    'sec-websocket-key',
    'sec-websocket-protocol',
    'sec-websocket-version',
    'upgrade',
];
/** Prefix marking an `idFrom` value as a literal rather than a parameter. */
const LITERAL_ID_PREFIX = 'name:';
/** `true` when this request is a WebSocket upgrade. */
export function isWebSocketUpgrade(request) {
    return (request.headers.get('upgrade') ?? '').trim().toLowerCase() === 'websocket';
}
/** Drop every header the router owns, so an inbound one can never be believed. */
function withoutRouterHeaders(headers) {
    const copy = new Headers(headers);
    for (const name of [...copy.keys()]) {
        if (name.toLowerCase().startsWith(NARDUK_ROUTER_HEADER_PREFIX))
            copy.delete(name);
    }
    return copy;
}
function withoutHeaders(headers, names) {
    const copy = new Headers(headers);
    for (const name of names)
        copy.delete(name);
    return copy;
}
/**
 * Compile one configured route, or explain why it cannot be served.
 *
 * `index` is the entry's position in `upgrades`, so a hand-written configuration
 * fails naming the entry and the field the way the module's build-time validator
 * does for `realtime.upgrades[n]`.
 */
function compile(route, index) {
    const label = `upgrades[${index}]`;
    const parsed = parseUpgradePath(route.path);
    if (!parsed.ok) {
        throw new TypeError(`Upgrade route "${route.path}" ${parsed.reason}.`);
    }
    // Fail closed. A route with no authoriser forwards every matching handshake to
    // the object, so the absence of a check has to be stated rather than implied.
    if (route.authorize === undefined && route.allowUnauthenticated !== true) {
        throw new TypeError(`${label}.authorize is missing for "${route.path}", so every matching upgrade would reach the Durable Object unauthenticated. Give ${label} an authorize function, or set ${label}.allowUnauthenticated to true if the object authorises the socket itself.`);
    }
    const allowed = new Set((route.forwardHeaders ?? []).map((name) => name.toLowerCase()));
    return {
        ...route,
        segments: parsed.segments,
        denied: new Set(DENIED_FORWARD_HEADERS.filter((name) => !allowed.has(name))),
        origins: compileOrigins(route.allowedOrigins, `${label}.allowedOrigins`),
    };
}
/** Normalise a route's `allowedOrigins`, or explain what is wrong with one. */
function compileOrigins(allowedOrigins, label) {
    if (allowedOrigins === undefined)
        return undefined;
    if (allowedOrigins.length === 0) {
        throw new TypeError(`${label} is empty. Remove it to keep the same-origin default, or list at least one origin.`);
    }
    const origins = new Set();
    for (const entry of allowedOrigins) {
        const parsed = parseUpgradeOrigin(entry);
        if (!parsed.ok) {
            throw new TypeError(`${label} lists "${entry}": it ${parsed.reason}.`);
        }
        origins.add(parsed.origin);
    }
    return origins;
}
function objectNameFor(route, params) {
    if (route.idFrom.startsWith(LITERAL_ID_PREFIX)) {
        const literal = route.idFrom.slice(LITERAL_ID_PREFIX.length);
        return literal.length > 0 ? literal : undefined;
    }
    return params[route.idFrom];
}
function namespaceFor(env, binding) {
    const candidate = env?.[binding];
    if (typeof candidate !== 'object' || candidate === null)
        return undefined;
    const namespace = candidate;
    if (typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
        return undefined;
    }
    return namespace;
}
/**
 * Interpolate a probe pattern from the parameters this upgrade matched.
 *
 * The result is handed to Nitro's `localFetch`, which routes on it, so it has to
 * be a path: an absolute URL would probe another host, and a `..` segment would
 * probe a route the upgrade never named. Both are programming errors in an
 * authoriser, so both throw rather than resolve to something surprising.
 */
function interpolate(routePath, params) {
    if (!routePath.startsWith('/')) {
        throw new TypeError(`authorizeViaRoute("${routePath}") needs a path starting with "/", not a URL or a relative path.`);
    }
    return routePath
        .split('/')
        .map((segment) => {
        if (!segment.startsWith(':')) {
            if (segment === '.' || segment === '..') {
                throw new TypeError(`authorizeViaRoute("${routePath}") has a "${segment}" segment. Name the route to probe outright.`);
            }
            return segment;
        }
        const name = segment.slice(1);
        const value = params[name];
        if (value === undefined) {
            throw new TypeError(`authorizeViaRoute("${routePath}") needs the route parameter "${name}", which this upgrade route does not declare.`);
        }
        // `encodeURIComponent` escapes a "/" but leaves ".." exactly as it is, so
        // the one value that could still climb a path segment is rejected here.
        if (value === '.' || value === '..' || value.includes('/')) {
            throw new TypeError(`authorizeViaRoute("${routePath}") would interpolate ":${name}" as "${value}", which is not a single path segment.`);
        }
        return encodeURIComponent(value);
    })
        .join('/');
}
/** A refusal produced by the router itself, never by a Durable Object. */
function routerRefusal(status, message) {
    return new Response(message, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
}
/** A misconfiguration only the app can fix: never a handshake, never a 4xx. */
function routerFailure(message) {
    return routerRefusal(500, message);
}
/**
 * Apply the route's origin policy.
 *
 * Returns a 403 to send back, or `undefined` when the request may proceed to the
 * authoriser. A WebSocket handshake is exempt from CORS, so for a route
 * authorised from a cookie this is the check that stops another site opening a
 * socket with the viewer's session attached.
 */
function originRefusalFor(request, route, url) {
    const origin = request.headers.get('origin');
    if (origin === null) {
        if (route.allowMissingOrigin === true)
            return undefined;
        return routerRefusal(403, `An upgrade on "${route.path}" must send an Origin header. A non-browser client is opted in with allowMissingOrigin: true.`);
    }
    if (isOriginAllowed(origin, route.origins, url.host))
        return undefined;
    return routerRefusal(403, `Origin "${origin}" may not open a WebSocket on "${route.path}".`);
}
/**
 * Build the upgrade router.
 *
 * Every route pattern is compiled once, here, so a bad pattern fails when the
 * Worker's module graph evaluates rather than on a request. The module's
 * build-time validator has already rejected one, so this only catches a
 * hand-written configuration.
 */
export function createUpgradeRouter(options) {
    const routes = options.upgrades.map((route, index) => compile(route, index));
    const { localFetch } = options;
    return async (request, env, executionContext, next) => {
        // Every request the router does not answer itself reaches the app with the
        // router's own prefix already stripped, so an object an h3 route reaches
        // through `stub.fetch(request)` cannot be handed a client-set principal.
        if (!isWebSocketUpgrade(request))
            return next(withoutRouterHeaderRequest(request));
        // Only a GET can be a WebSocket handshake (RFC 6455 s4.1). A POST carrying
        // `Upgrade: websocket` is not one and must not be routed as one: the
        // authorising probe is a GET, so forwarding any other method would hand the
        // object a request the guard that allowed it never saw.
        if (request.method !== 'GET')
            return next(withoutRouterHeaderRequest(request));
        const url = new URL(request.url);
        let matched;
        for (const route of routes) {
            const params = matchUpgradePath(route.segments, url.pathname);
            if (params) {
                matched = { route, params };
                break;
            }
        }
        // Not an upgrade this app declared: hand it back to the app, which answers
        // it exactly as it would have without this router installed.
        if (!matched)
            return next(withoutRouterHeaderRequest(request));
        const { route, params } = matched;
        // Before the authoriser: a cross-site handshake is refused whether or not the
        // route would have authorised the session it carries.
        const refusedOrigin = originRefusalFor(request, route, url);
        if (refusedOrigin)
            return refusedOrigin;
        const objectName = objectNameFor(route, params);
        if (objectName === undefined) {
            return routerFailure(`Upgrade route "${route.path}" resolves no Durable Object name from idFrom "${route.idFrom}".`);
        }
        const namespace = namespaceFor(env, route.binding);
        if (!namespace) {
            return routerFailure(`Upgrade route "${route.path}" has no Durable Object namespace bound as "${route.binding}".`);
        }
        // A spoofed principal header dies here, before the authoriser and before
        // the app route sees the request.
        const trusted = deriveRequest(request, withoutRouterHeaders(request.headers));
        const verdict = route.authorize
            ? await route.authorize(authorizeContext({
                env,
                executionContext,
                localFetch,
                objectName,
                params,
                path: route.path,
                request: trusted,
                url,
            }))
            : { ok: true };
        if (verdict instanceof Response) {
            // Only a Durable Object's `acceptWebSocket` may answer 101. An authoriser
            // that returns one is a bug that would otherwise reach a client as a
            // handshake nothing is listening behind.
            if (verdict.status === 101) {
                return routerFailure(`The authoriser for "${route.path}" answered 101. Only the Durable Object may complete a handshake.`);
            }
            return verdict;
        }
        // An authoriser writes only in the router's own namespace. Any other name
        // would let it re-add `cookie` or overwrite `upgrade`, which is exactly what
        // `forwardHeaders` is validated at build time to prevent.
        const foreign = Object.keys(verdict.headers ?? {}).find((name) => !name.toLowerCase().startsWith(NARDUK_ROUTER_HEADER_PREFIX));
        if (foreign !== undefined) {
            return routerFailure(`The authoriser for "${route.path}" returned the header "${foreign}". Only "${NARDUK_ROUTER_HEADER_PREFIX}*" headers may be added to a forwarded upgrade; name a client header in forwardHeaders instead.`);
        }
        // Derived from the trusted request, not rebuilt from its URL: the method is
        // the GET that was authorised, and `cf` reaches the object.
        const forwarded = deriveRequest(trusted, forwardedHeaders(trusted.headers, route.denied, verdict.headers));
        return namespace.get(namespace.idFromName(objectName)).fetch(forwarded);
    };
}
function forwardedHeaders(headers, denied, added) {
    const forwarded = withoutHeaders(headers, [...denied]);
    for (const [name, value] of Object.entries(added ?? {}))
        forwarded.set(name, value);
    return forwarded;
}
/**
 * Derive a request from another one, replacing its headers.
 *
 * `new Request(source, ...)` rather than `new Request(source.url, ...)`: the
 * method, body and -- on workerd -- the `cf` object carrying colo, country and
 * TLS details all come across, where rebuilding from the URL would silently drop
 * them. A runtime that does not copy `cf` (Node's `Request`, which is what the
 * unit tests run on) has it re-attached, so the property means the same thing
 * everywhere; on workerd that branch never runs.
 */
function deriveRequest(source, headers) {
    const derived = new Request(source, { headers });
    const cf = source.cf;
    if (cf === undefined || derived.cf !== undefined)
        return derived;
    try {
        Object.defineProperty(derived, 'cf', { configurable: true, enumerable: true, value: cf });
    }
    catch {
        // A runtime that refuses the copy owns `cf` itself; the request is unaffected.
    }
    return derived;
}
/**
 * The request to hand the app, with every inbound `x-narduk-*` header removed.
 *
 * Rebuilt only when there is something to strip: the common case is every
 * ordinary request the Worker serves, and it must not pay for a copy.
 */
function withoutRouterHeaderRequest(request) {
    for (const name of request.headers.keys()) {
        if (name.toLowerCase().startsWith(NARDUK_ROUTER_HEADER_PREFIX)) {
            return deriveRequest(request, withoutRouterHeaders(request.headers));
        }
    }
    return request;
}
function authorizeContext(parts) {
    const { env, executionContext, localFetch, objectName, params, path, request, url } = parts;
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
                throw new TypeError("authorizeViaRoute needs Nitro's localFetch. Create the router with { localFetch: (path, init) => useNitroApp().localFetch(path, init) }.");
            }
            const target = routePath ? interpolate(routePath, params) : url.pathname + url.search;
            const response = await localFetch(target, {
                method: 'GET',
                headers: withoutHeaders(withoutRouterHeaders(probeRequest.headers), HANDSHAKE_HEADERS),
                host: url.hostname,
                protocol: url.protocol,
                // The same context shape Nitro's own Cloudflare handler builds, so the
                // route reaches D1, KV and the rest through `event.context.cloudflare`.
                context: {
                    waitUntil: (promise) => executionContext.waitUntil(promise),
                    _platform: {
                        cf: request.cf,
                        cloudflare: { request, env, context: executionContext, url },
                    },
                },
            });
            return { ok: response.status >= 200 && response.status < 300, response };
        },
    };
}
/**
 * Wrap a Worker handler so `fetch` runs the upgrade router first.
 *
 * Every other handler the entry exports (`scheduled`, `queue`, `email`, `tail`,
 * `trace`) is copied across untouched, so wrapping is invisible to them.
 */
export function withUpgradeRouter(handler, router) {
    return Object.assign({}, handler, {
        fetch: (request, env, executionContext) => router(request, env, executionContext, (forwarded) => handler.fetch(forwarded, env, executionContext)),
    });
}
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER, principalFromRequest } from './principal.js';
export { isOriginAllowed, parseUpgradeOrigin, sameOriginFor } from './upgrade-origin.js';
export { matchUpgradePath, parseUpgradePath } from './upgrade-path.js';
//# sourceMappingURL=upgrade-router.js.map