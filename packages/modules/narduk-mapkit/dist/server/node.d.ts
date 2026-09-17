import { MAPKIT_SIGNING_FAILED_MESSAGE, clearMapKitTokenCacheForTests, getOriginFromRequest, mapKitRoutedOrigin, mapKitTokenResponseFromEnv } from './handler.js';
import type { MapKitTokenRequestOptions, MapKitTokenResponseOptions, MapKitTokenResult } from './handler.js';
import type { MapKitServerConfig } from './shared-config.js';
export * from './config.js';
export { MAPKIT_SIGNING_FAILED_MESSAGE, clearMapKitTokenCacheForTests, getOriginFromRequest, mapKitRoutedOrigin, mapKitTokenResponseFromEnv, };
export type { MapKitRateLimitContext, MapKitRateLimitDecision, MapKitRateLimitHook, MapKitRoutedOriginOptions, MapKitTokenRequestOptions, MapKitTokenResponseOptions, MapKitTokenResult, } from './handler.js';
/**
 * Node-only token resolver. It may read `process.env` and use the optional
 * Doppler CLI fallback before delegating token creation to the Web Crypto
 * implementation.
 */
export declare function issueMapKitTokenForRequest(options: MapKitTokenRequestOptions): Promise<MapKitTokenResult>;
export declare function mapKitTokenResponse(request: Request, config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): Promise<Response>;
export declare function createMapKitTokenHandler(config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): (request: Request) => Promise<Response>;
//# sourceMappingURL=node.d.ts.map