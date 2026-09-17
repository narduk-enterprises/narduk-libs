import type { MapKitLibrary } from '../../client/mapkit.js';
export interface MapKitPreloadOptions {
    language?: string;
    libraries?: readonly MapKitLibrary[];
    nonce?: string | undefined;
}
export declare function useMapKitPreload(options?: MapKitPreloadOptions): void;
//# sourceMappingURL=preload.d.ts.map