import type { MapKitLibrary } from '../../client/mapkit.js';
export declare const DEFAULT_MAPKIT_LIBRARIES: MapKitLibrary[];
export declare const DEFAULT_MAPKIT_TOKEN_ROUTE = "/api/mapkit-token";
/** The non-secret shape the module publishes for the client runtime. */
export interface MapKitPublicRuntimeOptions {
    language?: string;
    libraries?: MapKitLibrary[];
    ssrPreload?: boolean;
    tokenRoutePath?: string;
}
export interface ResolvedMapKitRuntimeOptions {
    language: string | undefined;
    libraries: readonly MapKitLibrary[];
    tokenEndpoint: string;
}
export declare function readMapKitPublicOptions(): MapKitPublicRuntimeOptions;
export declare function resolveMapKitRuntimeOptions(overrides: {
    language?: string;
    libraries?: readonly MapKitLibrary[];
    tokenEndpoint?: string;
}): ResolvedMapKitRuntimeOptions;
//# sourceMappingURL=options.d.ts.map