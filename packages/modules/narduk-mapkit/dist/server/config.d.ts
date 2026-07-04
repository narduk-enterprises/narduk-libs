export interface MapKitServerConfig {
    allowedOrigins?: readonly string[] | string;
    cache?: false | MapKitTokenCacheConfig;
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
export declare function mapKitConfigFromEnv(env?: MapKitEnv): MapKitServerConfig;
export declare function resolveMapKitServerConfig(config?: MapKitServerConfig, env?: MapKitEnv): Promise<MapKitServerConfig>;
export declare function mapKitConfigFromDoppler(options?: MapKitDopplerConfig): Promise<MapKitServerConfig>;
export declare function parseAllowedOrigins(input: readonly string[] | string | undefined): string[];
export declare function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean;
export declare function hasSigningConfig(config: MapKitServerConfig): boolean;
export declare function hasUsableStaticToken(config: MapKitServerConfig): boolean;
//# sourceMappingURL=config.d.ts.map