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
  it('returns the namespace from a load(options)-compatible entry', async () => {
    const fake = createFakeMapKit()
    await expect(fake.load({ libraries: ['map', 'annotations'], version: '6' })).resolves.toBe(
      fake.mapkit,
    )
    expect(fake.mapkit.loadedLibraries).toEqual(['map', 'annotations'])
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
    const errors: { message: string; status: string }[] = []
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

  it('refuses a second init() rather than quietly re-running the exchange', () => {
    const fake = createFakeMapKit()
    initialize(fake)
    expect(() => initialize(fake)).toThrow(
      'FakeMapKitNotImplemented: mapkit.init (called twice on one namespace)',
    )
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

  const expectNotImplemented = (member: string, attempt: () => unknown): void => {
    let thrown: unknown
    try {
      attempt()
    } catch (error) {
      thrown = error
    }
    expect(isFakeMapKitNotImplemented(thrown)).toBe(true)
    expect((thrown as { member: string }).member).toBe(member)
  }

  it('throws for an unmodelled namespace member rather than answering undefined', () => {
    const fake = createFakeMapKit()
    expectNotImplemented('mapkit.Geocoder', read(fake.mapkit, 'Geocoder'))
    expectNotImplemented('mapkit.Search', read(fake.mapkit, 'Search'))
    expectNotImplemented('mapkit.importGeoJSON', read(fake.mapkit, 'importGeoJSON'))
  })

  it('throws for a member Apple has not shipped either', () => {
    const fake = createFakeMapKit()
    expectNotImplemented(
      'mapkit.somethingInventedByATest',
      read(fake.mapkit, 'somethingInventedByATest'),
    )
  })

  it('throws on a write to an unmodelled member', () => {
    const fake = createFakeMapKit()
    expectNotImplemented('mapkit.tileCacheBudget (write)', () => {
      ;(fake.mapkit as unknown as Record<string, unknown>)['tileCacheBudget'] = 1
    })
  })

  it('throws for an unmodelled map member', () => {
    const { map } = readyMap()
    expectNotImplemented('mapkit.Map.overlays', read(map, 'overlays'))
    expectNotImplemented('mapkit.Map.cameraDistance', read(map, 'cameraDistance'))
  })

  it('throws for an unmodelled annotation member', () => {
    const { fake } = readyMap()
    const pin = new fake.mapkit.MarkerAnnotation({ latitude: 0, longitude: 0 })
    expectNotImplemented(
      'mapkit.Annotation.clusteringIdentifier',
      read(pin, 'clusteringIdentifier'),
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
