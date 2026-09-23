/**
 * @vitest-environment happy-dom
 *
 * The keyed annotation seam (narduk-libs#422 §c.2), driven against the
 * deterministic fake rather than a spy.
 *
 * Every budget below is a call count the fake observed, because the buoys#112
 * defect was invisible to a test that only asserted the pins ended up correct:
 * 2.0.x DID end up correct, after removing all N and adding all N back on every
 * selection change, which is what destroyed the DOM node the user had tapped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MapKitPinLayer, defaultMapKitItemKey } from '../../src/nuxt/runtime/pin-layer.js'
import { createFakeMapKit } from '../../src/testing/index.js'

import type { MapKitMapLike, MapKitNamespaceLike } from '../../src/nuxt/runtime/mapkit-surface.js'
import type { FakeMapKitHandle } from '../../src/testing/index.js'

interface Station {
  id: string
  label: string
  lat: number
  lng: number
}

interface Harness {
  fake: FakeMapKitHandle
  map: MapKitMapLike
  mapkit: MapKitNamespaceLike
}

let harness: Harness

function station(index: number): Station {
  return {
    id: `station-${String(index)}`,
    label: `Station ${String(index)}`,
    lat: 30 + index * 0.001,
    lng: -88 + index * 0.001,
  }
}

function layerFor(options: Partial<Parameters<typeof makeLayer>[0]> = {}): MapKitPinLayer<Station> {
  return makeLayer({
    itemKey: defaultMapKitItemKey,
    itemLabel: (item: Station) => item.label,
    ...options,
  })
}

function makeLayer(options: {
  createPinElement?: (item: Station, isSelected: boolean) => { element: HTMLElement }
  focusable?: boolean
  itemKey: (item: Station, index: number) => string
  itemLabel?: (item: Station) => string
  onSelect?: (id: string | null, via: 'keyboard' | 'pointer') => void
  pinGeometry?: (item: Station) => { anchor?: 'center'; size?: { height: number; width: number } }
}): MapKitPinLayer<Station> {
  return new MapKitPinLayer<Station>({
    map: harness.map,
    mapkit: harness.mapkit,
    ...options,
  })
}

beforeEach(() => {
  const fake = createFakeMapKit()
  const container = document.createElement('div')
  document.body.append(container)
  const mapkit = fake.mapkit as unknown as MapKitNamespaceLike
  harness = { fake, map: new mapkit.Map(container) as MapKitMapLike, mapkit }
  fake.inspect.reset()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('MapKitPinLayer.setItems (§c.2)', () => {
  it('renders N pins with exactly one addAnnotations call and no removes', () => {
    const layer = layerFor()

    const diff = layer.setItems(Array.from({ length: 600 }, (_, index) => station(index)))

    expect(diff.added).toHaveLength(600)
    expect(harness.fake.inspect.count('addAnnotations')).toBe(1)
    expect(harness.fake.inspect.count('removeAnnotations')).toBe(0)
    expect(harness.fake.inspect.annotationsAdded).toBe(600)
    expect(layer.size).toBe(600)
  })

  it('diffs a 1-in-600 key change instead of rebuilding, keeping 599 identities', () => {
    const layer = layerFor()
    const items = Array.from({ length: 600 }, (_, index) => station(index))
    layer.setItems(items)
    const before = new Map(items.map((item) => [item.id, layer.annotationFor(item.id)]))
    harness.fake.inspect.reset()

    const next = [...items.slice(0, 7), station(9000), ...items.slice(8)]
    const diff = layer.setItems(next)

    expect(diff.added).toStrictEqual(['station-9000'])
    expect(diff.removed).toStrictEqual(['station-7'])
    // The budget the 2.1.0 fake pinned: one add, one remove, not 600 of each.
    expect(harness.fake.inspect.annotationsAdded).toBe(1)
    expect(harness.fake.inspect.annotationsRemoved).toBe(1)
    const survivors = next
      .filter((item) => item.id !== 'station-9000')
      .filter((item) => layer.annotationFor(item.id) === before.get(item.id))
    expect(survivors).toHaveLength(599)
  })

  it('moves a pin in place: no add, no remove, one coordinate write', () => {
    const layer = layerFor()
    const items = [station(1), station(2)]
    layer.setItems(items)
    const annotation = layer.annotationFor('station-1')
    harness.fake.inspect.reset()

    const diff = layer.setItems([{ ...items[0]!, lat: 31.5 }, items[1]!])

    expect(diff).toMatchObject({ added: [], moved: ['station-1'], removed: [] })
    expect(harness.fake.inspect.annotationsAdded).toBe(0)
    expect(harness.fake.inspect.annotationsRemoved).toBe(0)
    expect(layer.annotationFor('station-1')).toBe(annotation)
    expect(annotation?.coordinate.latitude).toBe(31.5)
  })

  it('touches nothing at all when the same item objects come back', () => {
    const layer = layerFor()
    const items = [station(1), station(2)]
    layer.setItems(items)
    harness.fake.inspect.reset()

    const diff = layer.setItems(items)

    expect(diff).toStrictEqual({ added: [], moved: [], removed: [], restyled: [] })
    expect(harness.fake.inspect.operations).toStrictEqual([])
  })
})

describe('MapKitPinLayer.setSelected (buoys#112)', () => {
  it('performs zero adds and zero removes and re-renders exactly two glyphs', () => {
    const rendered: Array<{ id: string; selected: boolean }> = []
    const layer = layerFor({
      createPinElement: (item, isSelected) => {
        rendered.push({ id: item.id, selected: isSelected })
        const element = document.createElement('span')
        element.textContent = isSelected ? '◉' : '○'
        return { element }
      },
    })
    layer.setItems(Array.from({ length: 570 }, (_, index) => station(index)))
    layer.setSelected('station-3')
    harness.fake.inspect.reset()
    rendered.length = 0

    const diff = layer.setSelected('station-4')

    expect(harness.fake.inspect.annotationsAdded).toBe(0)
    expect(harness.fake.inspect.annotationsRemoved).toBe(0)
    expect(rendered).toStrictEqual([
      { id: 'station-3', selected: false },
      { id: 'station-4', selected: true },
    ])
    expect(diff.restyled).toStrictEqual(['station-3', 'station-4'])
  })

  it('keeps the host element, so the focused pin stays focused', () => {
    const layer = layerFor({
      createPinElement: () => ({ element: document.createElement('span') }),
    })
    layer.setItems([station(1), station(2)])
    const host = layer.hostFor('station-1')
    host?.focus()
    expect(document.activeElement).toBe(host)

    layer.setSelected('station-1')
    layer.setSelected('station-2')

    expect(layer.hostFor('station-1')).toBe(host)
    // The 2.0.x rebuild replaced this node, which is why the callout's link
    // could never be pressed on a phone.
    expect(document.activeElement).toBe(host)
  })

  it('marks the selected host with aria-pressed', () => {
    const layer = layerFor()
    layer.setItems([station(1), station(2)])

    layer.setSelected('station-2')

    expect(layer.hostFor('station-2')?.getAttribute('aria-pressed')).toBe('true')
    expect(layer.hostFor('station-1')?.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the budget assertions are load-bearing', () => {
  /**
   * Proof that the counts above would catch the defect: the same fake, driven
   * the way 2.0.x's `rebuildAnnotations()` drove it, records 570 removes and
   * 570 adds for a selection change that moved one pin.
   */
  it('records a full rebuild when the 2.0.x assignment shape is used', () => {
    const layer = layerFor()
    const items = Array.from({ length: 570 }, (_, index) => station(index))
    layer.setItems(items)
    const annotations = items.map((item) => layer.annotationFor(item.id)!)
    harness.fake.inspect.reset()

    // What the adapter did on every selection change.
    ;(harness.map as unknown as { annotations: unknown[] }).annotations = [...annotations]

    expect(harness.fake.inspect.annotationsRemoved).toBe(570)
    expect(harness.fake.inspect.annotationsAdded).toBe(570)
  })
})

