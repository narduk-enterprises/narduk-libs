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
/** A configured origin that parsed. */
export interface UpgradeOriginParsed {
    ok: true;
    /** The normalised origin: scheme and host, lowercased, no trailing slash. */
    origin: string;
}
/** A configured origin that did not parse, and why. */
export interface UpgradeOriginRejected {
    ok: false;
    reason: string;
}
/**
 * Result of parsing a configured origin.
 *
 * Two named arms rather than an inline union, for the Prettier-version reason
 * documented on `UpgradePathParse`.
 */
export type UpgradeOriginParse = UpgradeOriginParsed | UpgradeOriginRejected;
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
export declare function parseUpgradeOrigin(value: string): UpgradeOriginParse;
/** The origin a request's own `Host` implies: same host, over https. */
export declare function sameOriginFor(host: string): string;
/**
 * Is this inbound `Origin` allowed to open a socket on this route?
 *
 * `allowed` is the route's `allowedOrigins`, already normalised. When it is
 * absent the policy is same-origin against `host`; when it is present it
 * **replaces** that default, so an app listing a partner origin and still
 * wanting its own must name both.
 */
export declare function isOriginAllowed(value: string, allowed: ReadonlySet<string> | undefined, host: string): boolean;
//# sourceMappingURL=upgrade-origin.d.ts.map