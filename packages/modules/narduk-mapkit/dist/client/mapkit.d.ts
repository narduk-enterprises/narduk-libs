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
export declare function loadMapKitScript(options?: MapKitClientOptions): Promise<void>;
export declare function fetchMapKitToken(endpoint?: string, fetchImpl?: typeof fetch): Promise<string>;
export declare function initializeMapKit(options?: MapKitClientOptions): Promise<MapKitRuntime>;
export declare function resetMapKitClientStateForTests(): void;
//# sourceMappingURL=mapkit.d.ts.map