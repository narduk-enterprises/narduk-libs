/**
 * @vitest-environment happy-dom
 *
 * `MapKitCalloutHostLayer` `keepInView`: a callout is measured and kept inside
 * the map instead of being clipped by it.
 *
 * happy-dom does no layout, so sizes are stubbed on the container and on every
 * host the layer creates (`offsetWidth` / `offsetHeight` / `clientWidth` /
 * `clientHeight`), which is exactly the surface the layer reads.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { MapKitCalloutHostLayer } from '../../src/nuxt/runtime/callout-host.js'

import type { MapKitCalloutPoint } from '../../src/nuxt/runtime/callout-host.js'

const MAP = { height: 400, width: 600 }
const CALLOUT = { height: 120, width: 200 }

function define(element: HTMLElement, name: string, value: number): void {
  Object.defineProperty(element, name, { configurable: true, value })
}

function harness(point: MapKitCalloutPoint, keepInView?: boolean) {
  const container = document.createElement('div')
  define(container, 'clientWidth', MAP.width)
  define(container, 'clientHeight', MAP.height)
  document.body.append(container)
  const layer = new MapKitCalloutHostLayer<{ id: string }>({
    container,
    ...(keepInView === undefined ? {} : { keepInView }),
    projectCoordinate: () => point,
  })
  // The host is created inside `open`, before its first measurement: size it as
  // soon as it joins the container.
  const original = container.append.bind(container)
  container.append = (...nodes: Array<Node | string>) => {
    for (const node of nodes) {
      if (typeof node !== 'string') {
        define(node as HTMLElement, 'offsetWidth', CALLOUT.width)
        define(node as HTMLElement, 'offsetHeight', CALLOUT.height)
      }
    }
    original(...nodes)
  }
  const entry = layer.open({ coordinate: { lat: 0, lng: 0 }, id: 'a', item: { id: 'a' } })
  if (!entry) throw new Error('callout did not open')
  return { entry, host: entry.host, layer }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('MapKitCalloutHostLayer keepInView', () => {
  it('places a callout that fits above the pin, centred on it', () => {
    const { entry, host } = harness({ x: 300, y: 250 })

    expect(entry.placement).toBe('above')
    expect(host.style.left).toBe('200px')
    expect(host.style.top).toBe('130px')
    expect(host.style.transform).toBe('none')
    expect(host.hasAttribute('data-mapkit-callout-shifted')).toBe(false)
  })

  it('slides away from the right edge and keeps the caret on the pin', () => {
    const { entry, host } = harness({ x: 580, y: 250 })

    // 600 - 200 - 8 padding
    expect(host.style.left).toBe('392px')
    expect(host.hasAttribute('data-mapkit-callout-shifted')).toBe(true)
    expect(entry.layout?.shifted).toBe(true)
    // The pin is 188 px along a 200 px box; the caret stops 12 px short of the corner.
    expect(host.style.getPropertyValue('--mapkit-callout-caret-x')).toBe('188px')
  })

  it('slides away from the left edge', () => {
    const { host } = harness({ x: 10, y: 250 })

    expect(host.style.left).toBe('8px')
    expect(host.style.getPropertyValue('--mapkit-callout-caret-x')).toBe('12px')
  })

  it('flips below the pin when there is no room above', () => {
    const { entry, host } = harness({ x: 300, y: 60 })

    expect(entry.placement).toBe('below')
    expect(host.getAttribute('data-mapkit-callout-placement')).toBe('below')
    expect(host.style.top).toBe('60px')
  })

  it('hides a callout whose pin has been panned out of the map', () => {
    const { host } = harness({ x: 700, y: 250 })

    expect(host.hidden).toBe(true)
  })

  it('keeps the plain placement when the host cannot be measured', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const layer = new MapKitCalloutHostLayer<{ id: string }>({
      container,
      projectCoordinate: () => ({ x: 580, y: 250 }),
    })

    const entry = layer.open({ coordinate: { lat: 0, lng: 0 }, id: 'a', item: { id: 'a' } })

    expect(entry?.layout).toBeNull()
    expect(entry?.host.style.left).toBe('580px')
    expect(entry?.host.style.transform).toBe('translate(-50%, -100%)')
  })

  it('keepInView: false opts out of measuring', () => {
    const { entry, host } = harness({ x: 580, y: 250 }, false)

    expect(entry.layout).toBeNull()
    expect(host.style.left).toBe('580px')
    expect(host.style.transform).toBe('translate(-50%, -100%)')
  })
})

describe('MapKitCalloutHostLayer content that arrives after the first placement', () => {
  type ObserverCallback = (
    entries: Array<{ contentRect: { height: number; width: number } }>,
  ) => void
  let callbacks: ObserverCallback[] = []
  let disconnects = 0

  class FakeResizeObserver {
    constructor(callback: ObserverCallback) {
      callbacks.push(callback)
    }

    disconnect(): void {
      disconnects++
    }

    observe(): void {}
  }

  /** An unsized host, like the one the layer creates before the Teleport has filled it. */
  function lateHarness(point: MapKitCalloutPoint) {
    callbacks = []
    disconnects = 0
    ;(document.defaultView as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver
    const container = document.createElement('div')
    define(container, 'clientWidth', MAP.width)
    define(container, 'clientHeight', MAP.height)
    document.body.append(container)
    let projections = 0
    const layer = new MapKitCalloutHostLayer<{ id: string }>({
      container,
      projectCoordinate: () => {
        projections++
        return point
      },
    })
    const entry = layer.open({ coordinate: { lat: 0, lng: 0 }, id: 'a', item: { id: 'a' } })
    if (!entry) throw new Error('callout did not open')
    const fill = (width: number, height: number): void => {
      define(entry.host, 'offsetWidth', width)
      define(entry.host, 'offsetHeight', height)
    }
    return { entry, fill, host: entry.host, layer, projections: () => projections }
  }

  it('falls back to the plain placement while the host is empty, then fits it when it is filled', () => {
    const { entry, fill, host } = lateHarness({ x: 580, y: 250 })
    expect(entry.layout).toBeNull()
    expect(host.style.transform).toBe('translate(-50%, -100%)')
    expect(callbacks).toHaveLength(1)

    fill(CALLOUT.width, CALLOUT.height)
    callbacks[0]!([{ contentRect: { height: CALLOUT.height, width: CALLOUT.width } }])

    // Slid inside the right edge instead of staying where it would be clipped.
    expect(host.style.left).toBe('392px')
    expect(host.style.transform).toBe('none')
    expect(host.hasAttribute('data-mapkit-callout-shifted')).toBe(true)
  })

  it('fits again when the content grows later (an image, a fetched row)', () => {
    const { fill, host } = lateHarness({ x: 300, y: 250 })
    fill(200, 60)
    callbacks[0]!([{ contentRect: { height: 60, width: 200 } }])
    expect(host.style.top).toBe('190px')

    fill(200, 120)
    callbacks[0]!([{ contentRect: { height: 120, width: 200 } }])
    expect(host.style.top).toBe('130px')
  })

  it('does not loop on the resize its own measuring causes', () => {
    const { fill, projections } = lateHarness({ x: 300, y: 250 })
    fill(200, 120)
    callbacks[0]!([{ contentRect: { height: 120, width: 200 } }])
    const placed = projections()

    // The observer reports the size the layer itself just produced.
    callbacks[0]!([{ contentRect: { height: 120, width: 200 } }])
    callbacks[0]!([{ contentRect: { height: 120, width: 200 } }])

    expect(projections()).toBe(placed)
  })

  it('stops observing when the callout closes or the layer is destroyed', () => {
    const { layer } = lateHarness({ x: 300, y: 250 })
    layer.close('a')
    expect(disconnects).toBe(1)
    layer.open({ coordinate: { lat: 0, lng: 0 }, id: 'b', item: { id: 'b' } })
    layer.destroy()
    expect(disconnects).toBe(2)
  })

  it('does not observe when keepInView is off', () => {
    callbacks = []
    const container = document.createElement('div')
    document.body.append(container)
    new MapKitCalloutHostLayer<{ id: string }>({
      container,
      keepInView: false,
      projectCoordinate: () => ({ x: 1, y: 1 }),
    }).open({ coordinate: { lat: 0, lng: 0 }, id: 'a', item: { id: 'a' } })
    expect(callbacks).toHaveLength(0)
  })
})
