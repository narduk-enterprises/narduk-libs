import type { MapKitLibrary } from '../../client/mapkit.js';
export { DEFAULT_MAPKIT_LIBRARIES, DEFAULT_MAPKIT_TOKEN_ROUTE } from './defaults.js';
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