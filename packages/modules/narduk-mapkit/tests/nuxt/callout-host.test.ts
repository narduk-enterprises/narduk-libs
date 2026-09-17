/**
 * @vitest-environment happy-dom
 *
 * The `#callout` seam's host layer (§c.4).
 *
 * MapKit's own callout can only contain DOM the app hands it as an element, so
 * a `NuxtLink` inside one never routes -- the buoys#112 symptom. 2.1.0 renders
 * the app's own Vue tree into a host the library positions, and this is the
 * positioning half, with no Vue in it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MapKitCalloutHostLayer } from '../../src/nuxt/runtime/callout-host.js'

import type { MapKitCalloutPoint } from '../../src/nuxt/runtime/callout-host.js'

interface Station {
  id: string
}

function harness(
  project: (
    coordinate: { lat: number; lng: number },
    id: string,
  ) => MapKitCalloutPoint | null = () => ({
    x: 120,
    y: 240,
  }),
) {
  const container = document.createElement('div')
  document.body.append(container)
  const changes: number[] = []
  const layer = new MapKitCalloutHostLayer<Station>({
    container,
    onChange: (entries) => changes.push(entries.length),
    projectCoordinate: project,
  })
  return { changes, container, layer }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('MapKitCalloutHostLayer (§c.4)', () => {
  it('places a host inside the container at the projected point', () => {
    const { container, layer } = harness()

    const entry = layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })

    expect(entry?.position).toStrictEqual({ x: 120, y: 240 })
    const host = container.querySelector('[data-mapkit-callout="a"]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.left).toBe('120px')
    expect(host.style.top).toBe('240px')
    expect(host.getAttribute('data-mapkit-callout-placement')).toBe('above')
    expect(host.style.transform).toBe('translate(-50%, -100%)')
  })

  it('adds the pin anchor offset, so the callout sits on the pin and not the coordinate', () => {
    const { layer } = harness()

    const entry = layer.open({
      anchorOffset: { x: 0, y: -150 },
      coordinate: { lat: 30, lng: -88 },
      id: 'a',
      item: { id: 'a' },
    })

    expect(entry?.position).toStrictEqual({ x: 120, y: 90 })
  })

  it('reuses the host on re-open, so the teleported subtree is updated not rebuilt', () => {
    const { layer } = harness()
    const first = layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })

    const second = layer.open({ coordinate: { lat: 31, lng: -88 }, id: 'a', item: { id: 'a' } })

    expect(second?.host).toBe(first?.host)
    expect(layer.openIds).toStrictEqual(['a'])
  })

  it('hides a host it cannot project rather than stranding a stale position', () => {
    let projected: MapKitCalloutPoint | null = { x: 10, y: 20 }
    const { layer } = harness(() => projected)
    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })
    const host = layer.entries()[0]?.host

    projected = null
    layer.reposition()

    expect(host?.hidden).toBe(true)
  })

  it('re-projects every open callout on reposition', () => {
    let x = 10
    const { layer } = harness(() => ({ x, y: 20 }))
    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })

    x = 400
    layer.reposition()

    expect(layer.entries()[0]?.position).toStrictEqual({ x: 400, y: 20 })
  })

  it('removes the host on close and reports the live list on every change', () => {
    const { changes, container, layer } = harness()
    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })
    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'b', item: { id: 'b' } })

    expect(layer.close('a')).toBe(true)
    expect(layer.close('a')).toBe(false)

    expect(container.querySelector('[data-mapkit-callout="a"]')).toBeNull()
    expect(changes).toStrictEqual([1, 2, 1])
  })

  it('is inert after destroy', () => {
    const { container, layer } = harness()
    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })

    layer.destroy()

    expect(layer.openIds).toStrictEqual([])
    expect(container.children).toHaveLength(0)
    expect(layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'a', item: { id: 'a' } })).toBeNull()
  })

  it('asks for the projection by id, so a map that cannot project falls back to the pin', () => {
    const project = vi.fn(() => ({ x: 1, y: 2 }))
    const { layer } = harness(project)

    layer.open({ coordinate: { lat: 30, lng: -88 }, id: 'buoy-7', item: { id: 'buoy-7' } })

    expect(project).toHaveBeenCalledWith({ lat: 30, lng: -88 }, 'buoy-7')
  })
})
