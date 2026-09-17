export interface MapKitJwtOptions {
    expiresInSeconds?: number;
    issuedAtSeconds?: number;
    keyId: string;
    origin: string;
    privateKey: CryptoKey | string;
    teamId: string;
}
export interface AppleMapsAuthTokenOptions {
    appId: string;
    expiresInSeconds?: number;
    issuedAtSeconds?: number;
    keyId: string;
    privateKey: CryptoKey | string;
    teamId: string;
}
export interface DecodedJwt {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
}
/**
 * 1800 s (narduk-libs#421 §e.3), down from 24 h in 2.0.x.
 *
 * Read this accurately: `exp` bounds the window in which the JWT can be
 * EXCHANGED, not the session it buys. Measured against Apple on 2026-09-17: a
 * 45 s JWT still bought a 1800 s accessKey at `/ma/bootstrap`, independent of
 * `exp`. So a token leaked at minute 29 can still start a fresh 30-minute
 * session -- worst case about 60 minutes of usable life. That is still a large
 * improvement on 24 hours, and it is not a 30-minute usage guarantee.
 */
export declare const DEFAULT_MAPKIT_TOKEN_TTL_SECONDS = 1800;
export declare const DEFAULT_APPLE_MAPS_AUTH_TTL_SECONDS: number;
export declare function createMapKitToken(options: MapKitJwtOptions): Promise<string>;
export declare function createAppleMapsAuthToken(options: AppleMapsAuthTokenOptions): Promise<string>;
export declare function decodeJwt(token: string): DecodedJwt;
export declare function decodeBase64UrlJson(segment: string): Record<string, unknown>;
export declare function isJwtExpired(token: string, nowMs?: number, refreshWindowMs?: number): boolean;
export declare const isMapKitTokenExpired: typeof isJwtExpired;
//# sourceMappingURL=jwt.d.ts.map