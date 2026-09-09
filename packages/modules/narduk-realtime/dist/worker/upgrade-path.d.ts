/**
 * Route-pattern parsing shared by the build-time validator and the runtime
 * router, so an upgrade path can only ever mean one thing.
 *
 * The supported syntax is the h3/radix3 subset that an upgrade route can safely
 * use: literal segments and `:param`. Wildcards (`*`, `**`) are **rejected** --
 * an upgrade is a long-lived authenticated socket, and a pattern that matches
 * paths nobody enumerated is how one ends up reachable without a guard. Use one
 * entry per upgradeable route instead.
 */
/** A parsed path segment. */
export type UpgradePathSegment = {
    kind: 'static';
    value: string;
} | {
    kind: 'param';
    name: string;
};
/** Result of parsing a pattern: either the compiled segments or why it failed. */
export type UpgradePathParse = {
    ok: true;
    segments: UpgradePathSegment[];
    params: string[];
} | {
    ok: false;
    reason: string;
};
/**
 * Parse an upgrade route pattern.
 *
 * Never throws: the caller decides whether a bad pattern is a configuration
 * error (build time) or a programming error (runtime construction).
 */
export declare function parseUpgradePath(pattern: string): UpgradePathParse;
/**
 * Match a request pathname against parsed segments.
 *
 * Returns the extracted parameters, or `undefined` when the path does not match.
 * A parameter is percent-decoded (as `getRouterParam` would) and must be
 * non-empty; an undecodable value does not match at all, so a malformed URL
 * falls through to the app rather than reaching a Durable Object name.
 */
export declare function matchUpgradePath(segments: readonly UpgradePathSegment[], pathname: string): Record<string, string> | undefined;
//# sourceMappingURL=upgrade-path.d.ts.map