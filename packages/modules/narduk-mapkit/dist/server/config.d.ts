import type { MapKitDopplerConfig, MapKitEnv, MapKitServerConfig } from './shared-config.js';
export { hasSigningConfig, hasUsableStaticToken, isOriginAllowed, parseAllowedOrigins, } from './shared-config.js';
export type { MapKitDopplerConfig, MapKitEnv, MapKitServerConfig, MapKitTokenCacheConfig, } from './shared-config.js';
export declare function readProcessEnv(): MapKitEnv;
export declare function mapKitConfigFromEnv(env?: MapKitEnv): MapKitServerConfig;
export declare function resolveMapKitServerConfig(config?: MapKitServerConfig, env?: MapKitEnv): Promise<MapKitServerConfig>;
export declare function mapKitConfigFromDoppler(options?: MapKitDopplerConfig): Promise<MapKitServerConfig>;
//# sourceMappingURL=config.d.ts.map