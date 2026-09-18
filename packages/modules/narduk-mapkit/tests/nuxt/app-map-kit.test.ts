/**
 * @vitest-environment happy-dom
 *
 * `<AppMapKit>` itself (narduk-libs#422 §c), mounted for real against the
 * deterministic fake.
 *
 * Only `@apple/mapkit-loader`'s `load` is replaced, and only because it injects
 * a `<script>` from `cdn.apple-mapkit.com`; `renderHTMLAttributes` is Apple's
 * real implementation, so the SSR assertions below are about the tag Apple
 * actually generates. Nothing here asserts on source text.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { resetMapKitClientStateForTests } from '../../src/client/index.js'
import AppMapKit from '../../src/nuxt/runtime/components/AppMapKit.js'
import { mapKitColorModeInjectionKey } from '../../src/nuxt/runtime/injection-keys.js'

import {
  resetMapKitComposableStateForTests,
  useMapKit,
} from '../../src/nuxt/runtime/composables/useMapKit.js'
import { createFakeMapKit } from '../../src/testing/index.js'

import { headEntries, resetNuxtImportsStub, setTestRuntimeConfig } from './nuxt-imports.js'

import type * as MapKitLoader from '@apple/mapkit-loader'
import type { MapKitDiff, MapKitPinItem } from '../../src/nuxt/runtime/pin-layer.js'
import type { FakeMapKitHandle, FakeMapKitOptions } from '../../src/testing/index.js'

/**
 * The §c.6 expose. `mount()` cannot see through `expose()`, so the methods are
 * named here once -- which also makes this file fail to compile if one of them
 * is dropped.
 */
interface MapKitExpose {
  closeCallout: (id?: string) => void
  getDiagnostics: () => { annotations: number; lastDiff: MapKitDiff }
  getMap: () => unknown
  getMapKit: () => unknown
  openCallout: (id: string) => void
  retry: () => void
  scrollIntoView: () => void
  select: (id: string | null) => void
  setRegion: (center: { lat: number; lng: number }, span?: { lat: number; lng: number }) => void
  zoomToFit: (zoomOutLevels?: number) => void
}

function api(wrapper: { vm: unknown }): MapKitExpose {
  return wrapper.vm as MapKitExpose
}

const loader = vi.hoisted(() => ({
  load: null as null | ((options: Record<string, unknown>) => Promise<unknown>),
}))

vi.mock('@apple/mapkit-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof MapKitLoader>()
  return {
    ...actual,
    load: (options: Record<string, unknown>) => loader.load?.(options),
  }
})

interface Station {
  id: string
  label: string
  lat: number
  lng: number
}

const STATIONS: Station[] = [
  { id: 'station-1', label: 'Dauphin Island', lat: 30.25, lng: -88.075 },
  { id: 'station-2', label: 'Fort Morgan', lat: 30.228, lng: -88.025 },
  { id: 'station-3', label: 'Mobile Bay', lat: 30.4, lng: -88.0 },
]

let fake: FakeMapKitHandle
let loadCalls: Array<Record<string, unknown>>

function useFake(options: FakeMapKitOptions = {}): void {
  fake = createFakeMapKit(options)
  loadCalls = []
  loader.load = async (loadOptions) => {
    loadCalls.push(loadOptions)
    return await fake.load(loadOptions)
  }
}

function pinElement() {
  const element = document.createElement('span')
  element.className = 'app-glyph'
  return { element }
}

const BASE_PROPS = {
  createPinElement: pinElement,
  itemLabel: (item: MapKitPinItem) => (item as Station).label,
}

async function mountMap(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  const wrapper = mount(AppMapKit, {
    attachTo: document.body,
    props: { ...BASE_PROPS, ...props },
    slots,
  })
  await vi.waitFor(() => {
    expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
  })
  return wrapper
}

beforeEach(() => {
  resetNuxtImportsStub()
  setTestRuntimeConfig({ public: {} })
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ expiresAt: Date.now() + 1_800_000, token: 'test.jwt.value' }), {
      status: 200,
    })) as unknown as typeof fetch
  useFake()
})

