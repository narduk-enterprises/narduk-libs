// @vitest-environment happy-dom
/**
 * Mount coverage for `AppMapKit` (narduk-libs#269) — it previously had only
 * the SSR e2e in `nuxt.test.ts` plus the source-regex contract tests
 * (`callouts.test.ts`, `fullscreen.test.ts`, `overlay-lifecycle.test.ts`),
 * none of which mount the component or exercise the MapKit JS calls it
 * makes.
 *
 * Apple's MapKit JS is a browser global (`declare const mapkit: any` in the
 * component) loaded from a CDN `<script>` tag — there is no package to
 * import a fake from, so this file stubs `globalThis.mapkit` with a minimal
 * class-based double of the constructors and enums `AppMapKit` actually
 * calls, closely enough to assert real wiring: constructor args, prop-driven
 * options, event emission, and cleanup on unmount.
 *
 * `useMapKit()` (the Apple MapKit JS *loader*) is mocked separately — its
 * job is calling `initializeMapKit()` from `@narduk-enterprises/narduk-mapkit`
 * behind `import.meta.client`, which this plain Vite/vitest compile never
 * defines true (see `app-map-kit-ssr.test.ts`), so the real composable would
 * leave `mapkitReady` false forever here. Mocking only this one seam keeps
 * everything downstream of it — `initMap()` and the whole map lifecycle —
 * real.
 */
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppMapKit from '../src/runtime/components/AppMapKit.vue'

const mapkitReady: Ref<boolean> = ref(true)
const mapkitError: Ref<string | null> = ref(null)

vi.mock('../src/runtime/composables/useMapKit', () => ({
  useMapKit: () => ({ mapkitError, mapkitReady }),
}))

class MapKitCoordinate {
  constructor(
    public latitude: number,
    public longitude: number,
  ) {}
}

class MapKitCoordinateSpan {
  constructor(
    public latitudeDelta: number,
    public longitudeDelta: number,
  ) {}
}

class MapKitCoordinateRegion {
  constructor(
    public center: MapKitCoordinate,
    public span: MapKitCoordinateSpan,
  ) {}
}

class MapKitAnnotation {
  constructor(
    public coordinate: MapKitCoordinate,
    public factory: () => unknown,
    public options: Record<string, unknown> = {},
  ) {}
}

class MapKitStyle {
  constructor(public options: Record<string, unknown>) {}
}

class MapKitOverlay {
  enabled = false
  constructor(
    public geometry: unknown,
    public options: Record<string, unknown>,
  ) {}
}

interface MapKitMapInstance {
  addAnnotation: ReturnType<typeof vi.fn>
  addAnnotations: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  addOverlay: ReturnType<typeof vi.fn>
  colorScheme: unknown
  convertCoordinateToPointOnPage: ReturnType<typeof vi.fn>
  convertPointOnPageToCoordinate: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  element: HTMLElement
  isRotationAvailable: boolean
  isRotationEnabled: boolean
  listeners: globalThis.Map<string, (event: unknown) => void>
  options: Record<string, unknown>
  pointOfInterestFilter: unknown
  region: MapKitCoordinateRegion
  removeAnnotations: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  removeOverlay: ReturnType<typeof vi.fn>
  removeOverlays: ReturnType<typeof vi.fn>
  setRegionAnimated: ReturnType<typeof vi.fn>
}