describe('the library-owned host (§c.2)', () => {
  it('is a labelled, focusable button the app never has to build', () => {
    const layer = layerFor()
    layer.setItems([station(1)])

    const host = layer.hostFor('station-1')

    expect(host?.getAttribute('role')).toBe('button')
    expect(host?.getAttribute('tabindex')).toBe('0')
    expect(host?.getAttribute('aria-label')).toBe('Station 1')
    expect(host?.getAttribute('data-mapkit-pin')).toBe('station-1')
  })

  it('activates on Enter and on Space, not only on click, and says which', () => {
    const onSelect = vi.fn()
    const layer = layerFor({ onSelect })
    layer.setItems([station(1)])
    const host = layer.hostFor('station-1')!

    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onSelect.mock.calls).toStrictEqual([
      ['station-1', 'keyboard'],
      ['station-1', 'keyboard'],
      ['station-1', 'pointer'],
    ])
  })

  it('toggles the selection off when the selected pin is activated again', () => {
    const onSelect = vi.fn()
    const layer = layerFor({ onSelect })
    layer.setItems([station(1)])
    layer.setSelected('station-1')

    layer.hostFor('station-1')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onSelect).toHaveBeenCalledWith(null, 'pointer')
  })

  it('refuses to render a pin with no accessible name', () => {
    const layer = makeLayer({ itemKey: defaultMapKitItemKey })

    expect(() => layer.setItems([station(1)])).toThrow('itemLabel is required')
  })

  it('refuses BEFORE it touches the registry, so no half-built layer survives', () => {
    // 2.1.0 threw from inside the per-item loop, after the first pins were
    // already on the map, which is why a failure left a partly-rendered map.
    const layer = makeLayer({ itemKey: defaultMapKitItemKey })

    expect(() => layer.setItems([station(1), station(2)])).toThrow('itemLabel is required')
    expect(layer.size).toBe(0)
    expect(harness.fake.inspect.annotationsAdded).toBe(0)
  })
})

