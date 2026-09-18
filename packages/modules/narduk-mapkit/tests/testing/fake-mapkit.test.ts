// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { MapKitAnnotationRegistry } from '../../src/client/annotations.js'
import { createFakeMapKit, isFakeMapKitNotImplemented } from '../../src/testing/index.js'
import type {
  FakeMapKitAnnotation,
  FakeMapKitHandle,
  FakeMapKitMap,
} from '../../src/testing/index.js'

function initialize(fake: FakeMapKitHandle, token = 'test-token'): void {
  fake.mapkit.init({
    authorizationCallback: (done) => {
      done(token)
    },
  })
}

function readyMap(options: Parameters<typeof createFakeMapKit>[0] = {}): {
  fake: FakeMapKitHandle
  map: FakeMapKitMap
} {
  const fake = createFakeMapKit(options)
  initialize(fake)
  const host = document.createElement('div')
  document.body.append(host)
  const map = new fake.mapkit.Map(host)
  return { fake, map }
}

describe('loading and libraries', () => {
  it('resolves load() to a SCOPED namespace, not the global one (K-10)', async () => {
    const fake = createFakeMapKit()

    const scoped = await fake.load({ libraries: ['map', 'annotations'], version: '6' })

    // 2.1.0 asserted `.toBe(fake.mapkit)` here, which is exactly the shape that
    // let 62 green end-to-end tests ship a blank map: under the fake both
    // namespaces were one object, and under MapKit JS 6 they are not.
    expect(scoped).not.toBe(fake.mapkit)
    expect(scoped.loadedLibraries).toEqual(['map', 'annotations'])
    expect(fake.mapkit.loadedLibraries).toEqual(['map', 'annotations'])
  })

  it('resolves every load() to the same scoped namespace', async () => {
    const fake = createFakeMapKit()

    const first = await fake.load({ libraries: ['map'] })
    const second = await fake.load({ libraries: ['map'] })
    const viaNamespace = await fake.mapkit.load('map')

    expect(second).toBe(first)
    expect(viaNamespace).toBe(first)
  })

  it('has no mapkit.Map without the map library, as in real v6', () => {
    const fake = createFakeMapKit({ libraries: ['annotations'] })
    expect(() => fake.mapkit.Map).toThrow(
      '[MapKit] mapkit.Map is available after loading the following library: map.',
    )
  })

  it('rejects a v5 version string', async () => {
    await expect(createFakeMapKit().load({ version: '5.77.0' })).rejects.toThrow(
      'Unsupported MapKit JS version',
    )
  })

  it('installs and uninstalls a global mapkit', () => {
    const fake = createFakeMapKit()
    const restore = fake.install()
    expect((globalThis as { mapkit?: unknown }).mapkit).toBe(fake.mapkit)
    restore()
    expect('mapkit' in globalThis).toBe(false)
  })
})

