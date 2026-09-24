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
 *
 * `isClientEnvironment()` is mocked true for the whole file so the "AppMapKit
 * mount: callout wiring" suite below can exercise `ensureCalloutController()`
 * — nothing else in this file reads that seam, so forcing it true has no
 * effect on the other suites.
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppMapKit from '../src/runtime/components/AppMapKit.vue'
import AppMapKitCallout from '../src/runtime/components/AppMapKitCallout.vue'
import { createMapKitCalloutController } from '@narduk-enterprises/narduk-mapkit/client'

import type { GeoJSONFeatureCollection } from '../src/runtime/components/AppMapKit.vue'
import type * as NardukMapkitClient from '@narduk-enterprises/narduk-mapkit/client'

const mapkitReady: Ref<boolean> = ref(true)
const mapkitError: Ref<string | null> = ref(null)

vi.mock('../src/runtime/composables/useMapKit', () => ({
  useMapKit: () => ({ mapkitError, mapkitReady }),
}))

vi.mock('../src/runtime/utils/isClientEnvironment', () => ({
  isClientEnvironment: () => true,
}))

// Spy-wraps the real factory (via `importOriginal`) rather than replacing it,
// so `createMapKitCalloutController` still builds a real, working controller
// — this suite asserts on how it was *called*, not a fake return value.
vi.mock('@narduk-enterprises/narduk-mapkit/client', async (importOriginal) => {
  const actual = await importOriginal<typeof NardukMapkitClient>()
  return { ...actual, createMapKitCalloutController: vi.fn(actual.createMapKitCalloutController) }
})

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
  vi.mocked(createMapKitCalloutController).mockClear()
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

/**
 * `geojson` / `overlayStyleFn` were previously never exercised with
 * `mapkitReady === true` in any test: `app-map-kit-ssr.test.ts` passes
 * `geojson` too, but by design never reaches `initMap()` (there is no DOM
 * during SSR), and nothing here previously mounted with that prop at all
 * (narduk-libs PR #282 review). This block extends the same
 * `createMapkitMock()` double above rather than inventing a second harness.
 *
 * `callouts` / `calloutMode` / `calloutPlacement` have the same gap but
 * cannot be closed the same way: `ensureCalloutController()` in
 * `AppMapKit.vue` gates construction on `if (!import.meta.client || ...)
 * return null`, and this package's `vitest.config.ts` (plain
 * `@vitejs/plugin-vue`, no Nuxt macro-replacement plugin) never defines
 * `import.meta.client` true — confirmed both by this file's own header
 * comment above (the same gate blocks `initMap()`'s `import.meta.client`
 * branch, worked around there by mocking `useMapKit()` instead) and by
 * `callouts.test.ts`'s `'never constructs the controller during SSR, or
 * without the opt-in'` test, which asserts this exact guard string via
 * source rather than by mounting. A mount test against `AppMapKit` can
 * never observe a non-null `getCalloutController()` in this environment
 * regardless of props, so one would either assert the current (environment-
 * imposed) null forever — not a behavioral test — or silently pass for the
 * wrong reason. `callout-mount.test.ts` already covers the reachable half
 * (a real `MapKitCalloutController` driving `AppMapKitCallout.vue`'s
 * rendering/lifecycle, bypassing `AppMapKit.vue`); the prop-to-controller
 * wiring inside `AppMapKit.vue` itself (`selectedId` open/close,
 * `calloutMode`/`calloutPlacement` forwarding, Escape-dismiss syncing back
 * to `selectedId`) stays untestable by mount until either `vitest.config.ts`
 * gains an `import.meta.client` define/plugin (out of this change's file
 * scope) or `AppMapKit.vue` routes that guard through a mockable seam the
 * way `initMap()` already does for `useMapKit()` (also out of scope — see
 * the PR notes for narduk-libs#282 lane F3).
 */