afterEach(() => {
  resetMapKitClientStateForTests()
  resetMapKitComposableStateForTests()
  document.body.replaceChildren()
})

describe('<AppMapKit> lifecycle (§c.7)', () => {
  it('announces loading, then ready, and emits map-ready once', async () => {
    const wrapper = mount(AppMapKit, { attachTo: document.body, props: BASE_PROPS })

    expect(wrapper.get('.mapkit-wrapper').attributes('data-mapkit-state')).toBe('loading')
    expect(wrapper.get('[role="status"]').text()).toContain('Loading map')

    await vi.waitFor(() => {
      expect(wrapper.emitted('map-ready')).toHaveLength(1)
    })
    expect(wrapper.get('.mapkit-wrapper').attributes('data-mapkit-state')).toBe('ready')
  })

  it('builds the map when it mounts after MapKit JS is already ready (K-11)', async () => {
    const { ready } = useMapKit()
    await vi.waitFor(() => {
      expect(ready.value).toBe(true)
    })

    const wrapper = mount(AppMapKit, { attachTo: document.body, props: BASE_PROPS })

    await vi.waitFor(() => {
      expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
    })
    expect(fake.inspect.maps).toHaveLength(1)
    expect(wrapper.emitted('map-ready')).toHaveLength(1)
  })

  it('is a labelled landmark', async () => {
    const wrapper = await mountMap({ ariaLabel: 'Station map' })

    const region = wrapper.get('[role="region"]')
    expect(region.attributes('aria-label')).toBe('Station map')
  })

  it('destroys the map when it unmounts', async () => {
    const wrapper = await mountMap()
    expect(fake.inspect.maps).toHaveLength(1)

    wrapper.unmount()

    expect(fake.inspect.maps).toHaveLength(0)
  })
})

describe('libraries is real configuration (§b, §c.1)', () => {
  it('takes the module default from runtimeConfig rather than a hard-coded triple', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { libraries: ['map', 'annotations'] } } })

    await mountMap()

    expect(loadCalls[0]?.['libraries']).toStrictEqual(['map', 'annotations'])
  })

  it('lets one map override the module default', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { libraries: ['map', 'annotations'] } } })

    await mountMap({ libraries: ['map', 'overlays'] })

    expect(loadCalls[0]?.['libraries']).toStrictEqual(['map', 'overlays'])
  })

  it('falls back to the documented default when the module published nothing', async () => {
    await mountMap()

    expect(loadCalls[0]?.['libraries']).toStrictEqual(['map', 'annotations', 'overlays'])
  })
})

describe('the SSR preload tag (§c.7, §f)', () => {
  it('emits Apple renderHTMLAttributes WITHOUT a token', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { libraries: ['map', 'annotations'] } } })

    await mountMap()

    expect(headEntries).toHaveLength(1)
    const script = headEntries[0]?.script?.[0]
    expect(script).toBeDefined()
    // A token in the tag is MapKit's static, non-refreshable path, and a portal
    // token that works on a preview host has no origin restriction at all.
    expect(Object.keys(script!)).not.toContain('token')
    expect(JSON.stringify(script)).not.toContain('token')
    expect(String(script!['data-libraries'])).toContain('annotations')
  })

  it('emits nothing at all when the module turned the preload off', async () => {
    setTestRuntimeConfig({ public: { nardukMapKit: { ssrPreload: false } } })

    await mountMap()

    expect(headEntries).toStrictEqual([])
  })

  it('carries the CSP nonce onto the tag and the map container', async () => {
    const wrapper = await mountMap({ nonce: 'nonce-123' })

    expect(headEntries[0]?.script?.[0]?.['nonce']).toBe('nonce-123')
    expect(wrapper.get('.mapkit-canvas').attributes('nonce')).toBe('nonce-123')
  })
})

