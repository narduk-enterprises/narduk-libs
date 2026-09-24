import type { MapKitPinGeometry } from './pin-geometry.js';
import type { MapKitAnnotationLike, MapKitMapLike, MapKitNamespaceLike } from './mapkit-surface.js';
/** The minimum an `<AppMapKit>` item carries: somewhere to put it. */
export interface MapKitPinItem {
    lat: number;
    lng: number;
}
/** What one `setItems()` or `setSelected()` did, as `getDiagnostics().lastDiff`. */
export interface MapKitDiff {
    added: string[];
    moved: string[];
    removed: string[];
    restyled: string[];
}
export interface MapKitPinElement {
    cleanup?: () => void;
    element: HTMLElement;
}
/** How a pin selection was made. */
export type MapKitSelectVia = 'keyboard' | 'pointer';
export interface MapKitPinLayerOptions<T extends MapKitPinItem> {
    /** Merges nearby pins into cluster bubbles at low zoom. Unchanged from 2.0.x. */
    clusteringIdentifier?: string;
    /** The app's glyph factory. Without one the layer renders nothing. */
    createPinElement?: (item: T, isSelected: boolean) => MapKitPinElement;
    /** Injected so a plain-TS test can run against any document. */
    document?: Document;
    /**
     * Whether the library-owned host is an interactive control. Default `true`.
     *
     * 2.1.0 had no way to say otherwise (2.1.1, K-8): every host carried
     * `role="button"` and `tabindex="0"`, so a decorative map marked
     * `aria-hidden="true"` was full of focusable descendants -- axe's
     * `aria-hidden-focus` -- and the only way out was `inert` on the consumer's
     * side. `false` builds a plain host: no role, no tabindex, no `aria-pressed`,
     * no click or key listener, and no required `itemLabel`.
     */
    focusable?: boolean;
    /** Stable identity per item. Must be non-blank and unique. */
    itemKey: (item: T, index: number) => string;
    /**
     * Accessible name of the library-owned host. Required whenever `items` is
     * non-empty AND the host is focusable; a non-interactive host has no
     * accessible name to carry.
     */
    itemLabel?: (item: T) => string;
    map: MapKitMapLike;
    mapkit: MapKitNamespaceLike;
    /**
     * Called when a pin is activated by pointer or keyboard, with the toggled id
     * and which of the two activated it.
     */
    /**
     * Called when the pointer enters or leaves a pin host. The layer does not
     * apply hover itself -- the host's `hoveredId` (or the app) writes it back
     * through `setHovered`, the same way `selectedId` works.
     */
    onHover?: (id: string | null) => void;
    onSelect?: (id: string | null, via: MapKitSelectVia) => void;
    pinGeometry?: (item: T) => MapKitPinGeometry;
}
/** `item.id` is the default key, so the common case needs no `itemKey` prop. */
export declare function defaultMapKitItemKey(item: unknown, index: number): string;
export declare class MapKitPinLayer<T extends MapKitPinItem> {
    #private;
    constructor(options: MapKitPinLayerOptions<T>);
    get hoveredId(): string | null;
    get selectedId(): string | null;
    get size(): number;
    /** `getDiagnostics()` on the component's expose (§c.6). */
    getDiagnostics(): {
        annotations: number;
        lastDiff: MapKitDiff;
    };
    /** The annotation for a key, for a caller that needs MapKit's own object. */
    annotationFor(key: string): MapKitAnnotationLike | undefined;
    /** The library-owned host element for a key. The `#callout` seam anchors on it. */
    hostFor(key: string): HTMLElement | undefined;
    itemFor(key: string): T | undefined;
    keys(): readonly string[];
    /**
     * Sync the map to exactly `items`.
     *
     * One batched `removeAnnotations` and one batched `addAnnotations` at most;
     * an unchanged key makes neither call, and a moved or restyled key is applied
     * in place rather than recreated.
     */
    setItems(items: readonly T[]): MapKitDiff;
    /**
     * Move the selection.
     *
     * Zero adds, zero removes: exactly the outgoing and the incoming glyph are
     * re-rendered inside hosts that are not replaced, so focus survives.
     */
    setSelected(id: string | null): MapKitDiff;
    /**
     * Mark the hovered pin.
     *
     * Zero adds, zero removes, and no glyph rewrite: only `data-mapkit-hovered`
     * moves, so a hover cannot recreate the host the pointer is on.
     */
    setHovered(id: string | null): void;
    /** Remove every pin and make the layer inert. Idempotent. */
    destroy(): void;
}
//# sourceMappingURL=pin-layer.d.ts.map