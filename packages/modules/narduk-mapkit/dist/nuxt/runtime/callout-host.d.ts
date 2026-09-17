/**
 * The `#callout` seam (spec §c.4): a positioned host inside the map container
 * that an application fills with its own Vue tree.
 *
 * ## Why the library positions a host instead of rendering a callout
 *
 * MapKit's own callout takes an `HTMLElement`. Buoys' callout is a
 * `StationMapPopover` containing a `NuxtLink` -- a Vue component with a router
 * dependency -- so handing MapKit a detached, imperatively built element loses
 * the application's entire render tree. The library therefore owns only
 * *placement*: it creates and positions the host, and `<AppMapKit>` teleports
 * the slot's content into it. That is why `calloutEnabled` is `false` on every
 * annotation the pin layer builds.
 *
 * This is a **callout** seam: one host, scoped to the opened item. It is not the
 * general overlay-host seam, which stays a 2.2 candidate on its own evidence.
 *
 * ## Projection
 *
 * `projectCoordinate` is injected rather than read off the map, for two reasons:
 * the deterministic fake at `./testing` deliberately does not model
 * `convertCoordinateToPointOnPage` (reading it throws rather than answering
 * `undefined`), and injecting it is what lets a plain-TypeScript test assert
 * that a `region-change` actually re-projects every open callout.
 */
export type MapKitCalloutPlacement = 'above' | 'below';
export interface MapKitCalloutPoint {
    x: number;
    y: number;
}
export interface MapKitCalloutEntry<T> {
    host: HTMLElement;
    id: string;
    item: T;
    placement: MapKitCalloutPlacement;
    position: MapKitCalloutPoint;
}
export interface MapKitCalloutOpenRequest<T> {
    /** CSS px added to the projected point, normally the pin's own anchor. */
    anchorOffset?: MapKitCalloutPoint;
    coordinate: {
        lat: number;
        lng: number;
    };
    id: string;
    item: T;
}
export interface MapKitCalloutHostOptions<T> {
    container: HTMLElement;
    document?: Document;
    /** Fires after every open, close and reposition, with the live entry list. */
    onChange?: (entries: ReadonlyArray<MapKitCalloutEntry<T>>) => void;
    /** Preferred side. Flips when the callout would leave the container. */
    placement?: MapKitCalloutPlacement;
    /**
     * Container-relative point for a coordinate, or `null` when it cannot be
     * projected. The open callout's id comes along so a caller whose map cannot
     * project (see the class comment) can fall back to the pin's own position.
     */
    projectCoordinate: (coordinate: {
        lat: number;
        lng: number;
    }, id: string) => MapKitCalloutPoint | null;
}
export declare class MapKitCalloutHostLayer<T> {
    #private;
    constructor(options: MapKitCalloutHostOptions<T>);
    get openIds(): readonly string[];
    entries(): ReadonlyArray<MapKitCalloutEntry<T>>;
    /**
     * Open, or re-open with fresh data.
     *
     * Re-opening the same id keeps the same host element, so the teleported Vue
     * subtree is updated rather than torn down and rebuilt.
     */
    open(request: MapKitCalloutOpenRequest<T>): MapKitCalloutEntry<T> | null;
    close(id: string): boolean;
    closeAll(): void;
    /** Re-project every open callout. Called on every `region-change`. */
    reposition(): void;
    destroy(): void;
}
//# sourceMappingURL=callout-host.d.ts.map