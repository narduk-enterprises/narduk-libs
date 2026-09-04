export interface MapKitClientOptions {
    document?: Document;
    fetchImpl?: typeof fetch;
    mapkitGlobal?: unknown;
    scriptUrl?: string;
    staticToken?: string;
    tokenEndpoint?: string;
    tokenRefreshWindowMs?: number;
    window?: Window;
}
export interface MapKitTokenEndpointResponse {
    configured?: boolean;
    error?: string;
    token?: string;
}
export interface MapKitRuntime {
    init(options: {
        authorizationCallback(done: (token: string) => void): void;
    }): void;
}
export interface MapKitLibraryRuntime extends MapKitRuntime {
    load?: (libraries: string | string[]) => Promise<unknown>;
}
export declare const MAPKIT_JS_V6_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/6/mapkit.core.js";
export declare function loadMapKitScript(options?: MapKitClientOptions): Promise<void>;
export declare function fetchMapKitToken(endpoint?: string, fetchImpl?: typeof fetch): Promise<string>;
export declare function initializeMapKit(options?: MapKitClientOptions): Promise<MapKitRuntime>;
/** Load optional MapKit JS 6 libraries after initializeMapKit() completes. */
export declare function loadMapKitLibraries(mapkit: MapKitLibraryRuntime, libraries?: string | string[]): Promise<void>;
export declare function resetMapKitClientStateForTests(): void;
//# sourceMappingURL=mapkit.d.ts.map