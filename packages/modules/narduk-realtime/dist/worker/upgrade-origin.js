/**
 * Origin policy for an upgrade route, shared by the build-time validator and the
 * runtime router so a configured origin can only ever mean one thing.
 *
 * ## Why an upgrade needs its own origin check
 *
 * A WebSocket handshake is **exempt from CORS**: the browser sends it with the
 * site's cookies attached and no preflight, and no response header can stop it.
 * So for a route the router deliberately authorises from a cookie
 * (`authorizeViaRoute` keeps `cookie` on purpose), the only thing standing
 * between a viewer's session and a socket opened by another site is the `Origin`
 * header the browser is obliged to send. That is what this module compares.
 *
 * The default is same-origin over **https**: `https://<the request's Host>`. It
 * is deliberately not "whatever scheme the request arrived on" -- a deployed
 * Worker is always https, and accepting `http://<host>` would accept a stripped
 * connection. An `http` origin (a `wrangler dev` front end, say) is opted into
 * explicitly through `allowedOrigins`.
 */
/** Schemes an origin may use. */
const ORIGIN_SCHEMES = ['http:', 'https:'];
/**
 * Parse an origin -- a configured `allowedOrigins` entry, or an inbound `Origin`
 * header value.
 *
 * Never throws: the caller decides whether a bad value is a configuration error
 * (build time), a programming error (router construction) or a refusal to send
 * back (a request). A wildcard is rejected outright rather than treated as
 * "any": an upgrade is a long-lived authenticated socket, so the one thing this
 * check exists to prevent must not be spellable as a single character.
 */
export function parseUpgradeOrigin(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, reason: 'is empty, and an origin looks like "https://app.example"' };
    }
    const candidate = value.trim();
    if (candidate.includes('*')) {
        return {
            ok: false,
            reason: "is a wildcard, which would let any site open a socket with the viewer's cookies attached: name every origin instead",
        };
    }
    let url;
    try {
        url = new URL(candidate);
    }
    catch {
        // `Origin: null` (an opaque origin -- a sandboxed frame, a `file://` page)
        // lands here too, and is refused for the same reason a wildcard is.
        return { ok: false, reason: 'is not an absolute origin, for example "https://app.example"' };
    }
    if (!ORIGIN_SCHEMES.includes(url.protocol)) {
        return {
            ok: false,
            reason: `uses the "${url.protocol}" scheme, and an origin must be http or https`,
        };
    }
    if (url.username.length > 0 || url.password.length > 0) {
        return { ok: false, reason: 'carries credentials, and an origin is scheme and host only' };
    }
    if ((url.pathname !== '/' && url.pathname.length > 0) ||
        url.search.length > 0 ||
        url.hash.length > 0) {
        return {
            ok: false,
            reason: 'has a path, query or fragment, and an origin is scheme and host only',
        };
    }
    return { ok: true, origin: url.origin };
}
/** The origin a request's own `Host` implies: same host, over https. */
export function sameOriginFor(host) {
    return `https://${host.toLowerCase()}`;
}
/**
 * Is this inbound `Origin` allowed to open a socket on this route?
 *
 * `allowed` is the route's `allowedOrigins`, already normalised. When it is
 * absent the policy is same-origin against `host`; when it is present it
 * **replaces** that default, so an app listing a partner origin and still
 * wanting its own must name both.
 */
export function isOriginAllowed(value, allowed, host) {
    const parsed = parseUpgradeOrigin(value);
    if (!parsed.ok)
        return false;
    return allowed ? allowed.has(parsed.origin) : parsed.origin === sameOriginFor(host);
}
//# sourceMappingURL=upgrade-origin.js.map