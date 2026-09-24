import type { Ref } from 'vue';
export interface UseMapKitFullscreenOptions {
    onLayout: () => void;
    surface: () => HTMLElement | null;
}
export interface UseMapKitFullscreenResult {
    active: Readonly<Ref<boolean>>;
    toggle: () => void;
}
export declare function useMapKitFullscreen(options: UseMapKitFullscreenOptions): UseMapKitFullscreenResult;
//# sourceMappingURL=useMapKitFullscreen.d.ts.map