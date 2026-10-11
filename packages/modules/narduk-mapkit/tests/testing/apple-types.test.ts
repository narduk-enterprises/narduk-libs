/**
 * Type-level conformance: the fake against Apple's real MapKit JS v6 types.
 *
 * `@types/apple-mapkit` is the official surface -- Apple employees author it and
 * `@apple/mapkit-loader` takes it as a runtime dependency -- and both are
 * dev-only here, so the published `./testing` types stay self-contained.
 *
 * Every assertion below has the form `Extends<Real, Fake>`: the real member must
 * satisfy the fake's declared type. That direction is the useful one. It fails
 * when the fake claims a member Apple does not have, claims a type narrower than
 * Apple's (`title: string` against Apple's `string | null`), or keeps a
 * signature Apple has since changed -- which is exactly the silent drift a
 * hand-written double accumulates. It deliberately does NOT require the fake to
 * cover everything Apple ships; the fake models a slice on purpose, and the
 * fidelity rule (`FakeMapKitNotImplemented`) covers the rest at runtime.
 *
 * This file is compiled by `pnpm typecheck` (tsconfig `include` covers
 * `tests/**`). A drift failure names the exact member on the failing line.
 */
import { describe, expect, it } from 'vitest'
import type * as Apple from 'apple-mapkit'
import type { MapKitLoaderOptions, load as appleLoad } from '@apple/mapkit-loader'

import type {
  FakeCoordinate,
  FakeCoordinateRegion,
  FakeCoordinateSpan,
  FakeMapKitAnnotation,
  FakeMapKitCalloutDelegate,
  FakeMapKitCircleOverlay,
  FakeMapKitConfigurationChangeStatus,
  FakeMapKitConfigurationErrorStatus,
  FakeMapKitImageAnnotation,
  FakeMapKitInitializationOptions,
  FakeMapKitLoadOptions,
  FakeMapKitMap,
  FakeMapKitColorSchemeEnum,
  FakeMapKitFeatureVisibilityEnum,
  FakeMapKitMapConstructor,
  FakeMapKitMapOptions,
  FakeMapKitMapTypeEnum,
  FakeMapKitMarkerAnnotation,
  FakeMapKitNamespace,
  FakeMapKitOverlay,
  FakeMapKitOverlayOptions,
  FakeMapKitPolygonOverlay,
  FakeMapKitPolylineOverlay,
  FakeMapKitShowItemsOptions,
  FakeMapKitStyle,
  FakeMapKitStyleOptions,
  FakeMapPoint,
  FakeMapPointData,
  FakeMapRect,
  FakeMapRectData,
  FakeMapSize,
  FakeMapSizeData,
  FakePadding,
  FakePaddingData,
  FakeSize,
} from '../../src/testing/index.js'

type Extends<Real, Fake> = [Real] extends [Fake] ? true : false
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

/**
 * Apple's `Annotation` and `Map` references swapped for the fake's equivalents.
 *
 * The fake models a slice of each class, so neither is nominally assignable to
 * the other and a raw comparison would fail for a reason that says nothing about
 * drift. Substituting them leaves exactly what a drift check should be about:
 * arity, nullability, array-ness and every other member's real type.
 */
type Fakeify<T> = T extends Apple.Annotation
  ? FakeMapKitAnnotation
  : T extends Apple.Map
    ? FakeMapKitMap
    : T extends Apple.Overlay
      ? FakeMapKitOverlay
      : T extends null
        ? null
        : T extends ReadonlyArray<infer Element>
          ? Array<Fakeify<Element>>
          : T

// ------------------------------------------------------------ status enums --
// Apple keeps these as non-exported const objects, so they are read off the
// event classes that carry them -- which is also where the library reads them.

type _changeStatus = Expect<
  Equal<FakeMapKitConfigurationChangeStatus, Apple.MapKitConfigurationChangeEvent['status']>
>
type _errorStatus = Expect<
  Equal<FakeMapKitConfigurationErrorStatus, Apple.MapKitConfigurationErrorEvent['status']>
