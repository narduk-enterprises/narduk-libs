/**
 * Public types for the deterministic fake MapKit JS v6.
 *
 * These are declared structurally rather than as `Pick<>`s of
 * `@types/apple-mapkit`, so the published `./testing` types resolve for a
 * consumer that has not installed Apple's types. The link back to Apple's real
 * surface is a type-level conformance suite in this package's
 * `tests/testing/apple-types.test.ts`: it compares every member below against
 * `apple-mapkit/mapkit` member by member, so the fake cannot drift from the
 * real types without `pnpm typecheck` failing.
 */
/** Apple's `ConfigurationChangeStatus`, verbatim. */
export type FakeMapKitConfigurationChangeStatus = 'Initialized' | 'Refreshed';
/** Apple's `ConfigurationErrorStatus`, verbatim. */
export type FakeMapKitConfigurationErrorStatus = 'Bad Request' | 'Malformed Response' | 'Network Error' | 'Timeout' | 'Too Many Requests' | 'Unauthorized' | 'Unknown';
/**
 * How the fake answers the token the `authorizationCallback` hands it.
 *
 * - `accept` -- one bootstrap attempt, then `configuration-change: Initialized`.
 * - `wrong-origin` -- the measured Apple shape from the 2026-09-17 spike: the
 *   SAME token is re-sent `bootstrapAttempts` times, the callback is invoked
 *   exactly once, and the exchange then fails `Unauthorized` carrying Apple's
 *   `Origin does not match - expected: X, actual: Y` diagnostic.
 * - `error` -- the same retry shape with a caller-chosen status and message.
 */
export type FakeMapKitAuthMode = 'accept' | 'error' | 'wrong-origin';
/**
 * What the fake does when the access-key clock passes `accessKeyTtlSeconds`.
 *
 * UNVERIFIED against real MapKit JS. The 2026-09-17 spike proved the access key
 * lasts 1800 s independent of the JWT's own `exp`, but the run that would have
 * shown whether MapKit re-invokes `authorizationCallback` at that boundary was
 * killed at ~12 of the ~31 minutes it needed. See this package's README,
 * "Access-key expiry is UNVERIFIED".
 */