describe('authorization', () => {
  it('accepts a token in one bootstrap attempt and reports Initialized', () => {
    const fake = createFakeMapKit()
    const seen: string[] = []
    fake.mapkit.addEventListener('configuration-change', (event) => {
      seen.push((event as Event & { status: string }).status)
    })

    initialize(fake)

    expect(seen).toEqual(['Initialized'])
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.bootstrapAttempts).toEqual([{ attempt: 1, tokenIndex: 0 }])
    expect(fake.inspect.errors).toEqual([])
  })

  it("reproduces Apple's wrong-origin shape: same token 3x, one callback, then Unauthorized", () => {
    const fake = createFakeMapKit({
      auth: {
        expectedOrigin: 'https://buoystat.us',
        mode: 'wrong-origin',
        origin: 'https://preview.buoystat.us',
      },
    })
    const errors: Array<{ message: string; status: string }> = []
    fake.mapkit.addEventListener('error', (event) => {
      const detail = event as Event & { message: string; status: string }
      errors.push({ message: detail.message, status: detail.status })
    })

    initialize(fake)

    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.tokens).toHaveLength(1)
    expect(fake.inspect.bootstrapAttempts).toEqual([
      { attempt: 1, tokenIndex: 0 },
      { attempt: 2, tokenIndex: 0 },
      { attempt: 3, tokenIndex: 0 },
    ])
    expect(errors).toEqual([
      {
        message:
          'Origin does not match - expected: https://buoystat.us, actual: https://preview.buoystat.us',
        status: 'Unauthorized',
      },
    ])
    expect(fake.inspect.configurationChanges).toEqual([])
  })

  it('does not self-heal: a rejected token is never replaced without the caller re-initialising', () => {
    const fake = createFakeMapKit({ auth: { mode: 'wrong-origin' } })
    initialize(fake)
    fake.inspect.advanceClock(10_000_000)
    expect(fake.inspect.tokenCalls).toBe(1)
  })

  it('carries every ConfigurationErrorStatus Apple defines', () => {
    for (const status of [
      'Bad Request',
      'Malformed Response',
      'Network Error',
      'Timeout',
      'Too Many Requests',
      'Unauthorized',
      'Unknown',
    ] as const) {
      const fake = createFakeMapKit({ auth: { message: 'boom', mode: 'error', status } })
      initialize(fake)
      expect(fake.inspect.errors).toEqual([{ message: 'boom', status }])
    }
  })

  it('fails loudly when init() is called without an authorizationCallback', () => {
    const fake = createFakeMapKit()
    fake.mapkit.init({})
    expect(fake.inspect.errors[0]?.status).toBe('Unauthorized')
  })

  it('refuses a second init() after a SUCCESSFUL exchange', () => {
    const fake = createFakeMapKit()
    initialize(fake)
    expect(() => initialize(fake)).toThrow(
      'FakeMapKitNotImplemented: mapkit.init (called twice without a failed token exchange in between)',
    )
  })

  it('allows a second init() after a failed one, so retry() is testable (K-7)', () => {
    const fake = createFakeMapKit({ auth: { mode: 'error' } })
    initialize(fake, 'rejected-token')
    expect(fake.inspect.errors).toHaveLength(1)

    // `initializeMapKit` clears its singleton on EVERY error, so `<AppMapKit>`'s
    // retry() calls load() + init() again. 2.1.0's fake threw here, which is why
    // buoys pinned the throw as a negative assertion instead of testing recovery.
    expect(() => initialize(fake, 'second-token')).not.toThrow()
    expect(fake.inspect.tokens).toEqual(['rejected-token', 'second-token'])
    expect(fake.inspect.tokenCalls).toBe(2)
  })
})

describe('the access-key clock (behaviour past 1800 s is UNVERIFIED against Apple)', () => {
  it('re-asks for a token at the access-key expiry under the default', () => {
    const fake = createFakeMapKit({ auth: { accessKeyTtlSeconds: 1800 } })
    initialize(fake)

    fake.inspect.advanceClock(1_799_000)
    expect(fake.inspect.tokenCalls).toBe(1)

    fake.inspect.advanceClock(1_000)
    expect(fake.inspect.tokenCalls).toBe(2)
    expect(fake.inspect.configurationChanges).toEqual(['Initialized', 'Refreshed'])
  })

  it('models the pessimistic branch too: no refresh at all', () => {
    const fake = createFakeMapKit({
      auth: { accessKeyTtlSeconds: 60, onAccessKeyExpiry: 'nothing' },
    })
    initialize(fake)
    fake.inspect.advanceClock(120_000)
    expect(fake.inspect.tokenCalls).toBe(1)
    expect(fake.inspect.configurationChanges).toEqual(['Initialized'])
  })

  it('models an expiry that fails instead of refreshing', () => {
    const fake = createFakeMapKit({
      auth: { accessKeyTtlSeconds: 60, onAccessKeyExpiry: 'error', status: 'Too Many Requests' },
    })
    initialize(fake)
    fake.inspect.advanceClock(60_000)
    expect(fake.inspect.errors.map((error) => error.status)).toEqual(['Too Many Requests'])
  })

  it('never moves backwards', () => {
    const fake = createFakeMapKit()
    expect(() => fake.inspect.advanceClock(-1)).toThrow('only moves forward')
  })
})