>
type _errorMessage = Expect<Extends<Apple.MapKitConfigurationErrorEvent['message'], string>>

// ------------------------------------------------------------ init options --

type _initOptions = Expect<
  Equal<FakeMapKitInitializationOptions, Apple.MapKitInitializationOptions>
>
type _authorizationCallback = Expect<
  Equal<
    FakeMapKitInitializationOptions['authorizationCallback'],
    Apple.MapKitInitializationOptions['authorizationCallback']
  >
>

// ------------------------------------------------------- loader-shaped load --

type _loadOptions = Expect<Extends<FakeMapKitLoadOptions, MapKitLoaderOptions>>
type _loadAcceptsRealOptions = Expect<
  Extends<Parameters<typeof appleLoad>[0], FakeMapKitLoadOptions>
>

// -------------------------------------------------------------- value types --

type _coordinate = Expect<Extends<Apple.Coordinate, FakeCoordinate>>
type _coordinateSpan = Expect<Extends<Apple.CoordinateSpan, FakeCoordinateSpan>>
type _coordinateRegion = Expect<Extends<Apple.CoordinateRegion, FakeCoordinateRegion>>
type _paddingData = Expect<Equal<FakePaddingData, Apple.PaddingData>>
type _padding = Expect<Extends<Apple.Padding, FakePadding>>
type _size = Expect<Equal<FakeSize, Apple.Size>>

// ------------------------------------------------------- the MapRect world --
// 2.1.1 models Apple's map-unit geometry (K-5). `*Data` are Apple's plain-object
// alternatives, accepted anywhere the class is.

type _mapPoint = Expect<Extends<Apple.MapPoint, FakeMapPoint>>
type _mapPointData = Expect<Equal<FakeMapPointData, Apple.MapPointData>>
type _mapSize = Expect<Extends<Apple.MapSize, FakeMapSize>>
type _mapSizeData = Expect<Equal<FakeMapSizeData, Apple.MapSizeData>>
type _mapRect = Expect<Extends<Apple.MapRect, FakeMapRect>>
type _mapRectData = Expect<Equal<FakeMapRectData, Apple.MapRectData>>

// ------------------------------------------------------------------- enums --
// Apple keeps `MapType` and `ColorScheme` as non-exported const objects, so they
// are read off the namespace getters that publish them.

type _mapTypeEnum = Expect<Extends<Apple.MapKit['MapType'], FakeMapKitMapTypeEnum>>
type _colorSchemeEnum = Expect<Extends<Apple.MapKit['ColorScheme'], FakeMapKitColorSchemeEnum>>
type _featureVisibilityEnum = Expect<
  Extends<Apple.MapKit['FeatureVisibility'], FakeMapKitFeatureVisibilityEnum>
>
// The deprecated aliases Apple still ships on the Map constructor.
type _deprecatedMapTypes = Expect<
  Extends<Apple.MapKit['Map']['MapTypes'], FakeMapKitMapConstructor['MapTypes']>
>
type _deprecatedColorSchemes = Expect<
  Extends<Apple.MapKit['Map']['ColorSchemes'], FakeMapKitMapConstructor['ColorSchemes']>
>

// --------------------------------------------------------------- annotation --
// `map` is excluded: Apple's `Map` carries `showItems`, whose real return type
// is `(Annotation | Overlay)[]`, and the fake models no overlays (see below).

type _annotationCoordinate = Expect<
  Extends<Apple.Annotation['coordinate'], FakeMapKitAnnotation['coordinate']>
>
type _annotationElement = Expect<
  Extends<Apple.Annotation['element'], FakeMapKitAnnotation['element']>
>
type _annotationId = Expect<Extends<Apple.Annotation['id'], FakeMapKitAnnotation['id']>>
type _annotationTitle = Expect<Extends<Apple.Annotation['title'], FakeMapKitAnnotation['title']>>
type _annotationSubtitle = Expect<
  Extends<Apple.Annotation['subtitle'], FakeMapKitAnnotation['subtitle']>