export type FakeMapKitAccessKeyExpiry = 'error' | 'nothing' | 'refresh';
export interface FakeMapKitAuthOptions {
    /**
     * Bootstrap attempts made with the SAME token before the exchange gives up.
     * Measured against Apple on 2026-09-17: 3. Only `wrong-origin` and `error`
     * retry; `accept` always takes one attempt.
     */
    bootstrapAttempts?: number;
    /**
     * Seconds the access key buys at bootstrap. Apple issued 1800 s on every one
     * of 11 measured runs, independent of the token's own `exp`.
     */
    accessKeyTtlSeconds?: number;
    /** Default `'accept'`. */
    mode?: FakeMapKitAuthMode;
    /**
     * What happens when the fake clock passes the access-key expiry. Default
     * `'refresh'`, which follows Apple's DOCUMENTED contract but is UNVERIFIED in
     * practice -- if your code's correctness depends on which of these happens,
     * write a test for BOTH `'refresh'` and `'nothing'`.
     */
    onAccessKeyExpiry?: FakeMapKitAccessKeyExpiry;
    /** Page origin the fake pretends the token was presented from. */
    origin?: string;
    /** Origin the token claims. Used by `wrong-origin`'s diagnostic. */
    expectedOrigin?: string;
    /** Error message. Defaults per mode. */
    message?: string;
    /** Error status for `mode: 'error'` and `onAccessKeyExpiry: 'error'`. */
    status?: FakeMapKitConfigurationErrorStatus;
}
export interface FakeMapKitOptions {
    auth?: FakeMapKitAuthOptions;
    /** MapKit's reported build string. Default `'6.0.128'`. */
    build?: string;
    /** Default `'en'`. */
    language?: string;
    /**
     * Libraries the namespace exposes. In real v6 `mapkit.core.js` is a stub: no
     * `map` library means no `mapkit.Map`, and the fake enforces that. Default
     * `['map', 'annotations', 'overlays']`.
     */
    libraries?: readonly string[];
    /**
     * Viewport used by the deterministic Web-Mercator projection, in CSS pixels.
     * Read from options rather than the DOM so a headless run positions pins
     * identically to a browser one. Default 800x600.
     */
    viewport?: {
        readonly width: number;
        readonly height: number;
    };
    /** MapKit's reported version string. Default `'6.0.128'`. */
    version?: string;
}
/** The subset of `@apple/mapkit-loader`'s `MapKitLoaderOptions` the fake honours. */
export interface FakeMapKitLoadOptions {
    data?: Record<string, string>;
    language?: string;
    libraries?: string[];
    nonce?: string;
    token?: string;
    version?: string;
}
export type FakeMapKitOperationName = 'Annotation' | 'ImageAnnotation' | 'Map' | 'Map.destroy' | 'MarkerAnnotation' | 'addAnnotation' | 'addAnnotations' | 'annotations=' | 'authorizationCallback' | 'bootstrap' | 'callout-remove' | 'callout-render' | 'camera-degenerate' | 'colorScheme=' | 'configuration-change' | 'deselect' | 'error' | 'init' | 'load' | 'mapType=' | 'region=' | 'removeAnnotation' | 'removeAnnotations' | 'select' | 'selectedAnnotation=' | 'setCenterAnimated' | 'setRegionAnimated' | 'setVisibleMapRectAnimated' | 'showItems' | 'visibleMapRect=';
export interface FakeMapKitOperation {
    /** Annotation ids this operation touched; empty when it touched none. */
    readonly annotationIds: readonly string[];
    /** Fake-clock milliseconds since the fake was created. */
    readonly at: number;
    /** Free-text detail; `''` when there is none. */
    readonly detail: string;
    readonly name: FakeMapKitOperationName;
}
export interface FakeMapKitAnnotationCounts {
    readonly added: number;
    readonly deselected: number;
    readonly removed: number;
    readonly selected: number;
}
export interface FakeMapKitBootstrapAttempt {
    /** 1-based attempt number within one exchange. */
    readonly attempt: number;
    /** Index into `FakeMapKitInspector.tokens`. Equal indices prove a same-token retry. */
    readonly tokenIndex: number;
}
export interface FakeMapKitErrorRecord {
    readonly message: string;
    readonly status: FakeMapKitConfigurationErrorStatus;
}
/**
 * Test-only inspection surface. Deliberately NOT part of the Apple-shaped
 * namespace: nothing here exists on real MapKit JS, and nothing here is
 * reachable from `handle.mapkit`.
 */