function createMapkitMock() {
  const mapInstances: MapKitMapInstance[] = []

  class MapKitMap {
    static ColorSchemes = { Dark: 'dark', Light: 'light' }
    static MapTypes = { MutedStandard: 'muted-standard', Standard: 'standard' }

    element: HTMLElement
    region: MapKitCoordinateRegion
    colorScheme: unknown
    isRotationAvailable = false
    isRotationEnabled = false
    pointOfInterestFilter: unknown
    options: Record<string, unknown>
    listeners = new globalThis.Map<string, (event: unknown) => void>()
    addAnnotation = vi.fn()
    addAnnotations = vi.fn()
    removeAnnotations = vi.fn()
    addOverlay = vi.fn()
    removeOverlay = vi.fn()
    removeOverlays = vi.fn()
    setRegionAnimated = vi.fn()
    destroy = vi.fn()
    convertPointOnPageToCoordinate = vi.fn(() => new MapKitCoordinate(0, 0))
    convertCoordinateToPointOnPage = vi.fn(() => ({ x: 0, y: 0 }))
    addEventListener = vi.fn((name: string, cb: (event: unknown) => void) => {
      this.listeners.set(name, cb)
    })

    removeEventListener = vi.fn((name: string) => {
      this.listeners.delete(name)
    })

    constructor(container: HTMLElement, options: Record<string, unknown>) {
      this.element = container
      this.options = options
      this.colorScheme = options.colorScheme
      this.pointOfInterestFilter = options.pointOfInterestFilter
      this.region =
        (options.region as MapKitCoordinateRegion) ??
        new MapKitCoordinateRegion(new MapKitCoordinate(0, 0), new MapKitCoordinateSpan(0.01, 0.01))
      mapInstances.push(this as unknown as MapKitMapInstance)
    }
  }

  return {
    mapInstances,
    mapkit: {
      Coordinate: MapKitCoordinate,
      CoordinateSpan: MapKitCoordinateSpan,
      CoordinateRegion: MapKitCoordinateRegion,
      Annotation: MapKitAnnotation,
      Style: MapKitStyle,
      PolygonOverlay: MapKitOverlay,
      PolylineOverlay: MapKitOverlay,
      CircleOverlay: MapKitOverlay,
      Map: MapKitMap,
      FeatureVisibility: { Adaptive: 'adaptive', Hidden: 'hidden', Visible: 'visible' },
      PointOfInterestFilter: { excludingAllCategories: 'excluding-all-categories' },
    },
  }
}

interface Station {
  id: string
  lat: number
  lng: number
}

function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

beforeEach(() => {
  mapkitReady.value = true
  mapkitError.value = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AppMapKit mount: loading and error states', () => {
  it('shows the loading status and hides the canvas before MapKit is ready', () => {
    mapkitReady.value = false
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items: [] as Station[] } })

    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('Loading map')
    expect(wrapper.find('.mapkit-canvas--hidden').exists()).toBe(true)
    expect(wrapper.find('.mapkit-status strong').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the error message and never constructs a map when MapKit fails to load', () => {
    // Matches the real useMapKit(): the promise rejects before `ready` is
    // ever set, so `error` and `ready=true` never coexist.
    mapkitReady.value = false
    mapkitError.value = 'MapKit JS initialization failed'
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items: [] as Station[] } })

    expect(wrapper.get('.mapkit-status strong').text()).toBe('Map unavailable')
    expect(wrapper.text()).toContain('MapKit JS initialization failed')
    expect(mapInstances).toHaveLength(0)

    wrapper.unmount()
  })
})

