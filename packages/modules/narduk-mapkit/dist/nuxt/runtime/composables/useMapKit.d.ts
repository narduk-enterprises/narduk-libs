import type { MapKitFailure, MapKitLibrary } from '../../../client/mapkit.js';
import type { MapKit } from '@apple/mapkit-loader';
import type { DeepReadonly, Ref, ShallowRef } from 'vue';
export interface UseMapKitOptions {
    language?: string;
    /** Overrides the module's `libraries` default for this page. */
    libraries?: readonly MapKitLibrary[];
    tokenEndpoint?: string;
}
export interface UseMapKitResult {
    failure: Readonly<Ref<MapKitFailure | null>>;
    /** The live namespace once `ready` is true. */
    mapkit: Readonly<ShallowRef<MapKit | null>>;
    ready: DeepReadonly<Ref<boolean>>;
    /** Drop the failed singleton and initialise again. */
    retry: () => void;
}
/** Test seam: the singleton is module state, so a suite has to be able to clear it. */
export declare function resetMapKitComposableStateForTests(): void;
export declare function useMapKit(options?: UseMapKitOptions): UseMapKitResult;
//# sourceMappingURL=useMapKit.d.ts.map