describe('items are diffed, not rebuilt (§c.2, buoys#112)', () => {
  it('renders the initial items in exactly one addAnnotations call', async () => {
    fake.inspect.reset()

    const wrapper = await mountMap({ items: STATIONS })

    expect(fake.inspect.count('addAnnotations')).toBe(1)
    expect(fake.inspect.count('removeAnnotations')).toBe(0)
    expect(api(wrapper).getDiagnostics().annotations).toBe(3)
  })

  it('performs zero adds and zero removes on a selection change', async () => {
    const wrapper = await mountMap({ items: STATIONS, selectedId: 'station-1' })
    fake.inspect.reset()

    await wrapper.setProps({ selectedId: 'station-2' })

    expect(fake.inspect.annotationsAdded).toBe(0)
    expect(fake.inspect.annotationsRemoved).toBe(0)
    expect(api(wrapper).getDiagnostics().lastDiff).toMatchObject({ added: [], removed: [] })
  })

  it('keeps the tapped pin focused across a selection change', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    const host = document.querySelector('[data-mapkit-pin="station-1"]') as HTMLElement
    host.focus()

    await wrapper.setProps({ selectedId: 'station-1' })

    expect(document.querySelector('[data-mapkit-pin="station-1"]')).toBe(host)
    expect(document.activeElement).toBe(host)
  })

  it('adds only the new pin when one item joins 3', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    fake.inspect.reset()

    await wrapper.setProps({
      items: [...STATIONS, { id: 'station-4', label: 'Perdido', lat: 30.3, lng: -87.5 }],
    })

    expect(fake.inspect.annotationsAdded).toBe(1)
    expect(fake.inspect.annotationsRemoved).toBe(0)
  })

  it('reports a pin activated by keyboard through update:selectedId', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    const host = document.querySelector('[data-mapkit-pin="station-2"]') as HTMLElement

    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))

    expect(wrapper.emitted('update:selectedId')).toStrictEqual([['station-2']])
  })
})

describe('per-pin geometry on a mounted map (§c.3)', () => {
  it('anchors each pin by its own size', async () => {
    const wrapper = await mountMap({
      items: STATIONS,
      pinGeometry: (item: Station) =>
        item.id === 'station-1'
          ? { size: { height: 150, width: 170 } }
          : { anchor: 'center', size: { height: 16, width: 16 } },
    })

    const map = api(wrapper).getMap() as { annotations: Array<{ anchorOffset: DOMPoint }> }
    expect(map.annotations[0]?.anchorOffset).toMatchObject({ x: -85, y: -150 })
    expect(map.annotations[1]?.anchorOffset).toMatchObject({ x: -8, y: -8 })
  })

  it('rewrites the anchor when pinGeometry changes and the items do not', async () => {
    const wrapper = await mountMap({
      items: STATIONS,
      pinGeometry: () => ({ size: { height: 150, width: 170 } }),
    })
    const annotation = (api(wrapper).getMap() as { annotations: Array<{ anchorOffset: DOMPoint }> })
      .annotations[0]

    await wrapper.setProps({ pinGeometry: () => ({ size: { height: 200, width: 170 } }) })
    await nextTick()

    expect(annotation?.anchorOffset).toMatchObject({ x: -85, y: -200 })
    expect(api(wrapper).getDiagnostics().lastDiff).toMatchObject({
      added: [],
      removed: [],
    })
  })
})