export interface FakeMapKitInspector {
    /** Annotation instances handed to `addAnnotation`/`addAnnotations`, cumulative. */
    readonly annotationsAdded: number;
    /** Annotation instances handed to `removeAnnotation`/`removeAnnotations`, cumulative. */
    readonly annotationsRemoved: number;
    /** Bootstrap attempts across every exchange, oldest first. */
    readonly bootstrapAttempts: readonly FakeMapKitBootstrapAttempt[];
    /** `configuration-change` statuses dispatched, oldest first. */
    readonly configurationChanges: readonly FakeMapKitConfigurationChangeStatus[];
    /** `error` events dispatched, oldest first. */
    readonly errors: readonly FakeMapKitErrorRecord[];
    /** Fake-clock milliseconds since the fake was created. */
    readonly now: number;
    /** Every observed operation, oldest first. */
    readonly operations: readonly FakeMapKitOperation[];
    /** Times `authorizationCallback` was invoked. */
    readonly tokenCalls: number;
    /** Tokens passed to `done()`, oldest first. Test values only -- never a credential. */
    readonly tokens: readonly string[];
    /** Live, undestroyed maps, from EVERY namespace (see `FakeMapKitNamespace.maps`). */
    readonly maps: readonly FakeMapKitMap[];
    /**
     * Camera inputs the fake applied but refuses to claim an answer for (K-5):
     * a `MapRect` with no positive extent, or padding with no room left in the
     * container. Apple documents neither clamping nor refusal for either, so the
     * fake records them here instead of inventing a behaviour.
     */
    readonly degenerateCameraInputs: readonly FakeMapKitDegenerateCameraInput[];
    /**
     * Move the fake clock forward. Crossing the access-key expiry runs whatever
     * `auth.onAccessKeyExpiry` configures. No real timer is ever involved.
     */
    advanceClock(milliseconds: number): void;
    /** Per-annotation counts, keyed on `annotation.id`. */
    annotationCounts(annotation: FakeMapKitAnnotation | string): FakeMapKitAnnotationCounts;
    /** The callout element currently rendered for `annotation`, or `null`. */
    calloutElement(annotation: FakeMapKitAnnotation): HTMLElement | null;
    /** Calls of one operation. Counts CALLS, not annotation instances. */
    count(name: FakeMapKitOperationName): number;
    /** Simulate a user dismissing the selection: fires `deselect` on the map. */
    deselectAnnotation(map: FakeMapKitMap): void;
    /**
     * Clear the operation log, every counter and the degenerate-camera record.
     * Leaves maps, clock and auth state alone.
     */
    reset(): void;
    /**
     * Simulate a user selecting `annotation`: deselects whatever was selected,
     * fires `deselect` then `select` on the map, and renders the callout.
     */
    selectAnnotation(map: FakeMapKitMap, annotation: FakeMapKitAnnotation): void;
}
export interface FakeCoordinate {
    latitude: number;
    longitude: number;
    copy(): FakeCoordinate;
    equals(other: {
        latitude: number;
        longitude: number;
    }): boolean;
    toString(): string;
}
export interface FakeCoordinateSpan {
    latitudeDelta: number;
    longitudeDelta: number;
    copy(): FakeCoordinateSpan;
    equals(other: FakeCoordinateSpan): boolean;
    toString(): string;
}
export interface FakeCoordinateRegion {
    center: FakeCoordinate;
    span: FakeCoordinateSpan;
    copy(): FakeCoordinateRegion;
    equals(other: FakeCoordinateRegion): boolean;
    toString(): string;
}
export interface FakePaddingData {
    bottom: number;
    left: number;
    right: number;
    top: number;
}
export interface FakePadding extends FakePaddingData {
    copy(): FakePadding;
    equals(other: FakePaddingData): boolean;
}
export interface FakeSize {
    height: number;
    width: number;
}
/**
 * A point in MapKit's own map-unit space: a unit square whose (0,0) is the
 * north-west corner of the Web-Mercator world and whose (1,1) is the south-east
 * one. `MapPointData` is Apple's plain-object alternative, accepted wherever a
 * `MapPoint` is.
 */
export interface FakeMapPointData {
    x: number;
    y: number;
}
export interface FakeMapPoint extends FakeMapPointData {
    copy(): FakeMapPoint;
    equals(other: FakeMapPoint): boolean;
    toCoordinate(): FakeCoordinate;
    toString(): string;
}
export interface FakeMapSizeData {
    height: number;
    width: number;
}
export interface FakeMapSize extends FakeMapSizeData {
    copy(): FakeMapSize;
    equals(other: FakeMapSize): boolean;
    toString(): string;
}
export interface FakeMapRectData {
    origin: FakeMapPointData;
    size: FakeMapSizeData;
}
/**
 * The rect camera (K-5).
 *
 * 2.1.0's fake modelled `region` only, so an app whose selection maths drives
 * `visibleMapRect` + `padding` -- which is what buoys does on a phone -- had no
 * test that could see the camera it produced. The fake derives the rect from
 * the same projection its pins use, so nothing here is a second geometry.
 */