>
type _annotationData = Expect<Extends<Apple.Annotation['data'], FakeMapKitAnnotation['data']>>
type _annotationEnabled = Expect<
  Extends<Apple.Annotation['enabled'], FakeMapKitAnnotation['enabled']>
>
type _annotationVisible = Expect<
  Extends<Apple.Annotation['visible'], FakeMapKitAnnotation['visible']>
>
type _annotationSelected = Expect<
  Extends<Apple.Annotation['selected'], FakeMapKitAnnotation['selected']>
>
type _annotationSize = Expect<Extends<Apple.Annotation['size'], FakeMapKitAnnotation['size']>>
type _annotationAnchorOffset = Expect<
  Extends<Apple.Annotation['anchorOffset'], FakeMapKitAnnotation['anchorOffset']>
>
type _annotationCalloutOffset = Expect<
  Extends<Apple.Annotation['calloutOffset'], FakeMapKitAnnotation['calloutOffset']>
>
type _annotationCalloutEnabled = Expect<
  Extends<Apple.Annotation['calloutEnabled'], FakeMapKitAnnotation['calloutEnabled']>
>
type _annotationCalloutNullable = Expect<
  Equal<
    null extends Apple.Annotation['callout'] ? true : false,
    null extends FakeMapKitAnnotation['callout'] ? true : false
  >
>
type _annotationAccessibilityLabel = Expect<
  Extends<Apple.Annotation['accessibilityLabel'], FakeMapKitAnnotation['accessibilityLabel']>
>
type _annotationIsEventTarget = Expect<Extends<Apple.Annotation, EventTarget>>

// The delegate is compared on its member names and return types. Its parameter
// types are `Annotation`, which is the nominal gap `Fakeify` exists for, and
// method parameters are bivariant anyway -- so they carry no drift signal here.
type CalloutMethod<K extends keyof FakeMapKitCalloutDelegate> = ReturnType<
  NonNullable<Apple.AnnotationCalloutDelegate[K]>
>
type _calloutKeys = Expect<
  Extends<keyof FakeMapKitCalloutDelegate, keyof Apple.AnnotationCalloutDelegate>
>
type _calloutAnchorOffset = Expect<
  Equal<
    CalloutMethod<'calloutAnchorOffsetForAnnotation'>,
    ReturnType<NonNullable<FakeMapKitCalloutDelegate['calloutAnchorOffsetForAnnotation']>>
  >
>
type _calloutContent = Expect<
  Equal<
    CalloutMethod<'calloutContentForAnnotation'>,
    ReturnType<NonNullable<FakeMapKitCalloutDelegate['calloutContentForAnnotation']>>
  >
>
type _calloutElement = Expect<
  Equal<
    CalloutMethod<'calloutElementForAnnotation'>,
    ReturnType<NonNullable<FakeMapKitCalloutDelegate['calloutElementForAnnotation']>>
  >
>
type _calloutShouldAppear = Expect<
  Equal<
    CalloutMethod<'calloutShouldAppearForAnnotation'>,
    ReturnType<NonNullable<FakeMapKitCalloutDelegate['calloutShouldAppearForAnnotation']>>
  >
>

type _markerColor = Expect<
  Extends<Apple.MarkerAnnotation['color'], FakeMapKitMarkerAnnotation['color']>
>
type _markerGlyphColor = Expect<
  Extends<Apple.MarkerAnnotation['glyphColor'], FakeMapKitMarkerAnnotation['glyphColor']>
>
type _markerGlyphText = Expect<
  Extends<Apple.MarkerAnnotation['glyphText'], FakeMapKitMarkerAnnotation['glyphText']>
>
// Apple's `ImageAnnotation.url` is a union that also covers an ImageDelegate and
// a Promise; the fake models the plain `{ 1: url, 2: url2x }` hash only, so the
// assertion is that the fake's shape is ONE of Apple's accepted forms.
type _imageUrl = Expect<Extends<FakeMapKitImageAnnotation['url'], Apple.ImageAnnotation['url']>>

// ---------------------------------------------------------------------- map --