describe('the three flipped defaults (§c.1)', () => {
  it('defaults preserveRegion, suppressSelectionZoom on and showsPointsOfInterest off', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    expect(wrapper.props('preserveRegion')).toBe(true)
    expect(wrapper.props('suppressSelectionZoom')).toBe(true)
    expect(wrapper.props('showsPointsOfInterest')).toBe(false)
  })

  it('passes isRotationEnabled: false into the Map, matching the documented default', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    // MapKit JS itself defaults rotation ON. The documented prop default is
    // false, so the constructor has to name it -- omitting the option leaves
    // Apple's true in place.
    expect((api(wrapper).getMap() as { isRotationEnabled: boolean }).isRotationEnabled).toBe(false)
  })

  it('opts into rotation when the app sets isRotationEnabled', async () => {
    const wrapper = await mountMap({ items: STATIONS, isRotationEnabled: true })

    expect((api(wrapper).getMap() as { isRotationEnabled: boolean }).isRotationEnabled).toBe(true)
  })

  it('does not re-frame the map when items change', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    fake.inspect.reset()

    await wrapper.setProps({
      items: [...STATIONS, { id: 'station-4', label: 'Perdido', lat: 40, lng: -70 }],
    })

    expect(fake.inspect.count('setRegionAnimated')).toBe(0)
  })

  it('does not zoom to the selection', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    fake.inspect.reset()

    await wrapper.setProps({ selectedId: 'station-3' })

    expect(fake.inspect.count('setRegionAnimated')).toBe(0)
  })

  it('still re-frames when the app opts out of preserveRegion', async () => {
    const wrapper = await mountMap({ items: STATIONS, preserveRegion: false })
    fake.inspect.reset()

    await wrapper.setProps({
      items: [...STATIONS, { id: 'station-4', label: 'Perdido', lat: 40, lng: -70 }],
    })

    expect(fake.inspect.count('setRegionAnimated')).toBe(1)
  })
})

describe('the #callout slot (§c.4)', () => {
  const CalloutCard = defineComponent({
    props: { label: { required: true, type: String } },
    setup: (props) => () => h('a', { class: 'callout-link', href: '/details' }, props.label),
  })

  it('renders the app own Vue tree inside the map', async () => {
    const wrapper = await mountMap(
      { items: STATIONS },
      {
        callout: (scope: { item: Station }) => h(CalloutCard, { label: scope.item.label }),
      },
    )

    await wrapper.setProps({ selectedId: 'station-1' })
    await nextTick()

    const host = document.querySelector('[data-mapkit-callout="station-1"]')
    expect(host?.querySelector('.callout-link')?.textContent).toBe('Dauphin Island')
    expect(wrapper.emitted('callout-open')).toHaveLength(1)
  })

  it('closes the callout when the selection moves on', async () => {
    const wrapper = await mountMap(
      { items: STATIONS },
      { callout: (scope: { item: Station }) => h('span', scope.item.label) },
    )
    await wrapper.setProps({ selectedId: 'station-1' })
    await nextTick()

    await wrapper.setProps({ selectedId: null })
    await nextTick()

    expect(document.querySelector('[data-mapkit-callout="station-1"]')).toBeNull()
    expect(wrapper.emitted('callout-close')).toHaveLength(1)
  })

  it('leaves the callout to the app when calloutFollowSelection is off', async () => {
    const wrapper = await mountMap(
      { calloutFollowSelection: false, items: STATIONS },
      { callout: (scope: { item: Station }) => h('span', scope.item.label) },
    )

    await wrapper.setProps({ selectedId: 'station-1' })
    await nextTick()
    expect(document.querySelector('[data-mapkit-callout="station-1"]')).toBeNull()

    api(wrapper).openCallout('station-1')
    await nextTick()
    expect(document.querySelector('[data-mapkit-callout="station-1"]')).not.toBeNull()
  })
})

describe('failure and retry (§c.4, §c.6)', () => {
  it('reports the structured failure and offers a retry instead of the raw error', async () => {
    useFake({ auth: { mode: 'error', status: 'Unauthorized' } })

    const wrapper = mount(AppMapKit, { attachTo: document.body, props: BASE_PROPS })
    await vi.waitFor(() => {
      expect(wrapper.emitted('mapkit-error')).toBeTruthy()
    })

    expect(wrapper.get('.mapkit-wrapper').attributes('data-mapkit-state')).toBe('error')
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Unauthorized')
    expect(alert.text()).not.toContain('test.jwt.value')
    const failure = wrapper.emitted('mapkit-error')?.[0]?.[0] as { status: string }
    expect(failure.status).toBe('Unauthorized')
  })

  it('hands #error the failure and the retry', async () => {
    useFake({ auth: { mode: 'error', status: 'Too Many Requests' } })
    const wrapper = mount(AppMapKit, {
      attachTo: document.body,
      props: BASE_PROPS,
      slots: {
        error: (scope: { failure: { status: string } }) =>
          h('p', { class: 'app-error' }, scope.failure.status),
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.find('.app-error').exists()).toBe(true)
    })
    expect(wrapper.get('.app-error').text()).toBe('Too Many Requests')
  })

  it('recovers on retry(), which MapKit itself never does', async () => {
    useFake({ auth: { mode: 'error', status: 'Unauthorized' } })
    const wrapper = mount(AppMapKit, { attachTo: document.body, props: BASE_PROPS })
    await vi.waitFor(() => {
      expect(wrapper.emitted('mapkit-error')).toBeTruthy()
    })

    useFake()
    api(wrapper).retry()

    await vi.waitFor(() => {
      expect(wrapper.get('.mapkit-wrapper').attributes('data-mapkit-state')).toBe('ready')
    })
    expect(wrapper.emitted('map-ready')).toHaveLength(1)
  })
})

