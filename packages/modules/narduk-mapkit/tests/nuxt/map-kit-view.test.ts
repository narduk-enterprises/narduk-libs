// @vitest-environment happy-dom
/**
 * `useMapKitView()` against the kit's own fake MapKit: the host-size settle,
 * the K-10 namespace guard, the mark layer, padding and the camera.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useMapKitView } from '../../src/nuxt/runtime/composables/useMapKitView.js'
import { createFakeMapKit } from '../../src/testing/index.js'

import type { FrameInsets } from '../../src/marks/camera.js'
import type { MarkSpec } from '../../src/marks/layer.js'
import type { MkMapType } from '../../src/marks/runtime.js'
import type { FakeMapKitHandle, FakeMapKitMap } from '../../src/testing/index.js'
import type { EffectScope } from 'vue'

const NO_INSETS: FrameInsets = { bottom: 0, left: 0, right: 0, top: 0 }

let scope: EffectScope | null = null

afterEach(() => {
  scope?.stop()
  scope = null
  document.body.innerHTML = ''
})

async function scopedMap(): Promise<{
  fake: FakeMapKitHandle
  map: FakeMapKitMap
  scoped: FakeMapKitHandle['mapkit']
}> {
  const fake = createFakeMapKit()
  fake.mapkit.init({ authorizationCallback: (done) => done('test-token') })
  const scoped = await fake.load({ libraries: ['map', 'annotations'] })
  const host = document.createElement('div')
  document.body.append(host)
  return { fake, map: new scoped.Map(host), scoped }
}

/** happy-dom does no layout, so a test says what size the map element has. */
function sizeHost(map: FakeMapKitMap, width: number, height: number) {
  Object.defineProperty(map.element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(map.element, 'clientHeight', { configurable: true, value: height })
}

function mark(key: string, lat: number, lon: number): MarkSpec {
  return {
    build: () => {
      const element = document.createElement('div')
      element.className = 'test-mark'
      return element
    },
    key,
    lat,
    lon,
    signature: key,
  }
}

function mountView(
  overrides: Partial<{
    basemap: () => MkMapType
    padding: () => FrameInsets
    specs: () => readonly MarkSpec[]
  }> = {},
) {
  scope = effectScope()
  const view = scope.run(() =>
    useMapKitView({
      basemap: overrides.basemap ?? (() => 'MutedStandard'),
      insets: () => NO_INSETS,
      ...(overrides.padding ? { padding: overrides.padding } : {}),
      specs: overrides.specs ?? (() => []),
      surface: () => null,
    }),
  )
  if (!view) throw new Error('effect scope did not run')
  return view
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

describe('useMapKitView', () => {
  it('turns the built-in controls off and applies the basemap from the namespace', async () => {
    const { map, scoped } = await scopedMap()
    sizeHost(map, 800, 600)
    const view = mountView({ basemap: () => 'Satellite' })

    view.onMapReady(map, scoped)

    expect(map.showsZoomControl).toBe(false)
    expect(map.showsMapTypeControl).toBe(false)
    expect(map.showsScale).toBe('hidden')
    expect(map.mapType).toBe(scoped.MapType.Satellite)
    expect(view.mapReady.value).toBe(true)
    expect(view.frame.value).toStrictEqual({ height: 600, width: 800 })
    expect(view.rect.value).not.toBeNull()
  })

  it('ignores a map-ready without the scoped namespace (K-10)', async () => {
    const { map } = await scopedMap()
    sizeHost(map, 800, 600)
    const view = mountView()

    view.onMapReady(map, undefined)

    expect(view.mapReady.value).toBe(false)
    expect(view.rect.value).toBeNull()
  })

  it('holds mapReady until the host has a laid-out box', async () => {
    const { map, scoped } = await scopedMap()
    sizeHost(map, 0, 0)
    const view = mountView()

    view.onMapReady(map, scoped)
    expect(view.mapReady.value).toBe(false)

    sizeHost(map, 390, 844)
    await nextFrame()
    await nextFrame()

    expect(view.mapReady.value).toBe(true)
    expect(view.frame.value).toStrictEqual({ height: 844, width: 390 })
  })

  it('draws the specs through the mark layer once ready, and re-draws on change', async () => {
    const { map, scoped } = await scopedMap()
    sizeHost(map, 800, 600)
    const specs = shallowRef<readonly MarkSpec[]>([mark('a', 30, -97), mark('b', 31, -98)])
    const view = mountView({ specs: () => specs.value })

    view.onMapReady(map, scoped)
    await nextTick()
    expect(map.annotations).toHaveLength(2)

    specs.value = [mark('a', 30, -97)]
    await nextTick()
    expect(map.annotations).toHaveLength(1)
  })

  it('applies padding without moving the whole-frame camera', async () => {
    const { map, scoped } = await scopedMap()
    sizeHost(map, 800, 600)
    const padding = shallowRef<FrameInsets>(NO_INSETS)
    const view = mountView({ padding: () => padding.value })

    view.onMapReady(map, scoped)
    const before = view.rect.value

    padding.value = { bottom: 120, left: 0, right: 0, top: 0 }
    await nextTick()

    expect(map.padding.bottom).toBe(120)
    const after = view.rect.value
    expect(after?.origin.x).toBeCloseTo(before?.origin.x ?? Number.NaN, 9)
    expect(after?.origin.y).toBeCloseTo(before?.origin.y ?? Number.NaN, 9)
    expect(after?.size.width).toBeCloseTo(before?.size.width ?? Number.NaN, 9)
    expect(after?.size.height).toBeCloseTo(before?.size.height ?? Number.NaN, 9)
  })

  it('moves the camera through the scoped MapRect for fitBox and zoomBy', async () => {
    const { fake, map, scoped } = await scopedMap()
    sizeHost(map, 800, 600)
    const view = mountView()
    view.onMapReady(map, scoped)
    const moves = fake.inspect.count('setVisibleMapRectAnimated')

    view.fitBox({ east: -93, north: 36, south: 26, west: -106 }, false)
    view.zoomBy(2)

    expect(fake.inspect.count('setVisibleMapRectAnimated')).toBe(moves + 2)
  })

  it('removes its marks and listener when the scope ends', async () => {
    const { map, scoped } = await scopedMap()
    sizeHost(map, 800, 600)
    const view = mountView({ specs: () => [mark('a', 30, -97)] })
    view.onMapReady(map, scoped)
    await nextTick()
    expect(map.annotations).toHaveLength(1)

    scope?.stop()
    scope = null

    expect(map.annotations).toHaveLength(0)
    expect(view.mapReady.value).toBe(false)
  })
})
