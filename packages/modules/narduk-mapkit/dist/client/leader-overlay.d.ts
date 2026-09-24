/**
 * A line from an annotation's screen point to an anchor element.
 *
 * Follows the point on every `refresh()` (the host calls that on region
 * change and after the selected item moves), draws in an SVG overlay, and
 * reports when the point is off the map frame. `<AppMapKit>` wires this from
 * its `leader` prop; a consumer that draws its own pins on `./client` calls
 * the same class (narduk-libs#517).
 */
export declare const MAPKIT_LEADER_ATTRIBUTE = "data-mapkit-leader";
export declare const MAPKIT_LEADER_LINE_ATTRIBUTE = "data-mapkit-leader-line";
export declare const MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE = "data-mapkit-leader-offscreen";
export interface MapKitLeaderPoint {
    x: number;
    y: number;
}
export interface MapKitLeaderOverlayOptions {
    /** The positioned map host the SVG is appended to. */
    container: HTMLElement;
    /** Injected so a Node test can supply a document. */
    document?: Document;
    /** The card notch, caret or other element the line ends at. */
    getAnchor: () => HTMLElement | null;
    /**
     * The annotation's current position in the container's CSS pixels, or
     * `null` when there is no selection or it cannot be projected.
     */
    getPoint: () => MapKitLeaderPoint | null;
    /** Fires when the point's on-screen state changes, including the first paint. */
    onOffscreen?: (offscreen: boolean) => void;
}
export declare class MapKitLeaderOverlay {
    #private;
    constructor(options: MapKitLeaderOverlayOptions);
    get offscreen(): boolean;
    /** Re-read the point and the anchor. Call on region change and after items move. */
    refresh(): void;
    destroy(): void;
}
//# sourceMappingURL=leader-overlay.d.ts.map