describe('map and annotations', () => {
  it('adds, counts and removes annotations', () => {
    const { fake, map } = readyMap()
    const pin = new fake.mapkit.MarkerAnnotation(
      { latitude: 30.1, longitude: -97.7 },
      { id: 'buoy-1' },
    )

    expect(map.addAnnotation(pin)).toBe(pin)
    expect(map.annotations).toEqual([pin])
    expect(pin.map).toBe(map)
    expect(fake.inspect.annotationCounts('buoy-1')).toMatchObject({ added: 1, removed: 0 })

    map.removeAnnotation(pin)
    expect(map.annotations).toEqual([])
    expect(pin.map).toBeNull()
    expect(fake.inspect.annotationCounts(pin)).toMatchObject({ added: 1, removed: 1 })
  })

  it('builds a generic Annotation through its factory and honours anchorOffset', () => {
    const { fake, map } = readyMap({ viewport: { height: 600, width: 800 } })
    const annotation = new fake.mapkit.Annotation(
      { latitude: 0, longitude: 0 },
      () => {
        const element = document.createElement('div')
        element.className = 'pin-170x150'
        return element
      },
      { anchorOffset: new DOMPoint(-85, -150), id: 'tall-pin', size: { height: 150, width: 170 } },
    )
    map.region = new fake.mapkit.CoordinateRegion(
      { latitude: 0, longitude: 0 },
      { latitudeDelta: 2, longitudeDelta: 2 },
    )
    map.addAnnotation(annotation)

    // Centre of an 800x600 viewport, shifted by the anchor offset.
    expect(annotation.element.style.left).toBe('315px')
    expect(annotation.element.style.top).toBe('150px')
    expect(annotation.element.className).toBe('pin-170x150')
  })

  it('frames items with showItems', () => {
    const { fake, map } = readyMap()
    const items = [
      new fake.mapkit.MarkerAnnotation({ latitude: 29, longitude: -98 }),
      new fake.mapkit.MarkerAnnotation({ latitude: 31, longitude: -96 }),
    ]
    map.addAnnotations(items)
    map.showItems(items)

    expect(map.region.center.latitude).toBeCloseTo(30, 6)
    expect(map.region.center.longitude).toBeCloseTo(-97, 6)
    expect(map.region.span.latitudeDelta).toBeCloseTo(2, 6)
  })

  it('fires region-change-end on an animated region change', () => {
    const { fake, map } = readyMap()
    let ends = 0
    map.addEventListener('region-change-end', () => {
      ends += 1
    })
    map.setRegionAnimated(
      new fake.mapkit.CoordinateRegion(
        { latitude: 1, longitude: 1 },
        { latitudeDelta: 1, longitudeDelta: 1 },
      ),
      true,
    )
    expect(ends).toBe(1)
  })

  it('destroys cleanly', () => {
    const { fake, map } = readyMap()
    map.addAnnotation(new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 }))
    const element = map.element
    map.destroy()
    expect(fake.mapkit.maps).toEqual([])
    expect(element?.isConnected).toBe(false)
  })
})

describe('the buoys#112 budget: updating 1 of 600 pins', () => {
  const markerFor = (fake: FakeMapKitHandle, index: number): FakeMapKitAnnotation =>
    new fake.mapkit.MarkerAnnotation(
      { latitude: index / 100, longitude: index / 100 },
      { id: `pin-${index}` },
    )

  const pins = (fake: FakeMapKitHandle, count: number, changed?: number) =>
    Array.from({ length: count }, (_unused, index) => ({
      create: () => markerFor(fake, index),
      key: `pin-${index}`,
      signature: index === changed ? 'selected' : 'plain',
    }))

  it('touches one annotation, not six hundred', () => {
    const { fake, map } = readyMap()
    const registry = new MapKitAnnotationRegistry<FakeMapKitAnnotation>({ map })

    registry.reconcile(pins(fake, 600))
    expect(fake.inspect.count('addAnnotations')).toBe(1)
    expect(fake.inspect.annotationsAdded).toBe(600)

    fake.inspect.reset()
    registry.reconcile(pins(fake, 600, 42))

    expect(fake.inspect.annotationsAdded).toBe(1)
    expect(fake.inspect.annotationsRemoved).toBe(1)
    expect(fake.inspect.annotationCounts('pin-42')).toMatchObject({ added: 1, removed: 1 })
    expect(fake.inspect.annotationCounts('pin-41')).toMatchObject({ added: 0, removed: 0 })
    expect(map.annotations).toHaveLength(600)
  })

  it('makes the full-rebuild anti-pattern visible in the log', () => {
    const { fake, map } = readyMap()
    map.addAnnotations(Array.from({ length: 600 }, (_unused, index) => markerFor(fake, index)))

    fake.inspect.reset()
    map.annotations = Array.from({ length: 600 }, (_unused, index) => markerFor(fake, index))

    expect(fake.inspect.count('annotations=')).toBe(1)
    expect(fake.inspect.annotationsRemoved).toBe(600)
    expect(fake.inspect.annotationsAdded).toBe(600)
  })
})