export interface FakeMapRect {
    origin: FakeMapPoint;
    size: FakeMapSize;
    copy(): FakeMapRect;
    equals(other: FakeMapRect): boolean;
    maxX(): number;
    maxY(): number;
    midX(): number;
    midY(): number;
    minX(): number;
    minY(): number;
    /** Apple has it; nothing in this library calls it, so the fake throws. */
    scale(scaleFactor: number, scaleCenter?: FakeMapPointData): FakeMapRect;
    toCoordinateRegion(): FakeCoordinateRegion;
    toString(): string;
}
/** A camera input the fake applied but will not claim Apple's answer for. */
export interface FakeMapKitDegenerateCameraInput {
    /** What the fake was handed, in words. */
    readonly detail: string;
    readonly member: 'padding' | 'visibleMapRect';
}
/** `mapkit.MapType`, verbatim from `@types/apple-mapkit`. */
export interface FakeMapKitMapTypeEnum {
    readonly Hybrid: 'hybrid';
    readonly MutedStandard: 'mutedStandard';
    readonly Satellite: 'satellite';
    readonly Standard: 'standard';
}
/** `mapkit.ColorScheme`, verbatim. */
export interface FakeMapKitColorSchemeEnum {
    readonly Adaptive: 'adaptive';
    readonly Dark: 'dark';
    readonly Light: 'light';
}
/** `mapkit.FeatureVisibility`, verbatim. */
export interface FakeMapKitFeatureVisibilityEnum {
    readonly Adaptive: 'adaptive';
    readonly Hidden: 'hidden';
    readonly Visible: 'visible';
}
/** The slice of Apple's `AnnotationCalloutDelegate` the fake calls. */
export interface FakeMapKitCalloutDelegate {
    calloutAnchorOffsetForAnnotation?(annotation: FakeMapKitAnnotation, size: FakeSize): DOMPoint;
    calloutContentForAnnotation?(annotation: FakeMapKitAnnotation): HTMLElement;
    calloutElementForAnnotation?(annotation: FakeMapKitAnnotation): HTMLElement;
    calloutShouldAppearForAnnotation?(annotation: FakeMapKitAnnotation): boolean;
}
export interface FakeMapKitAnnotationOptions {
    accessibilityLabel?: string;
    anchorOffset?: DOMPoint;
    callout?: FakeMapKitCalloutDelegate | null;
    calloutEnabled?: boolean;
    calloutOffset?: DOMPoint;
    coordinate?: {
        latitude: number;
        longitude: number;
    };
    data?: object;
    element?: HTMLElement;
    enabled?: boolean;
    id?: string;
    selected?: boolean;
    size?: FakeSize;
    subtitle?: string;
    title?: string;
    visible?: boolean;
}
export interface FakeMapKitMarkerAnnotationOptions extends FakeMapKitAnnotationOptions {
    color?: string;
    glyphColor?: string;
    glyphText?: string;
}
export interface FakeMapKitImageAnnotationOptions extends FakeMapKitAnnotationOptions {
    url?: Record<string, string>;
}
export interface FakeMapKitAnnotation extends EventTarget {
    accessibilityLabel: string | null;
    anchorOffset: DOMPoint;
    callout: FakeMapKitCalloutDelegate | null;
    calloutEnabled: boolean;
    calloutOffset: DOMPoint;
    coordinate: FakeCoordinate;
    data: object;
    element: HTMLElement;
    enabled: boolean;
    /**
     * Apple types this `string | null`, so the fake does too. The fake always
     * assigns one at construction (`options.id`, else `fake-annotation-<n>`), so
     * in practice it is never null -- but code written against the fake still has
     * to handle the null real MapKit can return.
     */
    readonly id: string | null;
    readonly map: FakeMapKitMap | null;
    selected: boolean;
    size: FakeSize | null;
    subtitle: string | null;
    title: string | null;
    visible: boolean;
}
export interface FakeMapKitMarkerAnnotation extends FakeMapKitAnnotation {
    color: string;
    glyphColor: string;
    glyphText: string | null;
}
export interface FakeMapKitImageAnnotation extends FakeMapKitAnnotation {
    url: Record<string, string>;
}
export interface FakeMapKitShowItemsOptions {
    animate?: boolean;
    minimumSpan?: {
        latitudeDelta: number;
        longitudeDelta: number;
    };
    padding?: FakePaddingData;
}
export interface FakeMapKitMapOptions {
    center?: {
        latitude: number;
        longitude: number;
    };
    /** `mapkit.ColorScheme`'s values. Left unset, READING `map.colorScheme` throws. */
    colorScheme?: string;
    /** Apple's constructor default is `true`. */
    isRotationEnabled?: boolean;
    /** `mapkit.MapType`'s values. Left unset, READING `map.mapType` throws. */
    mapType?: string;
    padding?: FakePaddingData;
    region?: {
        center: {
            latitude: number;
            longitude: number;
        };
        span: {
            latitudeDelta: number;
            longitudeDelta: number;
        };
    };
    /** `mapkit.FeatureVisibility`'s values. */
    showsScale?: string;
    showsZoomControl?: boolean;
    visibleMapRect?: FakeMapRectData;
}
/**
 * The map.
 *
 * Every member here is one the fake models; reading any other throws
 * `FakeMapKitNotImplemented`. The basemap, control and camera members joined in
 * 2.1.1 (K-4, K-5). None of them has a default the fake invents: a map built
 * without `mapType` throws on a READ of `map.mapType` rather than answering a
 * guess, because Apple documents no default for it.
 */