describe('the expose (§c.6)', () => {
  it('carries every documented method, retry() included', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    const exposed = api(wrapper) as unknown as Record<string, unknown>
    for (const name of [
      'closeCallout',
      'getDiagnostics',
      'getMap',
      'getMapKit',
      'openCallout',
      'retry',
      'scrollIntoView',
      'select',
      'setRegion',
      'zoomToFit',
    ]) {
      expect(typeof exposed[name]).toBe('function')
    }
  })

  it('zoomToFit frames every item', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    fake.inspect.reset()

    api(wrapper).zoomToFit()

    expect(fake.inspect.count('setRegionAnimated')).toBe(1)
    const map = api(wrapper).getMap() as { region: { center: { latitude: number } } }
    expect(map.region.center.latitude).toBeCloseTo(30.314, 3)
  })

  it('select() asks the app to change selectedId rather than changing it itself', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    api(wrapper).select('station-2')

    expect(wrapper.emitted('update:selectedId')).toStrictEqual([['station-2']])
  })
})

describe('the basemap follows its props on a live map (K-4)', () => {
  it('re-applies mapType when the prop changes, not only at construction', async () => {
    const wrapper = await mountMap({ items: STATIONS, mapType: 'standard' })
    const map = api(wrapper).getMap() as { colorScheme: string; mapType: string }
    expect(map.mapType).toBe('standard')

    await wrapper.setProps({ mapType: 'satellite' })
    await nextTick()

    // 2.1.0 passed mapType to the mapkit.Map constructor and never wrote it
    // again, so this stayed 'standard' for the life of the map.
    expect(map.mapType).toBe('satellite')
  })

  it('re-applies colorScheme when the prop changes', async () => {
    const wrapper = await mountMap({ colorScheme: 'light', items: STATIONS })
    const map = api(wrapper).getMap() as { colorScheme: string; mapType: string }

    await wrapper.setProps({ colorScheme: 'dark' })
    await nextTick()

    expect(map.colorScheme).toBe('dark')
  })

  it("hands MapKit Apple's spelling for this library's 'muted' (K-3)", async () => {
    const wrapper = await mountMap({ items: STATIONS, mapType: 'muted' })

    // 'muted' is not a MapKit JS value; `mapkit.MapType.MutedStandard` is.
    expect((api(wrapper).getMap() as { mapType: string }).mapType).toBe('mutedStandard')
  })

  it('follows an injected colour-mode source under colorScheme="auto"', async () => {
    const colorMode = ref('light')
    const wrapper = mount(AppMapKit, {
      attachTo: document.body,
      global: { provide: { [mapKitColorModeInjectionKey as symbol]: colorMode } },
      props: { ...BASE_PROPS, colorScheme: 'auto', items: STATIONS },
    })
    await vi.waitFor(() => {
      expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
    })
    const map = api(wrapper).getMap() as { colorScheme: string }
    expect(map.colorScheme).toBe('light')

    colorMode.value = 'dark'
    await nextTick()

    expect(map.colorScheme).toBe('dark')
  })
})

