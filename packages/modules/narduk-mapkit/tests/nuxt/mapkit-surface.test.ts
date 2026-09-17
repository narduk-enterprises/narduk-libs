/**
 * @vitest-environment happy-dom
 *
 * Type-level conformance: `runtime/mapkit-surface.ts` against Apple's real types.
 *
 * The `./nuxt` controllers declare the slice of MapKit they touch structurally,
 * so they can be driven by a plain test against the fake with no browser. That
 * freedom is only safe if the declarations cannot drift from Apple's, which is
 * what this file pins: every assertion has the form `Extends<Real, Declared>`,
 * so a declared member Apple does not have, or one declared narrower than
 * Apple's, fails `pnpm typecheck` on the exact line.
 *
 * It deliberately does NOT require the surface to cover everything Apple ships.
 * The surface is short on purpose: a member the fake does not model throws
 * rather than answering `undefined`, so what is NOT here is as load-bearing as
 * what is.
 */
import { describe, expect, it } from 'vitest'
import type * as Apple from 'apple-mapkit'

import type {
  MapKitAnnotationLike,
  MapKitAnnotationOptionsLike,
  MapKitCoordinateLike,
  MapKitMapLike,
  MapKitRegionLike,
  MapKitSizeLike,
  MapKitSpanLike,
} from '../../src/nuxt/runtime/mapkit-surface.js'

type Extends<Real, Declared> = [Real] extends [Declared] ? true : false
type Expect<T extends true> = T

type _Coordinate = Expect<Extends<Apple.Coordinate, MapKitCoordinateLike>>
type _Span = Expect<Extends<Apple.CoordinateSpan, MapKitSpanLike>>
type _Region = Expect<Extends<Apple.CoordinateRegion, MapKitRegionLike>>
type _Size = Expect<Extends<{ height: number; width: number }, MapKitSizeLike>>

/** Every annotation member the pin layer reads or writes, at Apple's own type. */
type _AnnotationAnchorOffset = Expect<Extends<Apple.Annotation['anchorOffset'], DOMPoint>>
type _AnnotationCalloutEnabled = Expect<Extends<Apple.Annotation['calloutEnabled'], boolean>>
type _AnnotationCoordinate = Expect<
  Extends<Apple.Annotation['coordinate'], MapKitAnnotationLike['coordinate']>
>
type _AnnotationElement = Expect<Extends<Apple.Annotation['element'], HTMLElement>>
type _AnnotationId = Expect<Extends<Apple.Annotation['id'], MapKitAnnotationLike['id']>>
type _AnnotationSize = Expect<Extends<Apple.Annotation['size'], MapKitAnnotationLike['size']>>
type _AnnotationLabel = Expect<
  Extends<Apple.Annotation['accessibilityLabel'], MapKitAnnotationLike['accessibilityLabel']>
>

/** The constructor options the pin layer passes. */
type _OptionsAnchorOffset = Expect<
  Extends<
    MapKitAnnotationOptionsLike['anchorOffset'],
    Apple.AnnotationConstructorOptions['anchorOffset']
  >
>
type _OptionsCalloutEnabled = Expect<
  Extends<
    MapKitAnnotationOptionsLike['calloutEnabled'],
    Apple.AnnotationConstructorOptions['calloutEnabled']
  >
>
type _OptionsClustering = Expect<
  Extends<
    MapKitAnnotationOptionsLike['clusteringIdentifier'],
    Apple.AnnotationConstructorOptions['clusteringIdentifier']
  >
>
type _OptionsData = Expect<
  Extends<MapKitAnnotationOptionsLike['data'], Apple.AnnotationConstructorOptions['data']>
>

/** The map members the runtime touches. */
type _MapElement = Expect<Extends<Apple.Map['element'], MapKitMapLike['element']>>
type _MapRegion = Expect<Extends<Apple.Map['region'], MapKitMapLike['region']>>
type _MapDestroy = Expect<Extends<Apple.Map['destroy'], () => void>>

describe('runtime/mapkit-surface.ts (§c)', () => {
  it('compiles only while it matches Apple own types', () => {
    // The assertions are the `type _*` aliases above; this keeps the file a
    // test rather than a type-only module vitest would report as empty.
    expect(true).toBe(true)
  })

  it('names no member the deterministic fake refuses to model', async () => {
    // The fidelity rule is the runtime half of the same contract: a map member
    // that is NOT on MapKitMapLike throws rather than answering undefined, so
    // the two lists have to agree.
    const { createFakeMapKit, isFakeMapKitNotImplemented } =
      await import('../../src/testing/index.js')
    const fake = createFakeMapKit()
    const map = new fake.mapkit.Map(document.createElement('div'))

    let threw = false
    try {
      // `mapType` is deliberately absent from MapKitMapLike: the component
      // passes it as a constructor option and never reads it back.
      void (map as unknown as { mapType: unknown }).mapType
    } catch (error) {
      threw = isFakeMapKitNotImplemented(error)
    }
    expect(threw).toBe(true)
  })
})