describe('selection and callouts', () => {
  it('fires select then deselect and renders the delegate callout', () => {
    const { fake, map } = readyMap()
    const content = document.createElement('p')
    content.textContent = 'Lake Travis'
    const pin = new fake.mapkit.MarkerAnnotation(
      { latitude: 30.4, longitude: -97.9 },
      {
        callout: { calloutContentForAnnotation: () => content },
        id: 'travis',
        title: 'Lake Travis',
      },
    )
    map.addAnnotation(pin)

    const events: string[] = []
    for (const type of ['select', 'deselect']) {
      map.addEventListener(type, (event) => {
        events.push(
          `${type}:${(event as Event & { annotation: FakeMapKitAnnotation }).annotation.id ?? ''}`,
        )
      })
    }

    fake.inspect.selectAnnotation(map, pin)
    expect(events).toEqual(['select:travis'])
    expect(map.selectedAnnotation).toBe(pin)
    expect(pin.selected).toBe(true)

    const callout = fake.inspect.calloutElement(pin)
    expect(callout?.textContent).toBe('Lake Travis')
    expect(callout?.dataset['calloutFor']).toBe('travis')
    expect(callout?.isConnected).toBe(true)

    fake.inspect.deselectAnnotation(map)
    expect(events).toEqual(['select:travis', 'deselect:travis'])
    expect(fake.inspect.calloutElement(pin)).toBeNull()
    expect(callout?.isConnected).toBe(false)
    expect(fake.inspect.annotationCounts('travis')).toMatchObject({ deselected: 1, selected: 1 })
  })

  it('honours calloutShouldAppearForAnnotation and calloutEnabled', () => {
    const { fake, map } = readyMap()
    const suppressed = new fake.mapkit.MarkerAnnotation(
      { latitude: 0, longitude: 0 },
      { callout: { calloutShouldAppearForAnnotation: () => false }, id: 'quiet' },
    )
    const disabled = new fake.mapkit.MarkerAnnotation(
      { latitude: 0, longitude: 1 },
      { calloutEnabled: false, id: 'off' },
    )
    map.addAnnotations([suppressed, disabled])

    fake.inspect.selectAnnotation(map, suppressed)
    expect(fake.inspect.calloutElement(suppressed)).toBeNull()
    fake.inspect.selectAnnotation(map, disabled)
    expect(fake.inspect.calloutElement(disabled)).toBeNull()
  })

  it('uses calloutElementForAnnotation when the delegate supplies a whole element', () => {
    const { fake, map } = readyMap()
    const custom = document.createElement('section')
    custom.id = 'custom-callout'
    const pin = new fake.mapkit.MarkerAnnotation(
      { latitude: 0, longitude: 0 },
      { callout: { calloutElementForAnnotation: () => custom }, id: 'custom' },
    )
    map.addAnnotation(pin)
    fake.inspect.selectAnnotation(map, pin)
    expect(fake.inspect.calloutElement(pin)).toBe(custom)
  })

  it('drops the selection when the selected annotation is removed', () => {
    const { fake, map } = readyMap()
    const pin = new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 }, { id: 'gone' })
    map.addAnnotation(pin)
    fake.inspect.selectAnnotation(map, pin)
    map.removeAnnotation(pin)
    expect(map.selectedAnnotation).toBeNull()
  })
})

describe('the fidelity rule', () => {
  // Members the fake does not model are, by definition, absent from its public
  // types, so a test reaches them the way untyped consumer code does.
  const read =
    (host: object, key: string): (() => unknown) =>
    () =>
      (host as Record<string, unknown>)[key]

  /**
   * Run `attempt`, require it to have thrown the fake's not-implemented error,
   * and hand back the member it named so the caller can assert on it.
   */
  const notImplementedMember = (attempt: () => unknown): string => {
    let thrown: unknown
    try {
      attempt()
    } catch (error) {
      thrown = error
    }
    if (!isFakeMapKitNotImplemented(thrown)) {
      throw new Error(`Expected FakeMapKitNotImplemented, got: ${String(thrown)}`)
    }
    return thrown.member
  }

  it('throws for an unmodelled namespace member rather than answering undefined', () => {
    const fake = createFakeMapKit()
    expect(notImplementedMember(read(fake.mapkit, 'Geocoder'))).toBe('mapkit.Geocoder')
    expect(notImplementedMember(read(fake.mapkit, 'Search'))).toBe('mapkit.Search')
    expect(notImplementedMember(read(fake.mapkit, 'importGeoJSON'))).toBe('mapkit.importGeoJSON')
  })

  it('throws for a member Apple has not shipped either', () => {
    const fake = createFakeMapKit()
    expect(notImplementedMember(read(fake.mapkit, 'somethingInventedByATest'))).toBe(
      'mapkit.somethingInventedByATest',
    )
  })

  it('throws on a write to an unmodelled member', () => {
    const fake = createFakeMapKit()
    expect(
      notImplementedMember(() => {
        ;(fake.mapkit as unknown as Record<string, unknown>)['tileCacheBudget'] = 1
      }),
    ).toBe('mapkit.tileCacheBudget (write)')
  })

  it('throws for an unmodelled map member', () => {
    const { map } = readyMap()
    expect(notImplementedMember(read(map, 'overlays'))).toBe('mapkit.Map.overlays')
    expect(notImplementedMember(read(map, 'cameraDistance'))).toBe('mapkit.Map.cameraDistance')
  })

  it('throws for an unmodelled annotation member', () => {
    const { fake } = readyMap()
    const pin = new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 })
    expect(notImplementedMember(read(pin, 'clusteringIdentifier'))).toBe(
      'mapkit.Annotation.clusteringIdentifier',
    )
  })

  it('answers undefined for the keys a test runner probes', () => {
    const fake = createFakeMapKit()
    expect((fake.mapkit as unknown as { then?: unknown }).then).toBeUndefined()
    expect((fake.mapkit as unknown as { __v_isRef?: unknown }).__v_isRef).toBeUndefined()
  })
})