describe('AppMapKit mount: map initialization', () => {
  const items: Station[] = [
    { id: 'a', lat: 10, lng: 20 },
    { id: 'b', lat: 12, lng: 22 },
  ]

  it('constructs the map against the canvas container with props wired into the options', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, {
      props: { items, isZoomEnabled: false, showsPointsOfInterest: false },
    })

    expect(mapInstances).toHaveLength(1)
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')
    // The container mapkit.Map was constructed against is the component's
    // own canvas element, not some other node.
    expect(map.element).toBe(wrapper.get('.mapkit-canvas').element)
    expect(wrapper.find('.mapkit-canvas--hidden').exists()).toBe(false)

    // isZoomEnabled=false is forwarded both as the interaction flag and the
    // visible zoom control.
    expect(map.options.isZoomEnabled).toBe(false)
    expect(map.options.showsZoomControl).toBe(false)
    // showsPointsOfInterest=false routes through the exclude-all POI filter
    // rather than the plain flag.
    expect(map.options.mapType).toBe('muted-standard')
    expect(map.options.pointOfInterestFilter).toBe('excluding-all-categories')

    // The bounding region is computed from `items`: lat/lng span padded by
    // the default 5%, centered on the midpoint.
    const region = map.options.region as MapKitCoordinateRegion
    expect(region.center.latitude).toBeCloseTo(11)
    expect(region.center.longitude).toBeCloseTo(21)
    expect(region.span.latitudeDelta).toBeCloseTo(2 * 1.05)
    expect(region.span.longitudeDelta).toBeCloseTo(2 * 1.05)

    // One selection listener registered on the map itself (background
    // click), matching the source-regex contract in overlay-lifecycle.test.ts.
    expect(map.addEventListener).toHaveBeenCalledWith('select', expect.any(Function))

    wrapper.unmount()
  })

  it('emits map-ready with the constructed map instance', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items } })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')

    expect(wrapper.emitted('map-ready')).toHaveLength(1)
    expect(wrapper.emitted('map-ready')?.[0]).toEqual([map])
    expect(wrapper.vm.getMap()).toBe(map)

    wrapper.unmount()
  })

  it('registers one mapkit.Annotation per item, positioned and identified correctly', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const createPinElement = vi.fn(() => ({ element: {} as HTMLElement }))
    const wrapper = mount(AppMapKit, { props: { items, createPinElement } })

    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')
    expect(map.addAnnotations).toHaveBeenCalledTimes(1)
    const call = assertDefined(map.addAnnotations.mock.calls[0], 'expected an addAnnotations call')
    const annotations = call[0] as MapKitAnnotation[]
    expect(annotations).toHaveLength(2)
    const [firstAnnotation, secondAnnotation] = annotations
    const first = assertDefined(firstAnnotation, 'expected annotation for item a')
    const second = assertDefined(secondAnnotation, 'expected annotation for item b')
    expect(first.coordinate).toEqual(new MapKitCoordinate(10, 20))
    expect(first.options.data).toEqual({ id: 'a' })
    expect(second.coordinate).toEqual(new MapKitCoordinate(12, 22))
    expect(second.options.data).toEqual({ id: 'b' })

    wrapper.unmount()
  })

  it('reacts to selectedId: rebuilds pins and zooms to the selected item', async () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, {
      props: { items, createPinElement: () => ({ element: {} as HTMLElement }) },
    })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')
    expect(map.addAnnotations).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ selectedId: 'b' })
    await nextTick()

    // Selecting rebuilds the pin set (cleared + re-added) and zooms to it.
    expect(map.removeAnnotations).toHaveBeenCalledTimes(1)
    expect(map.addAnnotations).toHaveBeenCalledTimes(2)
    expect(map.setRegionAnimated).toHaveBeenCalledTimes(1)
    const zoomCall = assertDefined(
      map.setRegionAnimated.mock.calls[0],
      'expected a setRegionAnimated call',
    ) as [MapKitCoordinateRegion, boolean]
    const [region, animated] = zoomCall
    expect(region.center).toEqual(new MapKitCoordinate(12, 22))
    expect(animated).toBe(true)

    wrapper.unmount()
  })

  it('renders the fullscreen toggle only when opted in, with the expected ARIA wiring', () => {
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const off = mount(AppMapKit, { props: { items: [] as Station[] } })
    expect(off.find('.mapkit-fullscreen-toggle').exists()).toBe(false)
    off.unmount()

    const on = mount(AppMapKit, { props: { items: [] as Station[], fullscreenControl: true } })
    const toggle = on.get('.mapkit-fullscreen-toggle')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('View map fullscreen')
    on.unmount()
  })

  it('destroys the map and removes its listener on unmount', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items } })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')

    wrapper.unmount()

    expect(map.destroy).toHaveBeenCalledTimes(1)
    expect(map.removeEventListener).toHaveBeenCalledWith('select', expect.any(Function))
  })
})
