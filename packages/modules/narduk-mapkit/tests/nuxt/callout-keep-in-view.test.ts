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