describe('the operation log', () => {
  it('records operations in order with the fake clock', () => {
    const { fake, map } = readyMap()
    fake.inspect.reset()
    fake.inspect.advanceClock(500)
    map.addAnnotation(
      new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 }, { id: 'one' }),
    )

    expect(fake.inspect.operations.map((operation) => operation.name)).toEqual([
      'MarkerAnnotation',
      'addAnnotation',
    ])
    expect(fake.inspect.operations.at(-1)).toMatchObject({
      annotationIds: ['one'],
      at: 500,
      name: 'addAnnotation',
    })
    expect(fake.inspect.now).toBe(500)
  })
})

describe('the scoped namespace (K-10)', () => {
  /** The shape `<AppMapKit>` has in production: a map built from `load()`'s namespace. */
  async function scopedMap(): Promise<{
    fake: FakeMapKitHandle
    map: FakeMapKitMap
    scoped: FakeMapKitHandle['mapkit']
  }> {
    const fake = createFakeMapKit()
    initialize(fake)
    const scoped = await fake.load({ libraries: ['map', 'annotations'] })
    const host = document.createElement('div')
    document.body.append(host)
    return { fake, map: new scoped.Map(host), scoped }
  }

  it('rejects an annotation built from globalThis.mapkit, in Apple’s words', async () => {
    const { fake, map } = await scopedMap()
    const foreign = new fake.mapkit.MarkerAnnotation(
      { latitude: 30, longitude: -88 },
      {
        id: 'foreign',
      },
    )

    expect(() => map.addAnnotations([foreign])).toThrow(
      'Map.addAnnotations expected an annotation at index 0, but got',
    )
    expect(() => map.addAnnotation(foreign)).toThrow(TypeError)
    expect(map.annotations).toEqual([])
  })

  it('accepts an annotation built from the namespace that made the map', async () => {
    const { map, scoped } = await scopedMap()
    const own = new scoped.MarkerAnnotation({ latitude: 30, longitude: -88 }, { id: 'own' })

    expect(map.addAnnotations([own])).toEqual([own])
    expect(map.annotations).toEqual([own])
  })

  it('leaves globalThis.mapkit.maps empty while a scoped map is on screen', async () => {
    const { fake, map, scoped } = await scopedMap()

    // The live measurement that found the defect, reproduced offline.
    expect(fake.mapkit.maps).toEqual([])
    expect(scoped.maps).toEqual([map])

    map.destroy()
    expect(scoped.maps).toEqual([])
  })

  it('rejects a region or rect built from a foreign namespace', async () => {
    const { fake, map } = await scopedMap()

    expect(() => {
      map.region = new fake.mapkit.CoordinateRegion(
        { latitude: 30, longitude: -88 },
        { latitudeDelta: 1, longitudeDelta: 1 },
      )
    }).toThrow('Map.region expected a value from the namespace that created this map')
    expect(() => map.setVisibleMapRectAnimated(new fake.mapkit.MapRect(0, 0, 0.1, 0.1))).toThrow(
      'Map.setVisibleMapRectAnimated expected a value from the namespace that created this map',
    )
  })

  it('shares one auth state machine across both namespaces', async () => {
    const fake = createFakeMapKit()
    const scoped = await fake.load({ libraries: ['map'] })
    const seen: string[] = []
    fake.mapkit.addEventListener('configuration-change', () => seen.push('global'))
    scoped.addEventListener('configuration-change', () => seen.push('scoped'))

    scoped.init({
      authorizationCallback: (done) => {
        done('token')
      },
    })

    expect(seen).toEqual(['global', 'scoped'])
    expect(fake.inspect.configurationChanges).toEqual(['Initialized'])
  })
})