export interface FakeMapKitMap extends EventTarget {
    annotations: FakeMapKitAnnotation[];
    colorScheme: string;
    readonly element: HTMLElement | null;
    isRotationEnabled: boolean;
    mapType: string;
    get padding(): FakePadding;
    set padding(value: FakePaddingData);
    region: FakeCoordinateRegion;
    selectedAnnotation: FakeMapKitAnnotation | null;
    showsScale: string;
    showsZoomControl: boolean;
    get visibleMapRect(): FakeMapRect;
    set visibleMapRect(value: FakeMapRectData);
    addAnnotation(annotation: FakeMapKitAnnotation): FakeMapKitAnnotation | null;
    addAnnotations(annotations: FakeMapKitAnnotation[]): FakeMapKitAnnotation[];
    destroy(): void;
    removeAnnotation(annotation: FakeMapKitAnnotation): FakeMapKitAnnotation;
    removeAnnotations(annotations: FakeMapKitAnnotation[]): FakeMapKitAnnotation[];
    setRegionAnimated(region: FakeCoordinateRegion, animated?: boolean): FakeMapKitMap;
    setVisibleMapRectAnimated(mapRect: FakeMapRectData, animated?: boolean): FakeMapKitMap;
    showItems(items: FakeMapKitAnnotation[], options?: FakeMapKitShowItemsOptions): FakeMapKitAnnotation[];
}
export interface FakeMapKitInitializationOptions {
    authorizationCallback?: (this: null, done: (token: string) => void) => void;
    language?: string | null;
    libraries?: string[];
}
/**
 * The `mapkit.Map` constructor, with the two deprecated enum aliases Apple still
 * ships on it. `mapkit.MapType` and `mapkit.ColorScheme` are the canonical
 * spellings; `Map.MapTypes`/`Map.ColorSchemes` are modelled so a consumer that
 * reads either works against the fake.
 */
