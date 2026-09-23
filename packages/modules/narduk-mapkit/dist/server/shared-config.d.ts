export interface MapKitServerConfig {
    /**
     * Opt-in list of hosts the token route may mint for, compared with the
     * routed origin's `host` (hostname, plus `:port` when it is not the scheme
     * default), case-insensitively. `*.example.com` matches any subdomain of
     * `example.com`, not the apex. A routed host outside the list is refused 403
     * `not-same-origin` before the rate limiter and before signing. Unset or
     * empty, every routed host is accepted -- correct on Cloudflare Workers,
     * where the edge binds `Host` to the routed hostname. Set it on a Node
     * listener that accepts arbitrary `Host` headers (narduk-libs#437).
     */
    allowedHosts?: readonly string[] | string;
    allowedOrigins?: readonly string[] | string;
    cache?: false | MapKitTokenCacheConfig;
    /** Node-only fallback settings. Worker-safe entry points intentionally ignore this field. */
    doppler?: false | MapKitDopplerConfig;
    fallbackOrigin?: string;
    keyId?: string;
    privateKey?: string;
    staticToken?: string;
    teamId?: string;
    tokenExpiresInSeconds?: number;
}
export interface MapKitTokenCacheConfig {
    maxEntries?: number;
    refreshWindowMs?: number;
}
export interface MapKitDopplerConfig {
    command?: string;
    config?: string;
    enabled?: boolean;
    project?: string;
    timeoutMs?: number;
}
export interface MapKitEnv {
    APPLE_KEY_ID?: string;
    APPLE_MAPKIT_TOKEN?: string;
    APPLE_PRIVATE_KEY?: string;
    APPLE_SECRET_KEY?: string;
    APPLE_TEAM_ID?: string;
    MAPKIT_ALLOWED_ORIGINS?: string;
    MAPKIT_TOKEN?: string;
}
/**
 * Converts an explicitly supplied environment binding object into runtime
 * configuration. This function never reads `process.env` and is safe in
 * Cloudflare Workers and other Web-standard runtimes.
 */
export declare function mapKitConfigFromEnv(env?: MapKitEnv): MapKitServerConfig;
export declare function parseAllowedOrigins(input: readonly string[] | string | undefined): string[];
export declare function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean;
export declare function hasSigningConfig(config: MapKitServerConfig): boolean;
export declare function hasUsableStaticToken(config: MapKitServerConfig): boolean;
//# sourceMappingURL=shared-config.d.ts.map