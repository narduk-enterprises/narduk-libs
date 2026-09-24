import type { FrameInsets, FrameSize, LatLon, LngLatBox, MapTier } from '../../../marks/camera.js';
import type { MarkSpec } from '../../../marks/layer.js';
import type { MkMapRect, MkMapType } from '../../../marks/runtime.js';
import type { ComputedRef, Ref } from 'vue';
export interface UseMapKitViewOptions {
    /** Base map to show. Applied to the live map, not through `<AppMapKit>`'s prop. */
    basemap: () => MkMapType;
    /** Pixels of chrome over each edge of the map the camera must keep clear. */
    insets: () => FrameInsets;
    /**
     * Pixels MapKit itself keeps clear inside each edge, as `map.padding`.
     * MapKit JS 6 paints Apple's logo and Legal link INTO the canvas at the
     * bottom-left of this padded box -- there is no DOM node for them -- so
     * padding is the only way to lift them out from under the page's chrome.
     * Omitted, the map is unpadded. The view keeps the camera in whole-frame
     * terms either way: `rect`, `fitBox` and `reveal` never see the padding.
     */
    padding?: () => FrameInsets;
    /** Marks for the current camera and data; re-read whenever its inputs change. */
    specs: () => readonly MarkSpec[];
    /** Map plus its chrome; the element fullscreen presents. */
    surface: () => HTMLElement | null;
}
export interface UseMapKitViewResult {
    /** Frames a lat/lon box inside the part of the map the chrome leaves free. */
    fitBox: (box: LngLatBox, animate?: boolean) => void;
    /** The map element's last real size, in CSS pixels. */
    frame: Readonly<Ref<FrameSize>>;
    fullscreen: Readonly<Ref<boolean>>;
    /** True once the map exists AND its host has a laid-out box. */
    mapReady: Readonly<Ref<boolean>>;
    /** `<AppMapKit>`'s `map-ready` handler: `(map, mapkit)`, both untyped. */
    onMapReady: (map: unknown, mapkit: unknown) => void;
    /** The whole-frame visible map rect, padding removed. */
    rect: Readonly<Ref<MkMapRect | null>>;
    /** Pans a coordinate into the free area at the current zoom; already there is a no-op. */
    reveal: (point: LatLon, animate?: boolean) => void;
    tier: ComputedRef<MapTier>;
    toggleFullscreen: () => void;
    /** Zooms around the camera centre; a factor above 1 zooms in. */
    zoomBy: (factor: number) => void;
}
export declare function useMapKitView(options: UseMapKitViewOptions): UseMapKitViewResult;
//# sourceMappingURL=useMapKitView.d.ts.map