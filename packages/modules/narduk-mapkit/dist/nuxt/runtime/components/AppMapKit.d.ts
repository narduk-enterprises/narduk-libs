import { defaultMapKitItemKey } from '../pin-layer.js';
import type { MapKitCalloutPoint } from '../callout-host.js';
import type { MapKitPinGeometry } from '../pin-geometry.js';
import type { MapKitPinElement, MapKitPinItem } from '../pin-layer.js';
import type { MapKitLatLng } from '../region.js';
import type { MapKitFailure, MapKitLibrary } from '../../../client/mapkit.js';
import type { GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONFeatureProperties, MapKitCircle, MapKitColorScheme, MapKitMapType, OverlayStyle } from '../../types.js';
import type { PropType, SlotsType, VNode } from 'vue';
type MapKitItem = MapKitPinItem & {
    id?: string;
};
/** `<AppMapKit>`'s `calloutFocus` prop. */
export type MapKitCalloutFocus = 'keyboard' | 'never';
export interface MapKitCalloutSlotScope<T> {
    close: () => void;
    id: string;
    item: T;
    placement: 'above' | 'below';
    position: MapKitCalloutPoint;
}
declare const AppMapKitImpl: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    readonly ariaLabel: {
        readonly default: "Map";
        readonly type: StringConstructor;
    };
    readonly boundingPadding: {
        readonly default: 0.05;
        readonly type: NumberConstructor;
    };
    /**
     * Where focus goes when a pin is selected from the keyboard. `'keyboard'`
     * moves it to the first focusable element in the `#callout` slot once the
     * callout renders, so a keyboard or screen-reader user can reach its action.
     * A pointer selection always leaves focus where it is. `'never'` opts out.
     */
    readonly calloutFocus: {
        readonly default: "keyboard";
        readonly type: PropType<MapKitCalloutFocus>;
        readonly validator: (value: unknown) => value is "keyboard" | "never";
    };
    /** Open the callout for the selected item. Off hands control to `openCallout`. */
    readonly calloutFollowSelection: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly circleScaleFactor: {
        readonly default: 0.004;
        readonly type: NumberConstructor;
    };
    readonly circles: {
        readonly default: () => MapKitCircle[];
        readonly type: PropType<MapKitCircle[]>;
    };
    readonly clusteringIdentifier: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    readonly colorScheme: {
        readonly default: "auto";
        readonly type: PropType<MapKitColorScheme>;
    };
    readonly createClusterElement: {
        readonly default: undefined;
        readonly type: PropType<(cluster: {
            coordinate: unknown;
            memberAnnotations: unknown[];
        }, count: number) => HTMLElement>;
    };
    /** Returns ONLY the glyph. The focusable, labelled host is the library's. */
    readonly createPinElement: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem, isSelected: boolean) => MapKitPinElement>;
    };
    readonly dynamicCircleRadius: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    readonly fallbackCenter: {
        readonly default: undefined;
        readonly type: PropType<MapKitLatLng>;
    };
    readonly geojson: {
        readonly default: null;
        readonly type: PropType<GeoJSONFeatureCollection | null>;
    };
    readonly isRotationEnabled: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    readonly isScrollEnabled: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly isZoomEnabled: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly items: {
        readonly default: () => MapKitItem[];
        readonly type: PropType<readonly MapKitItem[]>;
    };
    /**
     * The buoys#112 root-cause fix: a stable key per item is what makes an
     * `items` change a diff instead of a rebuild.
     */
    readonly itemKey: {
        readonly default: typeof defaultMapKitItemKey;
        readonly type: PropType<(item: MapKitItem, index: number) => string>;
    };
    /** REQUIRED when `items` is non-empty: the accessible name of the pin. */
    readonly itemLabel: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem) => string>;
    };
    readonly language: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    /** REQUIRED: MapKit JS 6 loads no map library by default. */
    readonly libraries: {
        readonly default: undefined;
        readonly type: PropType<readonly MapKitLibrary[]>;
    };
    readonly mapType: {
        readonly default: "standard";
        readonly type: PropType<MapKitMapType>;
    };
    readonly maxCircleRadius: {
        readonly default: 6000;
        readonly type: NumberConstructor;
    };
    readonly minCircleRadius: {
        readonly default: 200;
        readonly type: NumberConstructor;
    };
    readonly minSpanDelta: {
        readonly default: 0;
        readonly type: NumberConstructor;
    };
    readonly nonce: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    readonly overlayStyleFn: {
        readonly default: undefined;
        readonly type: PropType<(properties: GeoJSONFeatureProperties) => OverlayStyle>;
    };
    /** Per-pin size and anchor. Replaces 2.0.x's one global `annotationSize`. */
    readonly pinGeometry: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem) => MapKitPinGeometry>;
    };
    /**
     * Whether a pin is an interactive control (2.1.1, K-8).
     *
     * `true` -- the default and 2.1.0's only behaviour -- gives every pin host
     * `role="button"`, `tabindex="0"`, an `aria-label` and the click/Enter/Space
     * handlers. `false` is for a decorative map: the host carries no role, no
     * tabindex, no `aria-pressed` and no listeners, so an `aria-hidden` map no
     * longer contains focusable descendants (axe `aria-hidden-focus`) and
     * `itemLabel` stops being required.
     */
    readonly pinsFocusable: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    /** 7 of 7 consumers set this, so 2.1.0 flips the default. */
    readonly preserveRegion: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly selectedId: {
        readonly default: null;
        readonly type: PropType<string | null>;
    };
    /** Six observed consumer values, all `false`, riverstatus included. */
    readonly showsPointsOfInterest: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    /** 4 of 5 selection users set this, so 2.1.0 flips the default. */
    readonly suppressSelectionZoom: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly zoomSpan: {
        readonly default: () => {
            lat: number;
            lng: number;
        };
        readonly type: PropType<MapKitLatLng>;
    };
}>, () => VNode<import("vue").RendererNode, import("vue").RendererElement, {
    [key: string]: any;
}>, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {
    'callout-close': (payload: {
        id: string;
        item: MapKitItem;
    }) => boolean;
    'callout-open': (payload: {
        id: string;
        item: MapKitItem;
    }) => boolean;
    'feature-select': (feature: GeoJSONFeature) => boolean;
    'map-click': (coordinate: MapKitLatLng) => boolean;
    /**
     * The map, and the namespace that built it (2.1.1, K-10).
     *
     * The second argument is `useMapKit().mapkit`, NOT `globalThis.mapkit`:
     * MapKit JS 6 resolves `mapkit.load(libraries)` to a scoped namespace, and a
     * value built from the global one fails this map's own instanceof checks.
     */
    'map-ready': (map: unknown, mapkit: unknown) => boolean;
    'mapkit-error': (failure: MapKitFailure) => boolean;
    'region-change': (region: {
        centerLat: number;
        centerLng: number;
        latDelta: number;
        lngDelta: number;
    }) => boolean;
    'update:selectedId': (id: string | null) => boolean;
}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    readonly ariaLabel: {
        readonly default: "Map";
        readonly type: StringConstructor;
    };
    readonly boundingPadding: {
        readonly default: 0.05;
        readonly type: NumberConstructor;
    };
    /**
     * Where focus goes when a pin is selected from the keyboard. `'keyboard'`
     * moves it to the first focusable element in the `#callout` slot once the
     * callout renders, so a keyboard or screen-reader user can reach its action.
     * A pointer selection always leaves focus where it is. `'never'` opts out.
     */
    readonly calloutFocus: {
        readonly default: "keyboard";
        readonly type: PropType<MapKitCalloutFocus>;
        readonly validator: (value: unknown) => value is "keyboard" | "never";
    };
    /** Open the callout for the selected item. Off hands control to `openCallout`. */
    readonly calloutFollowSelection: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly circleScaleFactor: {
        readonly default: 0.004;
        readonly type: NumberConstructor;
    };
    readonly circles: {
        readonly default: () => MapKitCircle[];
        readonly type: PropType<MapKitCircle[]>;
    };
    readonly clusteringIdentifier: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    readonly colorScheme: {
        readonly default: "auto";
        readonly type: PropType<MapKitColorScheme>;
    };
    readonly createClusterElement: {
        readonly default: undefined;
        readonly type: PropType<(cluster: {
            coordinate: unknown;
            memberAnnotations: unknown[];
        }, count: number) => HTMLElement>;
    };
    /** Returns ONLY the glyph. The focusable, labelled host is the library's. */
    readonly createPinElement: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem, isSelected: boolean) => MapKitPinElement>;
    };
    readonly dynamicCircleRadius: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    readonly fallbackCenter: {
        readonly default: undefined;
        readonly type: PropType<MapKitLatLng>;
    };
    readonly geojson: {
        readonly default: null;
        readonly type: PropType<GeoJSONFeatureCollection | null>;
    };
    readonly isRotationEnabled: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    readonly isScrollEnabled: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly isZoomEnabled: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly items: {
        readonly default: () => MapKitItem[];
        readonly type: PropType<readonly MapKitItem[]>;
    };
    /**
     * The buoys#112 root-cause fix: a stable key per item is what makes an
     * `items` change a diff instead of a rebuild.
     */
    readonly itemKey: {
        readonly default: typeof defaultMapKitItemKey;
        readonly type: PropType<(item: MapKitItem, index: number) => string>;
    };
    /** REQUIRED when `items` is non-empty: the accessible name of the pin. */
    readonly itemLabel: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem) => string>;
    };
    readonly language: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    /** REQUIRED: MapKit JS 6 loads no map library by default. */
    readonly libraries: {
        readonly default: undefined;
        readonly type: PropType<readonly MapKitLibrary[]>;
    };
    readonly mapType: {
        readonly default: "standard";
        readonly type: PropType<MapKitMapType>;
    };
    readonly maxCircleRadius: {
        readonly default: 6000;
        readonly type: NumberConstructor;
    };
    readonly minCircleRadius: {
        readonly default: 200;
        readonly type: NumberConstructor;
    };
    readonly minSpanDelta: {
        readonly default: 0;
        readonly type: NumberConstructor;
    };
    readonly nonce: {
        readonly default: undefined;
        readonly type: StringConstructor;
    };
    readonly overlayStyleFn: {
        readonly default: undefined;
        readonly type: PropType<(properties: GeoJSONFeatureProperties) => OverlayStyle>;
    };
    /** Per-pin size and anchor. Replaces 2.0.x's one global `annotationSize`. */
    readonly pinGeometry: {
        readonly default: undefined;
        readonly type: PropType<(item: MapKitItem) => MapKitPinGeometry>;
    };
    /**
     * Whether a pin is an interactive control (2.1.1, K-8).
     *
     * `true` -- the default and 2.1.0's only behaviour -- gives every pin host
     * `role="button"`, `tabindex="0"`, an `aria-label` and the click/Enter/Space
     * handlers. `false` is for a decorative map: the host carries no role, no
     * tabindex, no `aria-pressed` and no listeners, so an `aria-hidden` map no
     * longer contains focusable descendants (axe `aria-hidden-focus`) and
     * `itemLabel` stops being required.
     */
    readonly pinsFocusable: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    /** 7 of 7 consumers set this, so 2.1.0 flips the default. */
    readonly preserveRegion: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly selectedId: {
        readonly default: null;
        readonly type: PropType<string | null>;
    };
    /** Six observed consumer values, all `false`, riverstatus included. */
    readonly showsPointsOfInterest: {
        readonly default: false;
        readonly type: BooleanConstructor;
    };
    /** 4 of 5 selection users set this, so 2.1.0 flips the default. */
    readonly suppressSelectionZoom: {
        readonly default: true;
        readonly type: BooleanConstructor;
    };
    readonly zoomSpan: {
        readonly default: () => {
            lat: number;
            lng: number;
        };
        readonly type: PropType<MapKitLatLng>;
    };
}>> & Readonly<{
    "onMap-click"?: (coordinate: MapKitLatLng) => any;
    "onCallout-close"?: (payload: {
        id: string;
        item: MapKitItem;
    }) => any;
    "onCallout-open"?: (payload: {
        id: string;
        item: MapKitItem;
    }) => any;
    "onFeature-select"?: (feature: GeoJSONFeature) => any;
    "onMap-ready"?: (map: unknown, mapkit: unknown) => any;
    "onMapkit-error"?: (failure: MapKitFailure) => any;
    "onRegion-change"?: (region: {
        centerLat: number;
        centerLng: number;
        latDelta: number;
        lngDelta: number;
    }) => any;
    "onUpdate:selectedId"?: (id: string | null) => any;
}>, {
    readonly language: string;
    readonly geojson: GeoJSONFeatureCollection | null;
    readonly minSpanDelta: number;
    readonly libraries: readonly string[];
    readonly nonce: string;
    readonly overlayStyleFn: (properties: GeoJSONFeatureProperties) => OverlayStyle;
    readonly ariaLabel: string;
    readonly boundingPadding: number;
    readonly calloutFocus: MapKitCalloutFocus;
    readonly calloutFollowSelection: boolean;
    readonly circleScaleFactor: number;
    readonly circles: MapKitCircle[];
    readonly clusteringIdentifier: string;
    readonly colorScheme: MapKitColorScheme;
    readonly createClusterElement: (cluster: {
        coordinate: unknown;
        memberAnnotations: unknown[];
    }, count: number) => HTMLElement;
    readonly createPinElement: (item: MapKitItem, isSelected: boolean) => MapKitPinElement;
    readonly dynamicCircleRadius: boolean;
    readonly fallbackCenter: MapKitLatLng;
    readonly isRotationEnabled: boolean;
    readonly isScrollEnabled: boolean;
    readonly isZoomEnabled: boolean;
    readonly items: readonly MapKitItem[];
    readonly itemKey: (item: MapKitItem, index: number) => string;
    readonly itemLabel: (item: MapKitItem) => string;
    readonly mapType: MapKitMapType;
    readonly maxCircleRadius: number;
    readonly minCircleRadius: number;
    readonly pinGeometry: (item: MapKitItem) => MapKitPinGeometry;
    readonly pinsFocusable: boolean;
    readonly preserveRegion: boolean;
    readonly selectedId: string | null;
    readonly showsPointsOfInterest: boolean;
    readonly suppressSelectionZoom: boolean;
    readonly zoomSpan: MapKitLatLng;
}, SlotsType<{
    callout?: (scope: MapKitCalloutSlotScope<MapKitItem>) => VNode[];
    default?: () => VNode[];
    error?: (scope: {
        failure: MapKitFailure;
        retry: () => void;
    }) => VNode[];
    fallback?: () => VNode[];
    loading?: () => VNode[];
}>, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
type AppMapKitBaseInstance = InstanceType<typeof AppMapKitImpl>;
/**
 * Every prop whose type is a function of the app's own item type.
 *
 * Named as one interface rather than spelled out twice because the `Omit` below
 * takes its keys from here: adding an item-typed prop to the component then
 * cannot leave the generic surface behind, which is exactly how 2.1.0 shipped
 * with only `items` re-typed (narduk-libs 2.1.1, K-1).
 */