describe('AppMapKit mount: GeoJSON overlays', () => {
  const geojson: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'route-a' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [20, 20],
            [21, 21],
            [22, 21],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { id: 'zone-a' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [0, 10],
              [10, 10],
              [10, 0],
              [0, 0],
            ],
          ],
        },
      },
    ],
  }

  it('converts a LineString feature to a polyline overlay and a Polygon feature to a polygon overlay, with the default styles', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items: [] as Station[], geojson } })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')

    expect(map.addOverlay).toHaveBeenCalledTimes(2)
    const [lineCall, polygonCall] = map.addOverlay.mock.calls
    const lineOverlay = assertDefined(lineCall?.[0], 'expected the line overlay') as MapKitOverlay
    const polygonOverlay = assertDefined(
      polygonCall?.[0],
      'expected the polygon overlay',
    ) as MapKitOverlay

    // The 3-point LineString became a polyline overlay in the default line style...
    expect(lineOverlay.geometry).toHaveLength(3)
    expect(lineOverlay.enabled).toBe(true)
    expect((lineOverlay.options.style as MapKitStyle).options).toMatchObject({
      strokeColor: '#0284c7',
      lineWidth: 3,
    })

    // ...and the closed 5-point ring became a polygon overlay in the
    // (different) default polygon style.
    expect(polygonOverlay.geometry).toHaveLength(5)
    expect((polygonOverlay.options.style as MapKitStyle).options).toMatchObject({
      strokeColor: '#065f46',
      fillColor: '#10b981',
      lineWidth: 1.5,
    })

    wrapper.unmount()
  })

  it('applies overlayStyleFn per feature and routes an overlay click to feature-select', () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const overlayStyleFn = vi.fn((properties: Record<string, unknown>) => ({
      strokeColor: properties.id === 'route-a' ? '#ff0000' : '#00ff00',
      fillColor: '#000000',
      lineWidth: 5,
    }))

    const wrapper = mount(AppMapKit, {
      props: { items: [] as Station[], geojson, overlayStyleFn },
    })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')

    expect(overlayStyleFn).toHaveBeenCalledWith({ id: 'route-a' })
    expect(overlayStyleFn).toHaveBeenCalledWith({ id: 'zone-a' })

    const [, polygonCall] = map.addOverlay.mock.calls
    const polygonOverlay = assertDefined(
      polygonCall?.[0],
      'expected the polygon overlay',
    ) as MapKitOverlay
    expect((polygonOverlay.options.style as MapKitStyle).options).toMatchObject({
      strokeColor: '#00ff00',
      lineWidth: 5,
    })

    // Clicking the polygon overlay routes through the registered `select`
    // listener (the same one background-click uses) to `feature-select`,
    // carrying the exact feature the overlay was built from.
    const selectListener = assertDefined(
      map.listeners.get('select'),
      'expected a select listener registered on the map',
    )
    selectListener({ overlay: polygonOverlay })
    expect(wrapper.emitted('feature-select')?.[0]).toEqual([geojson.features[1]])

    wrapper.unmount()
  })

  it('rebuilds overlays (remove the old set, add the new one) when the geojson prop changes', async () => {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { items: [] as Station[], geojson } })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')
    expect(map.addOverlay).toHaveBeenCalledTimes(2)
    const firstOverlays = map.addOverlay.mock.calls.map((call) => call[0])

    const nextGeojson: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features: [geojson.features[1]!],
    }
    await wrapper.setProps({ geojson: nextGeojson })
    await nextTick()

    expect(map.removeOverlays).toHaveBeenCalledTimes(1)
    expect(map.removeOverlays.mock.calls[0]?.[0]).toEqual(firstOverlays)
    // The prior 2 plus 1 more for the single-feature replacement.
    expect(map.addOverlay).toHaveBeenCalledTimes(3)

    wrapper.unmount()
  })
})

/**
 * The prop-to-controller wiring inside `AppMapKit.vue` itself: `selectedId`
 * open/close, `calloutMode`/`calloutPlacement` forwarding, and Escape-dismiss
 * syncing back to `selectedId`. Before `isClientEnvironment()` existed as a
 * mockable seam, `ensureCalloutController()`'s `!import.meta.client` guard
 * meant this file could never observe a non-null controller regardless of
 * props (see this file's header and `callouts.test.ts`'s source-regex
 * contract test) — `callout-mount.test.ts` covers the reachable half (a real
 * `MapKitCalloutController` driving `AppMapKitCallout.vue`'s rendering,
 * bypassing `AppMapKit.vue` entirely). This suite drives the controller
 * through `AppMapKit.vue`'s own props and watchers instead.
 */
describe('AppMapKit mount: callout wiring (#269)', () => {
  const items: Station[] = [
    { id: 'a', lat: 10, lng: 20 },
    { id: 'b', lat: 12, lng: 22 },
  ]

  it('opens a callout through the real controller when selectedId is set, and closes it when cleared', async () => {
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, { props: { callouts: true, items, selectedId: null } })
    const controller = wrapper.vm.getCalloutController()
    // Not yet constructed: `ensureCalloutController()` builds on first use,
    // and nothing has opened a callout yet.
    expect(controller).toBeNull()

    await wrapper.setProps({ selectedId: 'a' })
    await nextTick()

    const opened = wrapper.vm.getCalloutController()
    expect(opened).not.toBeNull()
    expect(opened?.openKeys).toEqual(['a'])

    await wrapper.setProps({ selectedId: null })
    await nextTick()

    expect(opened?.openKeys).toEqual([])

    wrapper.unmount()
  })

  it('forwards calloutMode and calloutPlacement into the real controller construction', async () => {
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, {
      props: {
        callouts: true,
        calloutMode: 'multi',
        calloutPlacement: 'left',
        items,
        selectedId: 'b',
      },
    })
    await nextTick()

    expect(createMapKitCalloutController).toHaveBeenCalledTimes(1)
    expect(createMapKitCalloutController).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'multi', placement: 'left' }),
    )

    wrapper.unmount()
  })

  it('syncs a controller-initiated close (Escape, outside click, …) back to selectedId', async () => {
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, {
      props: { callouts: true, items, selectedId: 'a' },
    })
    await nextTick()

    const controller = wrapper.vm.getCalloutController()
    expect(controller?.openKeys).toEqual(['a'])

    // The controller closing a callout for any reason (Escape, a map click,
    // `'single'` mode replacing it, …) is exactly what `syncCallouts()`
    // reacts to; it does not distinguish by reason, only by phase. Asserting
    // on the `update:selectedId` emit (rather than reading the prop back)
    // sidesteps `defineModel`'s local-fallback semantics and matches how
    // every other emit in this file is asserted.
    controller?.close('a')
    await nextTick()

    expect(wrapper.emitted('update:selectedId')?.at(-1)).toEqual([null])

    wrapper.unmount()
  })

  it('does not sync selectedId back when calloutFollowSelection is off', async () => {
    const { mapkit } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)

    const wrapper = mount(AppMapKit, {
      props: { callouts: true, calloutFollowSelection: false, items, selectedId: 'a' },
    })
    await nextTick()
    wrapper.vm.openCallout('a')
    await nextTick()

    const controller = wrapper.vm.getCalloutController()
    expect(controller?.openKeys).toEqual(['a'])

    controller?.close('a')
    await nextTick()

    expect(wrapper.emitted('update:selectedId')).toBeUndefined()

    wrapper.unmount()
  })
})

