import { NARDUK_ROUTER_HEADER_PREFIX } from './principal.js';
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
function compile(route) {
    const parsed = parseUpgradePath(route.path);
    if (!parsed.ok) {
        throw new TypeError(`Upgrade route "${route.path}" ${parsed.reason}.`);
    }
    const allowed = new Set((route.forwardHeaders ?? []).map((name) => name.toLowerCase()));
    return {
        ...route,
        segments: parsed.segments,
        denied: new Set(DENIED_FORWARD_HEADERS.filter((name) => !allowed.has(name))),
    };
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
function interpolate(routePath, params) {
    return routePath
        .split('/')
        .map((segment) => {
        if (!segment.startsWith(':'))
            return segment;
        const value = params[segment.slice(1)];
        if (value === undefined) {
            throw new TypeError(`authorizeViaRoute("${routePath}") needs the route parameter "${segment.slice(1)}", which this upgrade route does not declare.`);
        }
        return encodeURIComponent(value);
    })
        .join('/');
}
/** A refusal produced by the router itself, never by a Durable Object. */
function routerFailure(message) {
    return new Response(message, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
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
    const routes = options.upgrades.map((route) => compile(route));
    const { localFetch } = options;
    return async (request, env, executionContext, next) => {
        if (!isWebSocketUpgrade(request))
            return next(request);
        const url = new URL(request.url);
        let matched;
        for (const route of routes) {
            const params = matchUpgradePath(route.segments, url.pathname);
            if (params) {
                matched = { route, params };
                break;
            }
        }
        // Not an upgrade this app declared: hand it back untouched. The app answers
        // it exactly as it would have without this router installed.
        if (!matched)
            return next(request);
        const { route, params } = matched;
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
        const trusted = new Request(request, { headers: withoutRouterHeaders(request.headers) });
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
        const forwarded = new Request(url, {
            method: trusted.method,
            headers: forwardedHeaders(trusted.headers, route.denied, verdict.headers),
        });
        return namespace.get(namespace.idFromName(objectName)).fetch(forwarded);
    };
}
function forwardedHeaders(headers, denied, added) {
    const forwarded = withoutHeaders(headers, [...denied]);
    for (const [name, value] of Object.entries(added ?? {}))
        forwarded.set(name, value);
    return forwarded;
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
export { matchUpgradePath, parseUpgradePath } from './upgrade-path.js';
//# sourceMappingURL=upgrade-router.js.map