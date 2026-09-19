/**
 * Structural types for the parts of the MapKit JS runtime the map kit uses,
 * plus narrowing helpers for the namespace and map a host hands over.
 *
 * The namespace is NOT `globalThis.mapkit`. `@apple/mapkit-loader` returns
 * `mapkit.load(libraries)`, and MapKit JS 6 resolves that to a scoped namespace
 * of its own: the map `<AppMapKit>` builds belongs to that scoped one, while
 * `window.mapkit` stays a separate object whose `maps` list is empty. An
 * `Annotation`, `MapRect` or `MapType` value taken off the global therefore
 * fails the map's own instanceof checks -- live MapKit 6 answers
 * `Map.addAnnotations expected an annotation at index 0, but got
 * [object EventTarget]` and draws nothing. So the host passes the namespace
 * from the kit's own handle, the module singleton `<AppMapKit>` builds from
 * (KIT DEFECT K-10: `map-ready` hands over the map without it).
 */
export interface MkCoordinate {
    latitude: number;
    longitude: number;
}
export interface MkMapRect {
    origin: {
        x: number;
        y: number;
    };
    size: {
        height: number;
        width: number;
    };
}
interface MkRegion {
    center: MkCoordinate;
    span: {
        latitudeDelta: number;
        longitudeDelta: number;
    };
}
export interface MkAnnotation {
    coordinate: MkCoordinate;
    readonly element: HTMLElement;
    selected: boolean;
}
interface MkAnnotationOptions {
    anchorOffset?: DOMPoint;
    animates?: boolean;
    calloutEnabled?: boolean;
    displayPriority?: number;
    selected?: boolean;
}
export type MkListener = (event: unknown) => void;
export interface MkMap {
    addAnnotations(annotations: readonly MkAnnotation[]): void;
    addEventListener(type: string, listener: MkListener): void;
    readonly element: HTMLElement;
    isRotationEnabled: boolean;
    mapType: string;
    padding: MkPadding;
    readonly region: MkRegion;
    removeAnnotations(annotations: readonly MkAnnotation[]): void;
    removeEventListener(type: string, listener: MkListener): void;
    setVisibleMapRectAnimated(rect: MkMapRect, animate?: boolean): void;
    showsMapTypeControl: boolean;
    showsScale: string;
    showsZoomControl: boolean;
    readonly visibleMapRect: MkMapRect;
}
/** Pixels MapKit keeps clear inside each edge of the map element. */
interface MkPaddingInsets {
    bottom: number;
    left: number;
    right: number;
    top: number;
}
/** A `mapkit.Padding`: structurally the same four edges it was built from. */
type MkPadding = MkPaddingInsets;
export type MkMapType = 'Hybrid' | 'MutedStandard' | 'Satellite' | 'Standard';
export interface MkRuntime {
    Annotation: new (coordinate: MkCoordinate, factory: () => HTMLElement, options?: MkAnnotationOptions) => MkAnnotation;
    Coordinate: new (latitude: number, longitude: number) => MkCoordinate;
    FeatureVisibility: {
        Hidden: string;
    };
    MapRect: new (x: number, y: number, width: number, height: number) => MkMapRect;
    MapType: Record<MkMapType, string>;
    Padding: new (insets: MkPaddingInsets) => MkPadding;
}
/**
 * Narrows the scoped namespace a host reads from its kit handle -- in Nuxt,
 * `useMapKit().mapkit.value` -- to the parts the marks use. Read it lazily at
 * `map-ready`, never at setup, so the page's own loader decides the libraries.
 */
export declare function asMkRuntime(value: unknown): MkRuntime | null;
/** Narrows the untyped map instance AppMapKit emits from map-ready. */
export declare function asMkMap(value: unknown): MkMap | null;
export {};
//# sourceMappingURL=runtime.d.ts.map