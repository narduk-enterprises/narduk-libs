export interface AppleMapsServerConfig {
    /** Apple Maps identifier used as the JWT `appid` claim. */
    appId?: string;
    /** A pre-signed Maps auth JWT accepted by `/v1/token`. */
    authToken?: string;
    cache?: false | AppleMapsAccessTokenCacheConfig;
    fetch?: typeof fetch;
    keyId?: string;
    privateKey?: CryptoKey | string;
    teamId?: string;
}
export interface AppleMapsAccessTokenCacheConfig {
    refreshWindowMs?: number;
}
export interface AppleMapsAccessTokenResponse {
    accessToken: string;
    expiresInSeconds?: number;
}
export interface AppleMapsCoordinate {
    latitude?: number | string;
    longitude?: number | string;
}
export interface AppleMapsSearchResult {
    coordinate?: AppleMapsCoordinate;
    country?: string;
    countryCode?: string;
    displayName?: string;
    formattedAddressLines?: string[];
    name?: string;
    poiCategory?: string;
    structuredAddress?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface AppleMapsSearchResponse {
    displayMapRegion?: Record<string, unknown>;
    results?: AppleMapsSearchResult[];
}
export interface AppleMapsGeocodeResponse {
    results?: AppleMapsSearchResult[];
}
export interface AppleMapsSearchOptions {
    accessToken?: string;
    categories?: readonly string[];
    fetch?: typeof fetch;
    includeAddressCategories?: string;
    includePoiCategories?: string;
    language?: string;
    lat?: number;
    limit?: number;
    limitToCountries?: string;
    lng?: number;
    resultTypeFilter?: 'Address' | 'Poi';
    searchLocation?: {
        lat: number;
        lng: number;
    };
    searchRegion?: string | {
        east: number;
        north: number;
        south: number;
        west: number;
    };
    serverConfig?: AppleMapsServerConfig;
}
export interface AppleMapsGeocodeOptions {
    accessToken?: string;
    fetch?: typeof fetch;
    language?: string;
    limitToCountries?: string;
    searchRegion?: string;
    serverConfig?: AppleMapsServerConfig;
}
export interface AppleMapsCreds {
    appleKeyId: string;
    appleMapsAppId?: string;
    appleSecretKey: string;
    appleTeamId: string;
    mapkitServerApiKey: string;
}
export interface AppleMapsExchangedAccessToken {
    accessToken: string;
    expiresAtMs: number;
}
/** Create the short-lived Maps auth JWT exchanged at Apple's `/v1/token`. */
export declare function createAppleMapsDeveloperToken(config: AppleMapsServerConfig): Promise<string>;
/** Compatibility alias for the former maps-layer credential shape. */
export declare function getDeveloperToken(config: AppleMapsCreds): Promise<string>;
/** Exchange an Apple Maps auth JWT for a Maps Server API access token. */
export declare function exchangeAppleMapsAccessToken(authToken: string, fetchImpl?: typeof fetch): Promise<AppleMapsExchangedAccessToken>;
/** Resolve and cache an Apple Maps Server API access token. */
export declare function getAppleMapsAccessToken(config: AppleMapsServerConfig): Promise<string>;
/** Search the Apple Maps Server API for places or addresses. */
export declare function searchAppleMaps(query: string, options?: AppleMapsSearchOptions): Promise<AppleMapsSearchResponse>;
/** Geocode an address through the Apple Maps Server API. */
export declare function geocodeAppleMaps(address: string, options?: AppleMapsGeocodeOptions): Promise<AppleMapsGeocodeResponse>;
/** Compatibility helper matching the former layer's place-search result shape. */
export declare function searchPlaces(accessToken: string, options: Omit<AppleMapsSearchOptions, 'accessToken' | 'resultTypeFilter'> & {
    query: string;
}): Promise<AppleMapsSearchResult[]>;
/** Search for a neighborhood/sub-locality address result. */
export declare function searchAppleMapsNeighborhood(name: string, options?: Omit<AppleMapsSearchOptions, 'resultTypeFilter'> & {
    locationContext?: string;
}): Promise<AppleMapsSearchResponse>;
export declare function clearAppleMapsAccessTokenCacheForTests(): void;
//# sourceMappingURL=apple-maps.d.ts.map