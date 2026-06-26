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
export declare function createMapKitToken(options: MapKitJwtOptions): Promise<string>;
export declare function createAppleMapsAuthToken(options: AppleMapsAuthTokenOptions): Promise<string>;
export declare function decodeJwt(token: string): DecodedJwt;
export declare function decodeBase64UrlJson(segment: string): Record<string, unknown>;
export declare function isJwtExpired(token: string, nowMs?: number, refreshWindowMs?: number): boolean;
export declare const isMapKitTokenExpired: typeof isJwtExpired;
//# sourceMappingURL=jwt.d.ts.map