describe('the rect camera and its degenerate inputs (K-5)', () => {
  it('derives visibleMapRect from the same projection the pins use', () => {
    const { fake, map } = readyMap()
    map.region = new fake.mapkit.CoordinateRegion(
      { latitude: 0, longitude: 0 },
      { latitudeDelta: 2, longitudeDelta: 4 },
    )

    const rect = map.visibleMapRect

    // The world is a unit square: 4 degrees of longitude is 4/360 of it, and
    // the equator is its horizontal midline.
    expect(rect.size.width).toBeCloseTo(4 / 360, 10)
    expect(rect.midY()).toBeCloseTo(0.5, 10)
    expect(rect.minX()).toBeCloseTo(178 / 360, 10)
    expect(rect.toCoordinateRegion().span.longitudeDelta).toBeCloseTo(4, 10)
  })

  it('moves the camera through setVisibleMapRectAnimated and re-places pins', () => {
    const { fake, map } = readyMap({ viewport: { height: 600, width: 800 } })
    const pin = new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 }, { id: 'origin' })
    map.addAnnotation(pin)

    const rect = map.visibleMapRect
    map.setVisibleMapRectAnimated(
      new fake.mapkit.MapRect(rect.minX(), rect.minY(), rect.size.width, rect.size.height),
    )

    expect(map.region.center.latitude).toBeCloseTo(0, 6)
    expect(pin.element.style.left).toBe('400px')
    expect(fake.inspect.count('setVisibleMapRectAnimated')).toBe(1)
  })

  it('records a MapRect with no positive extent instead of guessing', () => {
    const { fake, map } = readyMap()

    map.visibleMapRect = new fake.mapkit.MapRect(0.5, 0.5, 0, 0)

    expect(fake.inspect.degenerateCameraInputs).toEqual([
      { detail: 'MapRect size 0x0 has no positive extent', member: 'visibleMapRect' },
    ])
    // Applied, not normalised: the absurd region is there to be asserted on.
    expect(map.region.span.longitudeDelta).toBe(0)
  })

  it('records padding with no room left in the container', () => {
    const { fake, map } = readyMap({ viewport: { height: 600, width: 800 } })

    map.padding = new fake.mapkit.Padding({ bottom: 400, left: 0, right: 0, top: 400 })

    expect(fake.inspect.degenerateCameraInputs.map((input) => input.member)).toEqual(['padding'])
    expect(fake.inspect.count('camera-degenerate')).toBe(1)
    expect(map.padding.top).toBe(400)
  })
})

describe('the basemap enums (K-3)', () => {
  it('publishes mapkit.MapType and the deprecated Map.MapTypes alias', () => {
    const fake = createFakeMapKit()

    expect(fake.mapkit.MapType.MutedStandard).toBe('mutedStandard')
    expect(fake.mapkit.Map.MapTypes.MutedStandard).toBe('mutedStandard')
    expect(fake.mapkit.ColorScheme.Dark).toBe('dark')
    expect(fake.mapkit.Map.ColorSchemes.Dark).toBe('dark')
    expect(fake.mapkit.FeatureVisibility.Hidden).toBe('hidden')
  })
})

describe('the projection viewport', () => {
  it('measures the container the map was attached to when it has a size', () => {
    const fake = createFakeMapKit({ viewport: { height: 600, width: 800 } })
    initialize(fake)
    const host = document.createElement('div')
    document.body.append(host)
    // happy-dom reports 0 for both, which is what keeps every other test on the
    // configured viewport; a measured container is the browser's case.
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 844 })
    const map = new fake.mapkit.Map(host)
    const pin = new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 }, { id: 'centre' })
    map.region = new fake.mapkit.CoordinateRegion(
      { latitude: 0, longitude: 0 },
      { latitudeDelta: 2, longitudeDelta: 2 },
    )
    map.addAnnotation(pin)

    expect(pin.element.style.left).toBe('195px')
    expect(pin.element.style.top).toBe('422px')
  })
})