describe('a decorative, non-interactive pin layer (K-8)', () => {
  it('builds a host with no role, tabindex, label or listeners', () => {
    const onSelect = vi.fn()
    const layer = makeLayer({ focusable: false, itemKey: defaultMapKitItemKey, onSelect })
    layer.setItems([station(1)])
    const host = layer.hostFor('station-1')!

    // An `aria-hidden` map may not contain focusable descendants (axe
    // `aria-hidden-focus`), and 2.1.0 gave every pin a tabindex unconditionally.
    expect(host.getAttribute('role')).toBeNull()
    expect(host.getAttribute('tabindex')).toBeNull()
    expect(host.getAttribute('aria-label')).toBeNull()
    expect(host.getAttribute('aria-pressed')).toBeNull()
    expect(host.getAttribute('data-mapkit-pin')).toBe('station-1')

    host.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('stops requiring itemLabel, because there is nothing to name', () => {
    const layer = makeLayer({ focusable: false, itemKey: defaultMapKitItemKey })

    expect(() => layer.setItems([station(1)])).not.toThrow()
    expect(layer.size).toBe(1)
  })

  it('leaves aria-pressed off the selected host too', () => {
    const layer = makeLayer({ focusable: false, itemKey: defaultMapKitItemKey })
    layer.setItems([station(1), station(2)])

    layer.setSelected('station-2')

    expect(layer.hostFor('station-2')?.getAttribute('aria-pressed')).toBeNull()
  })
})

describe('per-pin geometry on the map (§c.3)', () => {
  it('anchors a 170x150 card and a 16x16 dot correctly on the same map', () => {
    const layer = layerFor({
      pinGeometry: (item) =>
        item.id === 'station-1'
          ? { size: { height: 150, width: 170 } }
          : { anchor: 'center', size: { height: 16, width: 16 } },
    })

    layer.setItems([station(1), station(2)])

    expect(layer.annotationFor('station-1')?.anchorOffset).toMatchObject({ x: -85, y: -150 })
    expect(layer.annotationFor('station-1')?.size).toMatchObject({ height: 150, width: 170 })
    expect(layer.annotationFor('station-2')?.anchorOffset).toMatchObject({ x: -8, y: -8 })
  })

  it('rewrites the anchor in place when only the geometry changed', () => {
    let height = 150
    const layer = layerFor({ pinGeometry: () => ({ size: { height, width: 170 } }) })
    layer.setItems([station(1)])
    const annotation = layer.annotationFor('station-1')
    harness.fake.inspect.reset()

    height = 200
    const diff = layer.setItems([{ ...station(1) }])

    expect(harness.fake.inspect.annotationsAdded).toBe(0)
    expect(harness.fake.inspect.annotationsRemoved).toBe(0)
    expect(layer.annotationFor('station-1')).toBe(annotation)
    expect(annotation?.anchorOffset).toMatchObject({ x: -85, y: -200 })
    expect(diff.restyled).toStrictEqual(['station-1'])
  })
})

describe('itemKey (§c.1)', () => {
  it('defaults to item.id', () => {
    const layer = layerFor()
    layer.setItems([station(4)])
    expect(layer.keys()).toStrictEqual(['station-4'])
  })

  it('names the item that needs an explicit itemKey rather than silently rebuilding', () => {
    const layer = layerFor()
    expect(() => layer.setItems([{ label: 'x', lat: 1, lng: 2 } as Station])).toThrow(
      'items[0] has no string "id"',
    )
  })

  it('accepts an app-supplied key', () => {
    const layer = layerFor({ itemKey: (item) => `buoy:${item.label}` })
    layer.setItems([station(1)])
    expect(layer.keys()).toStrictEqual(['buoy:Station 1'])
  })

  it('names a duplicate key rather than silently dropping a pin', () => {
    const layer = layerFor()
    expect(() => layer.setItems([station(1), station(1)])).toThrow('duplicate annotation key')
  })
})