describe('map-ready hands over the namespace that built the map (K-10)', () => {
  it('emits the scoped namespace beside the map, never globalThis.mapkit', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    const payload = wrapper.emitted('map-ready')?.[0] as [unknown, unknown]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toBe(api(wrapper).getMap())
    // The live defect: an Annotation built from `window.mapkit` belongs to a
    // different namespace and the map's own checks reject it.
    expect(payload[1]).not.toBe(fake.mapkit)
    expect(payload[1]).toBe(await fake.load({ libraries: ['map'] }))
  })

  it('exposes the same namespace through getMapKit()', async () => {
    const wrapper = await mountMap({ items: STATIONS })

    const payload = wrapper.emitted('map-ready')?.[0] as [unknown, unknown]
    expect(api(wrapper).getMapKit()).toBe(payload[1])
  })

  it('builds annotations the map accepts, which a global-namespace one is not', async () => {
    const wrapper = await mountMap({ items: STATIONS })
    const map = api(wrapper).getMap() as {
      addAnnotations: (annotations: unknown[]) => unknown
      annotations: unknown[]
    }
    expect(map.annotations).toHaveLength(3)

    const foreign = new fake.mapkit.MarkerAnnotation({ latitude: 30, longitude: -88 })
    expect(() => map.addAnnotations([foreign])).toThrow(
      'Map.addAnnotations expected an annotation at index 0, but got',
    )

    const own = new (api(wrapper).getMapKit() as typeof fake.mapkit).MarkerAnnotation({
      latitude: 30,
      longitude: -88,
    })
    expect(() => map.addAnnotations([own])).not.toThrow()
  })
})

describe('pins that are not controls (K-8)', () => {
  it('drops the role, tabindex and listeners when pinsFocusable is false', async () => {
    const wrapper = await mountMap({ items: STATIONS, pinsFocusable: false })

    const host = document.querySelector('[data-mapkit-pin="station-1"]') as HTMLElement
    expect(host.getAttribute('role')).toBeNull()
    expect(host.getAttribute('tabindex')).toBeNull()
    expect(host.getAttribute('aria-label')).toBeNull()

    host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:selectedId')).toBeUndefined()
  })

  it('stops requiring itemLabel for a decorative map', async () => {
    const wrapper = mount(AppMapKit, {
      attachTo: document.body,
      props: { createPinElement: pinElement, items: STATIONS, pinsFocusable: false },
    })
    await vi.waitFor(() => {
      expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
    })

    expect(document.querySelectorAll('[data-mapkit-pin]')).toHaveLength(3)
  })

  it('keeps 2.1.0’s interactive host as the default', async () => {
    await mountMap({ items: STATIONS })

    const host = document.querySelector('[data-mapkit-pin="station-1"]') as HTMLElement
    expect(host.getAttribute('role')).toBe('button')
    expect(host.getAttribute('tabindex')).toBe('0')
  })
})

describe('a pin with no accessible name fails at mount (K-9)', () => {
  it('throws from setup, naming the component and both ways out', () => {
    // 2.1.0 threw from inside the pin layer, asynchronously, after the map had
    // half-built itself -- so an app saw a broken map and a stack with no
    // component in it.
    expect(() =>
      mount(AppMapKit, {
        attachTo: document.body,
        props: { createPinElement: pinElement, items: STATIONS },
      }),
    ).toThrow('<AppMapKit>: the itemLabel prop is required whenever items is non-empty')
  })

  it('throws when items become non-empty later', async () => {
    const wrapper = mount(AppMapKit, {
      attachTo: document.body,
      props: { createPinElement: pinElement, items: [] },
    })
    await vi.waitFor(() => {
      expect(wrapper.find('[data-mapkit-state="ready"]').exists()).toBe(true)
    })

    await expect(wrapper.setProps({ items: STATIONS })).rejects.toThrow(
      'the itemLabel prop is required',
    )
  })

  it('says nothing about an empty items list', () => {
    expect(() =>
      mount(AppMapKit, {
        attachTo: document.body,
        props: { createPinElement: pinElement, items: [] },
      }),
    ).not.toThrow()
  })
})