type _mapElement = Expect<Extends<Apple.Map['element'], FakeMapKitMap['element']>>
type _mapRegion = Expect<Extends<Apple.Map['region'], FakeMapKitMap['region']>>
type _mapAnnotations = Expect<
  Equal<Fakeify<Apple.Map['annotations']>, FakeMapKitMap['annotations']>
>
type _mapSelectedAnnotation = Expect<
  Equal<Fakeify<Apple.Map['selectedAnnotation']>, FakeMapKitMap['selectedAnnotation']>
>
type _mapAddAnnotation = Expect<
  Equal<Fakeify<ReturnType<Apple.Map['addAnnotation']>>, ReturnType<FakeMapKitMap['addAnnotation']>>
>
type _mapAddAnnotations = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['addAnnotations']>>,
    ReturnType<FakeMapKitMap['addAnnotations']>
  >
>
type _mapRemoveAnnotation = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['removeAnnotation']>>,
    ReturnType<FakeMapKitMap['removeAnnotation']>
  >
>
type _mapRemoveAnnotations = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['removeAnnotations']>>,
    ReturnType<FakeMapKitMap['removeAnnotations']>
  >
>
type _mapSetRegionAnimated = Expect<
  Extends<
    Parameters<FakeMapKitMap['setRegionAnimated']>,
    Parameters<Apple.Map['setRegionAnimated']>
  >
>
type _mapSetRegionAnimatedReturn = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['setRegionAnimated']>>,
    ReturnType<FakeMapKitMap['setRegionAnimated']>
  >
>
// The basemap, control and camera members 2.1.1 added (K-4, K-5).
type _mapMapType = Expect<Extends<Apple.Map['mapType'], FakeMapKitMap['mapType']>>
type _mapColorScheme = Expect<Extends<Apple.Map['colorScheme'], FakeMapKitMap['colorScheme']>>
type _mapShowsScale = Expect<Extends<Apple.Map['showsScale'], FakeMapKitMap['showsScale']>>
type _mapShowsZoomControl = Expect<
  Extends<Apple.Map['showsZoomControl'], FakeMapKitMap['showsZoomControl']>
>
type _mapPadding = Expect<Extends<Apple.Map['padding'], FakeMapKitMap['padding']>>
type _mapVisibleMapRect = Expect<
  Extends<Apple.Map['visibleMapRect'], FakeMapKitMap['visibleMapRect']>
>
type _mapSetVisibleMapRect = Expect<
  Extends<
    Parameters<FakeMapKitMap['setVisibleMapRectAnimated']>,
    Parameters<Apple.Map['setVisibleMapRectAnimated']>
  >
>
type _mapSetVisibleMapRectReturn = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['setVisibleMapRectAnimated']>>,
    ReturnType<FakeMapKitMap['setVisibleMapRectAnimated']>
  >
>
type _mapOptionKeys = Expect<Extends<keyof FakeMapKitMapOptions, keyof Apple.MapConstructorOptions>>
type _mapDestroy = Expect<
  Equal<ReturnType<Apple.Map['destroy']>, ReturnType<FakeMapKitMap['destroy']>>
>
type _mapIsEventTarget = Expect<Extends<Apple.Map, EventTarget>>
// `showItems` is compared on its arguments only: Apple's return type includes
// `Overlay`, and the fake's `showItems` only ever answers annotations.
type _mapShowItemsOptions = Expect<Extends<FakeMapKitShowItemsOptions, Apple.MapShowItemsOptions>>
type _mapShowItemsItems = Expect<
  Equal<
    Fakeify<Extract<Parameters<Apple.Map['showItems']>[0][number], Apple.Annotation>>,
    Parameters<FakeMapKitMap['showItems']>[0][number]
  >
>

// ---------------------------------------------------------------- overlays --
// narduk-libs#1729. The fake holds overlays as state and draws nothing.

type _mapOverlays = Expect<Equal<Fakeify<Apple.Map['overlays']>, FakeMapKitMap['overlays']>>
type _mapAddOverlay = Expect<
  Equal<Fakeify<ReturnType<Apple.Map['addOverlay']>>, ReturnType<FakeMapKitMap['addOverlay']>>
