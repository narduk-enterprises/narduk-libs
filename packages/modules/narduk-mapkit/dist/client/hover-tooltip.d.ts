import type { MapKitTimerScheduler } from './timers.js';
export declare const MAPKIT_TOOLTIP_ATTRIBUTE = "data-mapkit-tooltip";
export interface MapKitHoverTooltipOptions {
    /** The map container. The tooltip is a child of it and positioned inside it. */
    container: HTMLElement;
    /** Injected so a plain-TS test can run against any document. */
    document?: Document;
    /** Minimum distance from every container edge, in CSS px. Default 4. */
    edgePadding?: number;
    /** Distance between the marker and the tooltip, in CSS px. Default 8. */
    gap?: number;
    /** Delay before hiding, in ms. Default 0. */
    hideDelayMs?: number;
    /** Pointer types that open it. Default `['mouse', 'pen']`: not touch. */
    pointerTypes?: readonly string[];
    scheduler?: MapKitTimerScheduler;
    /** Delay before showing, in ms. Default 150, so a pointer crossing the map shows nothing. */
    showDelayMs?: number;
}
/** Text, or `null` / `undefined` / `''` for "no tooltip for this marker right now". */
export type MapKitTooltipContent = () => string | null | undefined;
export declare class MapKitHoverTooltip {
    #private;
    constructor(options: MapKitHoverTooltipOptions);
    /** The tooltip element, for styling (`[data-mapkit-tooltip]`). */
    get element(): HTMLElement;
    get visible(): boolean;
    /**
     * Show `content` on `target` while the pointer rests on it or it has focus.
     * Returns the function that detaches those listeners.
     */
    attach(target: HTMLElement, content: MapKitTooltipContent): () => void;
    /** Show `text` on `target` now, with no delay. */
    show(target: HTMLElement, text: string): void;
    /** Re-place a visible tooltip against its marker, e.g. after the map moved. */
    reposition(): void;
    hide(): void;
    destroy(): void;
}
export declare function createMapKitHoverTooltip(options: MapKitHoverTooltipOptions): MapKitHoverTooltip;
//# sourceMappingURL=hover-tooltip.d.ts.map