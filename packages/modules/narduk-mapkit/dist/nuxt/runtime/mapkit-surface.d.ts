/**
 * The slice of the MapKit JS namespace the `./nuxt` runtime actually touches,
 * declared structurally.
 *
 * Why structural rather than `MapKit` from `@apple/mapkit-loader`: the
 * controllers in this directory have to be drivable from a plain TypeScript
 * test against `./testing`'s fake, with no Vue and no browser. The fake declares
 * its own public types structurally for the same reason (see
 * `src/testing/types.ts`), so a nominal dependency on Apple's classes would make
 * the seam untestable. `tests/nuxt/mapkit-surface.test.ts` carries the
 * compile-time conformance check that pins these declarations to Apple's real
 * types, so they cannot drift without `pnpm typecheck` failing.
 *
 * Every member named here is one the fake models. Reading a member the fake does
 * not model throws `FakeMapKitNotImplemented`, so this file is also the list of
 * what the runtime is allowed to reach for on a map.
 */
export interface MapKitCoordinateLike {
    latitude: number;
    longitude: number;
}
export interface MapKitSpanLike {
    latitudeDelta: number;
    longitudeDelta: number;
}
export interface MapKitRegionLike {
    center: MapKitCoordinateLike;
    span: MapKitSpanLike;
}
export interface MapKitSizeLike {
    height: number;
    width: number;
}
/** The annotation members the pin layer reads or writes. */
export interface MapKitAnnotationLike {
    accessibilityLabel: string | null;
    anchorOffset: DOMPoint;
    calloutEnabled: boolean;
    coordinate: MapKitCoordinateLike;
    readonly element: HTMLElement;
    readonly id: string | null;
    size: MapKitSizeLike | null;
}
export interface MapKitAnnotationOptionsLike {
    accessibilityLabel?: string;
    anchorOffset?: DOMPoint;
    calloutEnabled?: boolean;
    clusteringIdentifier?: string;
    data?: object;
    size?: MapKitSizeLike;
}
/**
 * The map members the runtime touches. Deliberately short:
 * `convertCoordinateToPointOnPage` and the overlay methods are NOT here,
 * because the fake does not model them -- the projection call is guarded by a
 * `try`/`catch` with a fallback, and the overlay members live on
 * `overlay-layer.ts`'s own narrower types, which are only touched when
 * `geojson` or `circles` is non-empty.
 *
 * `colorScheme` and `mapType` joined the list in 2.1.1 (K-4): they were
 * constructor options the component never wrote again, so changing either prop
 * on a mounted map did nothing. They are `string` rather than Apple's own
 * unions for the same reason every other member here is structural -- see the
 * conformance check in `tests/nuxt/mapkit-surface.test.ts`.
 */
export interface MapKitMapLike {
    colorScheme: string;
    readonly element: HTMLElement | null;
    mapType: string;
    region: MapKitRegionLike;
    selectedAnnotation: MapKitAnnotationLike | null;
    addAnnotations(annotations: readonly MapKitAnnotationLike[]): unknown;
    addEventListener(type: string, listener: (event: never) => void): void;
    destroy(): void;
    removeAnnotations(annotations: readonly MapKitAnnotationLike[]): unknown;
    removeEventListener(type: string, listener: (event: never) => void): void;
    setRegionAnimated(region: MapKitRegionLike, animated?: boolean): unknown;
}
/** The namespace constructors the runtime calls. */
export interface MapKitNamespaceLike {
    readonly Annotation: new (location: MapKitCoordinateLike, factory: (...args: never[]) => HTMLElement, options?: MapKitAnnotationOptionsLike) => MapKitAnnotationLike;
    readonly Coordinate: new (latitude?: number, longitude?: number) => MapKitCoordinateLike;
    readonly CoordinateRegion: new (center?: MapKitCoordinateLike, span?: MapKitSpanLike) => MapKitRegionLike;
    readonly CoordinateSpan: new (latitudeDelta?: number, longitudeDelta?: number) => MapKitSpanLike;
    readonly Map: new (parent?: HTMLElement | null, options?: object) => MapKitMapLike;
}
//# sourceMappingURL=mapkit-surface.d.ts.map