>
type _mapAddOverlays = Expect<
  Equal<Fakeify<ReturnType<Apple.Map['addOverlays']>>, ReturnType<FakeMapKitMap['addOverlays']>>
>
type _mapRemoveOverlay = Expect<
  Equal<Fakeify<ReturnType<Apple.Map['removeOverlay']>>, ReturnType<FakeMapKitMap['removeOverlay']>>
>
type _mapRemoveOverlays = Expect<
  Equal<
    Fakeify<ReturnType<Apple.Map['removeOverlays']>>,
    ReturnType<FakeMapKitMap['removeOverlays']>
  >
>
type _mapConvertPoint = Expect<
  Extends<
    Parameters<FakeMapKitMap['convertPointOnPageToCoordinate']>,
    Parameters<Apple.Map['convertPointOnPageToCoordinate']>
  >
>
type _mapConvertPointReturn = Expect<
  Extends<
    ReturnType<Apple.Map['convertPointOnPageToCoordinate']>,
    ReturnType<FakeMapKitMap['convertPointOnPageToCoordinate']>
  >
>
type _overlayEnabled = Expect<Extends<Apple.Overlay['enabled'], FakeMapKitOverlay['enabled']>>
type _overlayVisible = Expect<Extends<Apple.Overlay['visible'], FakeMapKitOverlay['visible']>>
type _overlaySelected = Expect<Extends<Apple.Overlay['selected'], FakeMapKitOverlay['selected']>>
type _overlayData = Expect<Extends<Apple.Overlay['data'], FakeMapKitOverlay['data']>>
type _overlayStyle = Expect<Extends<Apple.Overlay['style'], FakeMapKitOverlay['style']>>
type _overlayMap = Expect<Equal<Fakeify<Apple.Overlay['map']>, FakeMapKitOverlay['map']>>
type _overlayIsEventTarget = Expect<Extends<Apple.Overlay, EventTarget>>
type _polygonPoints = Expect<
  Extends<Apple.PolygonOverlay['points'], FakeMapKitPolygonOverlay['points']>
>
type _polylinePoints = Expect<
  Extends<Apple.PolylineOverlay['points'], FakeMapKitPolylineOverlay['points']>
>
type _circleCoordinate = Expect<
  Extends<Apple.CircleOverlay['coordinate'], FakeMapKitCircleOverlay['coordinate']>
>
type _circleRadius = Expect<
  Extends<Apple.CircleOverlay['radius'], FakeMapKitCircleOverlay['radius']>
>
type _overlayOptionKeys = Expect<
  Extends<keyof FakeMapKitOverlayOptions, keyof Apple.OverlayOptions>
>
type _styleOptionKeys = Expect<
  Extends<keyof FakeMapKitStyleOptions, keyof Apple.StyleConstructorOptions>
>
type _styleIsFakeStyle = Expect<Extends<Apple.Style, FakeMapKitStyle>>
type _polygonOverlayCtor = Expect<
  Extends<
    ConstructorParameters<typeof Apple.PolygonOverlay>,
    ConstructorParameters<FakeMapKitNamespace['PolygonOverlay']>
  >
>
type _polylineOverlayCtor = Expect<
  Extends<
    ConstructorParameters<typeof Apple.PolylineOverlay>,
    ConstructorParameters<FakeMapKitNamespace['PolylineOverlay']>
  >
>
type _circleOverlayCtor = Expect<
  Extends<
    ConstructorParameters<typeof Apple.CircleOverlay>,
    ConstructorParameters<FakeMapKitNamespace['CircleOverlay']>
  >
>
type _styleCtor = Expect<
  Extends<
    ConstructorParameters<typeof Apple.Style>,
    ConstructorParameters<FakeMapKitNamespace['Style']>
  >
>
type _overlayKeys = Expect<
  Extends<Exclude<keyof FakeMapKitOverlay, keyof EventTarget>, keyof Apple.Overlay>
>
type _polygonKeys = Expect<
  Extends<Exclude<keyof FakeMapKitPolygonOverlay, keyof EventTarget>, keyof Apple.PolygonOverlay>
