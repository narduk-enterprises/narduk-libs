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
  FakeMapKitConfigurationChangeStatus,
  FakeMapKitConfigurationErrorStatus,
  FakeMapKitImageAnnotation,
  FakeMapKitInitializationOptions,
  FakeMapKitLoadOptions,
  FakeMapKitMap,
  FakeMapKitMarkerAnnotation,
  FakeMapKitNamespace,
  FakeMapKitShowItemsOptions,
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
type _mapDestroy = Expect<
  Equal<ReturnType<Apple.Map['destroy']>, ReturnType<FakeMapKitMap['destroy']>>
>
type _mapIsEventTarget = Expect<Extends<Apple.Map, EventTarget>>
// `showItems` is compared on its arguments only: Apple's return type includes
// `Overlay`, which the fake does not model at all.
type _mapShowItemsOptions = Expect<Extends<FakeMapKitShowItemsOptions, Apple.MapShowItemsOptions>>
type _mapShowItemsItems = Expect<
  Equal<
    Fakeify<Extract<Parameters<Apple.Map['showItems']>[0][number], Apple.Annotation>>,
    Parameters<FakeMapKitMap['showItems']>[0][number]
  >
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

describe('apple type conformance', () => {
  it('is enforced at compile time, not here', () => {
    // Vitest needs a runtime case in a .test.ts file; the assertions above are
    // the real gate and run under `pnpm typecheck`.
    expect(true).toBe(true)
  })
})