/**
 * Keyboard selection must move focus into the callout (narduk-libs#746). The
 * core `narduk-mapkit` AppMapKit already does this; this adapter's SFC still
 * leaves focus on the pin (or never activates the pin from the keyboard).
 * Pins are MapKit annotation hosts, so the factory has to run and the host
 * has to sit in the document before we can dispatch Enter / click.
 */
describe('keyboard selection focuses the callout (narduk-libs#746)', () => {
  const items: Station[] = [
    { id: 'a', lat: 10, lng: 20 },
    { id: 'b', lat: 12, lng: 22 },
  ]

  const CalloutCard = defineComponent({
    props: { label: { required: true, type: String } },
    setup: (props) => () =>
      h('div', [
        h('span', props.label),
        h('a', { class: 'callout-link', href: '/details' }, 'View details'),
      ]),
  })

  function createPinElement(item: Station): { element: HTMLElement } {
    const element = document.createElement('div')
    element.className = 'pin'
    element.textContent = item.id
    return { element }
  }

  function materializePin(map: MapKitMapInstance, id: string): HTMLElement {
    const call = assertDefined(map.addAnnotations.mock.calls.at(-1), 'expected addAnnotations')
    const annotations = call[0] as MapKitAnnotation[]
    const annotation = annotations.find((candidate) => {
      const data = candidate.options.data as { id?: string } | undefined
      return data?.id === id
    })
    const host = assertDefined(annotation, `expected annotation for ${id}`).factory() as HTMLElement
    document.body.append(host)
    return host
  }

  async function flushFocus(): Promise<void> {
    await nextTick()
    await nextTick()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  function mountMap(extra: Record<string, unknown> = {}) {
    const { mapkit, mapInstances } = createMapkitMock()
    vi.stubGlobal('mapkit', mapkit)
    const wrapper = mount(AppMapKit, {
      attachTo: document.body,
      props: { callouts: true, createPinElement, items, selectedId: null, ...extra },
      slots: {
        default: () =>
          h(
            // vue-tsc cannot `h()` this generic slotted SFC without a cast.
            AppMapKitCallout as never,
            { items },
            {
              default: (scope: { item: Station }) => h(CalloutCard, { label: scope.item.id }),
            },
          ),
      },
    })
    const map = assertDefined(mapInstances[0], 'expected a mapkit.Map instance')
    return { map, wrapper }
  }

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('moves focus to the first focusable element in the callout', async () => {
    const { map, wrapper } = mountMap()
    const pin = materializePin(map, 'b')

    pin.focus()
    pin.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await flushFocus()

    const link = document.querySelector('[data-mapkit-callout="b"] .callout-link')
    expect(link).not.toBeNull()
    expect(document.activeElement).toBe(link)

    wrapper.unmount()
  })

  it('leaves focus on the pin after a pointer selection', async () => {
    const { map, wrapper } = mountMap()
    const pin = materializePin(map, 'b')

    pin.focus()
    pin.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushFocus()

    expect(document.querySelector('[data-mapkit-callout="b"] .callout-link')).not.toBeNull()
    expect(document.activeElement).toBe(pin)

    wrapper.unmount()
  })

  it("leaves focus on the pin when calloutFocus is 'never'", async () => {
    const { map, wrapper } = mountMap({ calloutFocus: 'never' })
    const pin = materializePin(map, 'b')

    pin.focus()
    pin.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await flushFocus()

    expect(document.querySelector('[data-mapkit-callout="b"] .callout-link')).not.toBeNull()
    expect(document.activeElement).toBe(pin)

    wrapper.unmount()
  })
})