>
type _polylineKeys = Expect<
  Extends<Exclude<keyof FakeMapKitPolylineOverlay, keyof EventTarget>, keyof Apple.PolylineOverlay>
>
type _circleKeys = Expect<
  Extends<Exclude<keyof FakeMapKitCircleOverlay, keyof EventTarget>, keyof Apple.CircleOverlay>
>

// ------------------------------------------------- no invented member names --
// Catches the other drift direction: a member the fake declares that Apple does
// not have, either because it was invented or because Apple removed it.

type _annotationKeys = Expect<
  Extends<Exclude<keyof FakeMapKitAnnotation, keyof EventTarget>, keyof Apple.Annotation>
>
type _markerKeys = Expect<
  Extends<
    Exclude<keyof FakeMapKitMarkerAnnotation, keyof EventTarget>,
    keyof Apple.MarkerAnnotation
  >
>
type _imageKeys = Expect<
  Extends<Exclude<keyof FakeMapKitImageAnnotation, keyof EventTarget>, keyof Apple.ImageAnnotation>
>
type _mapKeys = Expect<Extends<Exclude<keyof FakeMapKitMap, keyof EventTarget>, keyof Apple.Map>>
type _namespaceKeys = Expect<
  Extends<Exclude<keyof FakeMapKitNamespace, keyof EventTarget>, keyof Apple.MapKit>
>
type _showItemsOptionKeys = Expect<
  Extends<keyof FakeMapKitShowItemsOptions, keyof Apple.MapShowItemsOptions>
>

// --------------------------------------------------------------- namespace --

type _namespaceVersion = Expect<Extends<Apple.MapKit['version'], FakeMapKitNamespace['version']>>
type _namespaceBuild = Expect<Extends<Apple.MapKit['build'], FakeMapKitNamespace['build']>>
type _namespaceLanguage = Expect<Extends<Apple.MapKit['language'], FakeMapKitNamespace['language']>>
type _namespaceLoadedLibraries = Expect<
  Extends<Apple.MapKit['loadedLibraries'], FakeMapKitNamespace['loadedLibraries']>
>
type _namespaceInit = Expect<
  Equal<Parameters<Apple.MapKit['init']>, Parameters<FakeMapKitNamespace['init']>>
>
type _namespaceLoad = Expect<
  Extends<Parameters<FakeMapKitNamespace['load']>, Parameters<NonNullable<Apple.MapKit['load']>>>
>
type _namespaceIsEventTarget = Expect<Extends<Apple.MapKit, EventTarget>>
type _namespaceMapCtor = Expect<Extends<Apple.MapKit['Map'], new (...args: never[]) => unknown>>
type _namespaceCoordinateCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['Coordinate']>,
    ConstructorParameters<Apple.MapKit['Coordinate']>
  >
>
type _namespaceSpanCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['CoordinateSpan']>,
    ConstructorParameters<Apple.MapKit['CoordinateSpan']>
  >
>
type _namespaceRegionCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['CoordinateRegion']>,
    ConstructorParameters<Apple.MapKit['CoordinateRegion']>
  >
>
type _namespacePointCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['MapPoint']>,
    ConstructorParameters<Apple.MapKit['MapPoint']>
  >
>
type _namespaceSizeCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['MapSize']>,
    ConstructorParameters<Apple.MapKit['MapSize']>
  >
>
type _namespaceRectCtor = Expect<
  Extends<
    ConstructorParameters<FakeMapKitNamespace['MapRect']>,
    ConstructorParameters<Apple.MapKit['MapRect']>
  >
>
// `Padding` is deliberately NOT compared on its constructor parameters: Apple
// overloads it (`()`, `(PaddingData)`, `(top, right, bottom, left)`) and
// `ConstructorParameters` resolves to the last overload, while the fake models
// the data-object form alone and throws for the numeric ones.

describe('apple type conformance', () => {
  it('is enforced at compile time, not here', () => {
    // Vitest needs a runtime case in a .test.ts file; the assertions above are
    // the real gate and run under `pnpm typecheck`.
    expect(true).toBe(true)
  })
})