export interface AppMapKitItemProps<T extends MapKitPinItem> {
    createPinElement?: ((item: T, isSelected: boolean) => MapKitPinElement) | undefined;
    itemKey?: ((item: T, index: number) => string) | undefined;
    itemLabel?: ((item: T) => string) | undefined;
    items?: readonly T[] | undefined;
    pinGeometry?: ((item: T) => MapKitPinGeometry) | undefined;
}
/** `<AppMapKit>`'s props for an app item type `T`. */
export type AppMapKitProps<T extends MapKitPinItem> = Omit<AppMapKitBaseInstance['$props'], keyof AppMapKitItemProps<MapKitPinItem>> & AppMapKitItemProps<T>;
/** `<AppMapKit>`'s slots for an app item type `T`; only `#callout` is item-typed. */
export type AppMapKitSlots<T extends MapKitPinItem> = Omit<AppMapKitBaseInstance['$slots'], 'callout'> & {
    callout?: (scope: MapKitCalloutSlotScope<T>) => VNode[];
};
/**
 * Exported with a generic construct signature so an app's own item type flows
 * through `items`, `itemKey`, `itemLabel`, `createPinElement`, `pinGeometry` and
 * the `#callout` slot scope. The runtime props above cannot carry a type
 * parameter, so the generic surface is applied here, once.
 *
 * 2.1.0 re-typed `items` alone, which under `strictFunctionTypes` left every
 * callback rejecting the app's item type -- parameters are contravariant, so
 * `(item: Station) => string` is not assignable to `(item: MapKitPinItem) =>
 * string`. `tests/nuxt/app-map-kit-generic.test.ts` is the compile-time gate; a
 * runtime test cannot see this at all.
 *
 * The generic construct signature is the ONLY one (narduk-libs#573): keeping
 * `typeof AppMapKitImpl`'s own non-generic signature beside it made vue-tsc
 * intersect both props types in an SFC template, so a callback narrowed to the
 * app's item type failed TS2322 there even though `AppMapKit<Station>` checked.
 * The `props` parameter is what a template instantiates `T` from; the `Omit`
 * keeps the component's static members and drops its construct signature.
 * `tests/nuxt/template/` is the vue-tsc gate for the template path.
 */
declare const _default: Omit<typeof AppMapKitImpl, never> & {
    new <T extends MapKitPinItem>(props: AppMapKitProps<T>): Omit<AppMapKitBaseInstance, "$props" | "$slots"> & {
        $props: AppMapKitProps<T>;
        $slots: AppMapKitSlots<T>;
    };
};
export default _default;
//# sourceMappingURL=AppMapKit.d.ts.map