export interface FakeMapKitMapConstructor {
    new (parent?: string | HTMLElement | null, options?: FakeMapKitMapOptions): FakeMapKitMap;
    /** @deprecated Apple deprecates it in favour of `mapkit.ColorScheme`. */
    readonly ColorSchemes: FakeMapKitColorSchemeEnum;
    /** @deprecated Apple deprecates it in favour of `mapkit.MapType`. */
    readonly MapTypes: FakeMapKitMapTypeEnum;
}
/**
 * The Apple-shaped namespace. Reading any member the fake does not model throws.
 *
 * There is more than one of these per runtime (K-10). MapKit JS 6 resolves
 * `mapkit.load(libraries)` to a SCOPED namespace that is not `window.mapkit`,
 * and every value a map accepts must come from the namespace that built it --
 * so the fake's `load()` resolves to a namespace object distinct from the one
 * `install()` publishes as `globalThis.mapkit`, and `maps` lists only the maps
 * of the namespace it is read from.
 */
export interface FakeMapKitNamespace extends EventTarget {
    readonly build: string;
    language: string;
    readonly loadedLibraries: string[] | undefined;
    /** Live maps THIS namespace built. A foreign namespace's maps are not here. */
    readonly maps: FakeMapKitMap[];
    readonly version: string;
    readonly Annotation: new (location: {
        latitude: number;
        longitude: number;
    }, factory: (location?: FakeCoordinate, options?: FakeMapKitAnnotationOptions) => HTMLElement, options?: FakeMapKitAnnotationOptions) => FakeMapKitAnnotation;
    readonly Coordinate: new (latitude?: number, longitude?: number) => FakeCoordinate;
    readonly CoordinateRegion: new (center?: {
        latitude: number;
        longitude: number;
    }, span?: {
        latitudeDelta: number;
        longitudeDelta: number;
    }) => FakeCoordinateRegion;
    readonly CoordinateSpan: new (latitudeDelta?: number, longitudeDelta?: number) => FakeCoordinateSpan;
    readonly ColorScheme: FakeMapKitColorSchemeEnum;
    readonly FeatureVisibility: FakeMapKitFeatureVisibilityEnum;
    readonly ImageAnnotation: new (location: {
        latitude: number;
        longitude: number;
    }, options: FakeMapKitImageAnnotationOptions) => FakeMapKitImageAnnotation;
    readonly Map: FakeMapKitMapConstructor;
    readonly MapPoint: new (x?: number, y?: number) => FakeMapPoint;
    readonly MapRect: new (x?: number, y?: number, width?: number, height?: number) => FakeMapRect;
    readonly MapSize: new (width?: number, height?: number) => FakeMapSize;
    readonly MapType: FakeMapKitMapTypeEnum;
    readonly MarkerAnnotation: new (location: {
        latitude: number;
        longitude: number;
    }, options?: FakeMapKitMarkerAnnotationOptions) => FakeMapKitMarkerAnnotation;
    readonly Padding: new (padding?: FakePaddingData) => FakePadding;
    init(options: FakeMapKitInitializationOptions): void;
    load(libraryNames: string | string[]): Promise<FakeMapKitNamespace>;
}
/** What the self-contained browser runtime returns. */
export interface FakeMapKitRuntime {
    readonly inspect: FakeMapKitInspector;
    /** The namespace `install()` publishes as `globalThis.mapkit`. NOT what `load()` resolves to. */
    readonly mapkit: FakeMapKitNamespace;
    /**
     * `load(options)`-compatible entry, shaped like `@apple/mapkit-loader`'s
     * `load`. It resolves to the SCOPED namespace (K-10), which is a different
     * object from `mapkit` above -- the same split real MapKit JS 6 has, and the
     * one 2.1.0's fake collapsed.
     */
    load(options?: FakeMapKitLoadOptions): Promise<FakeMapKitNamespace>;
}
export interface FakeMapKitHandle extends FakeMapKitRuntime {
    /**
     * Publish `mapkit` on `target` (default `globalThis`) and return an undo
     * function that restores whatever was there before.
     */
    install(target?: Record<string, unknown>): () => void;
}
/** The error the fake throws for every member it does not model. */
export type FakeMapKitNotImplementedError = Error & {
    readonly member: string;
    readonly name: 'FakeMapKitNotImplemented';
};
//# sourceMappingURL=types.d.ts.map