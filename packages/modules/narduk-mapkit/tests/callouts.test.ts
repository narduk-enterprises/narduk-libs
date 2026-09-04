import {
  createMapKitCalloutController,
  layoutMapKitCallout,
  MAPKIT_CALLOUT_ATTRIBUTE,
  MAPKIT_CALLOUT_CARET_ATTRIBUTE,
  MAPKIT_CALLOUT_CONTENT_ATTRIBUTE,
  MAPKIT_CALLOUT_LAYER_ATTRIBUTE,
  MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE,
} from '../src/client/index.js'
import { createFakeFrameScheduler } from './fake-timer.js'

import type {
  MapKitCalloutController,
  MapKitCalloutDocument,
  MapKitCalloutElement,
  MapKitCalloutEvent,
  MapKitCalloutLayoutInput,
  MapKitCalloutMapHandle,
  MapKitCalloutRect,
  MapKitCalloutWindow,
} from '../src/client/index.js'

/**
 * Type-level only: a real `document`, `HTMLElement`, `window`, and a MapKit map
 * must stay assignable to the injected handles. Nothing else in a
 * node-environment suite would catch a structural shape that no longer accepts
 * the real DOM.
 */
const realDocumentIsAccepted: MapKitCalloutDocument = {} as Document
const realElementIsAccepted: MapKitCalloutElement = {} as HTMLElement
const realWindowIsAccepted: MapKitCalloutWindow = {} as Window
void realDocumentIsAccepted
void realElementIsAccepted
void realWindowIsAccepted

// ── Structural DOM fakes ─────────────────────────────────────

interface FakeElement extends MapKitCalloutElement {
  attributes: Record<string, string>
  children: FakeElement[]
  focusCalls: number
  getBoundingClientRect: () => MapKitCalloutRect
  parent: FakeElement | null
  rect: MapKitCalloutRect
  tagName: string
}

const DEFAULT_CALLOUT_SIZE = { height: 80, width: 160 }

function createElement(tagName: string, rect?: Partial<MapKitCalloutRect>): FakeElement {
  const element: FakeElement = {
    appendChild(child: FakeElement): FakeElement {
      child.parent = element
      element.children.push(child)
      return child
    },
    attributes: {},
    children: [],
    contains(node: unknown): boolean {
      if (node === element) return true
      for (const child of element.children) {
        if (child.contains?.(node)) return true
      }
      return false
    },
    focus(): void {
      element.focusCalls += 1
    },
    focusCalls: 0,
    getBoundingClientRect: () => element.rect,
    innerHTML: '',
    parent: null,
    rect: { height: 0, left: 0, top: 0, width: 0, ...rect },
    removeChild(child: FakeElement): FakeElement {
      const index = element.children.indexOf(child)
      if (index >= 0) element.children.splice(index, 1)
      child.parent = null
      return child
    },
    setAttribute(name: string, value: string): void {
      element.attributes[name] = value
    },
    style: {
      height: '',
      left: '',
      pointerEvents: '',
      position: '',
      top: '',
      transform: '',
      visibility: '',
      width: '',
      zIndex: '',
    },
    tagName,
  }
  return element
}

interface FakeDocument extends MapKitCalloutDocument {
  dispatch: (type: string, event?: unknown) => void
  listenerCount: (type?: string) => number
}

function createDocument(
  elementRect: Partial<MapKitCalloutRect> = DEFAULT_CALLOUT_SIZE,
): FakeDocument {
  const listeners = new Map<string, Set<(event: any) => void>>()
  return {
    activeElement: null,
    addEventListener(type: string, listener: (event: any) => void): void {
      const existing = listeners.get(type) ?? new Set()
      existing.add(listener)
      listeners.set(type, existing)
    },
    createElement: (tagName: string) => createElement(tagName, elementRect),
    dispatch(type: string, event: unknown = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    listenerCount(type?: string): number {
      if (type !== undefined) return listeners.get(type)?.size ?? 0
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
    removeEventListener(type: string, listener: (event: any) => void): void {
      listeners.get(type)?.delete(listener)
    },
  }
}

interface FakeMap extends MapKitCalloutMapHandle {
  dispatch: (type: string, event?: unknown) => void
  listenerCount: (type?: string) => number
}

function createMap(): FakeMap {
  const listeners = new Map<string, Set<(event: any) => void>>()
  return {
    addEventListener(type: string, listener: (event: any) => void): void {
      const existing = listeners.get(type) ?? new Set()
      existing.add(listener)
      listeners.set(type, existing)
    },
    dispatch(type: string, event: unknown = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    listenerCount(type?: string): number {
      if (type !== undefined) return listeners.get(type)?.size ?? 0
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
    removeEventListener(type: string, listener: (event: any) => void): void {
      listeners.get(type)?.delete(listener)
    },
  }
}

interface Item {
  id: string
  name: string
}

interface Coordinate {
  lat: number
  lng: number
}

function layerOf(container: FakeElement): FakeElement | null {
  return (
    container.children.find((child) => MAPKIT_CALLOUT_LAYER_ATTRIBUTE in child.attributes) ?? null
  )
}

function frameOf(container: FakeElement, key: string): FakeElement | null {
  return (
    layerOf(container)?.children.find(
      (child) => child.attributes[MAPKIT_CALLOUT_ATTRIBUTE] === key,
    ) ?? null
  )
}

interface Harness {
  container: FakeElement
  controller: MapKitCalloutController<Item, Coordinate>
  document: FakeDocument
  events: Array<MapKitCalloutEvent<Item>>
  frames: ReturnType<typeof createFakeFrameScheduler>
  map: FakeMap
  /** Where the next `projectCoordinate` call lands, in page pixels. */
  projection: { x: number; y: number } | null
  projections: number
  renders: string[]
  cleanups: string[]
}

type ControllerOptions = Partial<
  Parameters<typeof createMapKitCalloutController<Item, Coordinate>>[0]
>

function createHarness(overrides: ControllerOptions = {}): Harness {
  const container = createElement('div', { height: 400, left: 0, top: 0, width: 400 })
  const documentFake = createDocument()
  const frames = createFakeFrameScheduler()
  const map = createMap()

  const harness: Harness = {
    cleanups: [],
    container,
    controller: null as unknown as MapKitCalloutController<Item, Coordinate>,
    document: documentFake,
    events: [],
    frames,
    map,
    projection: { x: 200, y: 200 },
    projections: 0,
    renders: [],
  }

  harness.controller = createMapKitCalloutController<Item, Coordinate>({
    container,
    document: documentFake,
    frame: frames,
    map,
    projectCoordinate: () => {
      harness.projections += 1
      return harness.projection
    },
    render: (context, host) => {
      harness.renders.push(`${context.key}:${context.item.name}`)
      host.innerHTML = context.item.name
      return () => harness.cleanups.push(context.key)
    },
    window: { scrollX: 0, scrollY: 0 },
    ...overrides,
  })
  harness.controller.subscribe((event) => harness.events.push(event))
  return harness
}

function descriptor(
  id: string,
  name = id,
): {
  coordinate: Coordinate
  item: Item
  key: string
} {
  return { coordinate: { lat: 1, lng: 2 }, item: { id, name }, key: id }
}

// ── Positioning math ─────────────────────────────────────────

describe('layoutMapKitCallout', () => {
  function input(overrides: Partial<MapKitCalloutLayoutInput> = {}): MapKitCalloutLayoutInput {
    return {
      anchor: { x: 200, y: 200 },
      bounds: { height: 400, width: 400 },
      caretSize: 10,
      edgePadding: 8,
      flip: true,
      gap: 12,
      placement: 'above',
      size: { height: 60, width: 100 },
      ...overrides,
    }
  }

  it('places an unconstrained callout centred above its anchor', () => {
    const layout = layoutMapKitCallout(input())

    expect(layout).toMatchObject({
      clamped: false,
      flipped: false,
      placement: 'above',
      shifted: false,
      visible: true,
      x: 150,
      y: 128,
    })
    // Caret on the bottom edge of the box, horizontally over the anchor.
    expect(layout.caret).toEqual({ x: 50, y: 60 })
  })

  it('flips above to below when the anchor is near the top edge', () => {
    const layout = layoutMapKitCallout(input({ anchor: { x: 200, y: 20 } }))

    expect(layout.flipped).toBe(true)
    expect(layout.placement).toBe('below')
    expect(layout.y).toBe(32)
    // Caret moves to the top edge, so it still points back at the anchor.
    expect(layout.caret).toEqual({ x: 50, y: 0 })
  })

  it('flips below to above when the anchor is near the bottom edge', () => {
    const layout = layoutMapKitCallout(input({ anchor: { x: 200, y: 380 }, placement: 'below' }))

    expect(layout.flipped).toBe(true)
    expect(layout.placement).toBe('above')
    expect(layout.y).toBe(308)
    expect(layout.caret).toEqual({ x: 50, y: 60 })
  })

  it('shifts right off the left edge and slides the caret to compensate', () => {
    const layout = layoutMapKitCallout(input({ anchor: { x: 10, y: 200 } }))

    expect(layout).toMatchObject({ flipped: false, shifted: true, x: 8 })
    // Clamped to `caretSize` so the caret never straddles a rounded corner.
    expect(layout.caret.x).toBe(10)
  })

  it('shifts left off the right edge and slides the caret to compensate', () => {
    const layout = layoutMapKitCallout(input({ anchor: { x: 395, y: 200 } }))

    expect(layout).toMatchObject({ flipped: false, shifted: true, x: 292 })
    expect(layout.caret.x).toBe(90)
  })

  it('keeps the preferred side when flipping is switched off', () => {
    const layout = layoutMapKitCallout(input({ anchor: { x: 200, y: 20 }, flip: false }))

    expect(layout.flipped).toBe(false)
    expect(layout.placement).toBe('above')
    // Still clamped inside the container rather than allowed to overflow it.
    expect(layout).toMatchObject({ clamped: true, y: 8 })
  })

  it('flips a horizontal placement across the anchor and shifts vertically', () => {
    const layout = layoutMapKitCallout(
      input({ anchor: { x: 20, y: 395 }, placement: 'left', size: { height: 60, width: 100 } }),
    )

    expect(layout).toMatchObject({ flipped: true, placement: 'right', shifted: true, x: 32 })
    expect(layout.y).toBe(332)
    // Caret on the left edge of the box, vertically over the anchor.
    expect(layout.caret.x).toBe(0)
    expect(layout.caret.y).toBe(50)
  })

  it('pins a callout larger than its container instead of overflowing it', () => {
    const layout = layoutMapKitCallout(input({ size: { height: 500, width: 600 } }))

    expect(layout).toMatchObject({ clamped: true, shifted: true, x: 8, y: 8 })
  })

  it('reports an anchor outside the container as not visible', () => {
    expect(layoutMapKitCallout(input({ anchor: { x: -1, y: 200 } })).visible).toBe(false)
    expect(layoutMapKitCallout(input({ anchor: { x: 200, y: 401 } })).visible).toBe(false)
    expect(layoutMapKitCallout(input({ anchor: { x: 0, y: 400 } })).visible).toBe(true)
  })
})

// ── Render and cleanup lifecycle ─────────────────────────────

describe('MapKitCalloutController content lifecycle', () => {
  it('creates one layer, mounts content into the host, and positions on the frame', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a', 'Alpha'))

    const layer = layerOf(harness.container)
    const frame = frameOf(harness.container, 'a')
    expect(layer?.style.pointerEvents).toBe('none')
    expect(frame).not.toBeNull()
    expect(frame?.style.visibility).toBe('hidden')
    expect(harness.renders).toEqual(['a:Alpha'])

    const host = harness.controller.hostFor('a')
    expect(host?.innerHTML).toBe('Alpha')
    expect((host as FakeElement).attributes).toHaveProperty(MAPKIT_CALLOUT_CONTENT_ATTRIBUTE)
    expect(
      frame?.children.some((child) => MAPKIT_CALLOUT_CARET_ATTRIBUTE in child.attributes),
    ).toBe(true)

    harness.frames.runFrame()

    expect(frame?.style.visibility).toBe('visible')
    expect(frame?.style.transform).toBe('translate(120px, 108px)')
    expect(frame?.attributes[MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE]).toBe('above')
    expect(harness.controller.layoutFor('a')).toMatchObject({ placement: 'above', visible: true })
  })

  it('runs the render cleanup exactly once, when the callout closes', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    expect(harness.cleanups).toEqual([])

    harness.controller.close('a')

    expect(harness.cleanups).toEqual(['a'])
    expect(frameOf(harness.container, 'a')).toBeNull()
    expect(harness.controller.hostFor('a')).toBeNull()

    harness.controller.close('a')
    expect(harness.cleanups).toEqual(['a'])
  })

  it('tears the content down and rebuilds it when re-opened without an update hook', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a', 'Alpha'))
    harness.controller.open(descriptor('a', 'Alpha 2'))

    expect(harness.cleanups).toEqual(['a'])
    expect(harness.renders).toEqual(['a:Alpha', 'a:Alpha 2'])
    expect(harness.controller.hostFor('a')?.innerHTML).toBe('Alpha 2')
    expect(harness.events.map((event) => event.phase)).toEqual(['open', 'update'])
  })

  it('updates in place, keeping the mounted content and its cleanup, when opted in', () => {
    const updates: string[] = []
    const harness = createHarness({
      update: (context, host) => {
        updates.push(`${context.key}:${context.item.name}`)
        host.innerHTML = context.item.name
      },
    })
    const hostBefore =
      (harness.controller.open(descriptor('a', 'Alpha')), harness.controller.hostFor('a'))

    harness.controller.open(descriptor('a', 'Alpha 2'))

    expect(updates).toEqual(['a:Alpha 2'])
    expect(harness.renders).toEqual(['a:Alpha'])
    expect(harness.cleanups).toEqual([])
    // Same host element: a framework subtree mounted into it survives.
    expect(harness.controller.hostFor('a')).toBe(hostBefore)
    expect(harness.controller.hostFor('a')?.innerHTML).toBe('Alpha 2')

    harness.controller.close('a')
    expect(harness.cleanups).toEqual(['a'])
  })

  it('repositions after an update, because the coordinate may have moved', () => {
    const harness = createHarness({ update: () => {} })
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()
    expect(frameOf(harness.container, 'a')?.style.transform).toBe('translate(120px, 108px)')

    harness.projection = { x: 100, y: 300 }
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    expect(frameOf(harness.container, 'a')?.style.transform).toBe('translate(20px, 208px)')
  })

  it('rejects a blank key', () => {
    const harness = createHarness()
    expect(() => harness.controller.open({ ...descriptor('a'), key: '  ' })).toThrow(
      'callout key is required',
    )
  })
})

// ── Single and multi mode ────────────────────────────────────

describe('MapKitCalloutController open modes', () => {
  it('replaces the open callout in single mode', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))

    expect(harness.controller.openKeys).toEqual(['b'])
    expect(harness.cleanups).toEqual(['a'])
    expect(harness.events.map((event) => `${event.key}:${event.phase}:${event.reason}`)).toEqual([
      'a:open:open',
      'a:close:replaced',
      'b:open:open',
    ])
  })

  it('keeps every callout open in multi mode', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))
    harness.controller.open(descriptor('c'))

    expect(harness.controller.openKeys).toEqual(['a', 'b', 'c'])
    expect(harness.controller.size).toBe(3)
    expect(harness.cleanups).toEqual([])
    expect(layerOf(harness.container)?.children).toHaveLength(3)
  })

  it('toggles an open key closed and a closed key open', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.toggle(descriptor('a'))
    expect(harness.controller.isOpen('a')).toBe(true)
    expect(harness.events.at(-1)?.reason).toBe('toggle')

    harness.controller.toggle(descriptor('a'))
    expect(harness.controller.isOpen('a')).toBe(false)
    expect(harness.events.at(-1)).toMatchObject({ phase: 'close', reason: 'api' })
  })

  it('closes every callout oldest first', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))
    harness.controller.closeAll()

    expect(harness.cleanups).toEqual(['a', 'b'])
    expect(harness.controller.size).toBe(0)
  })
})

// ── Dismissal options ────────────────────────────────────────

describe('MapKitCalloutController dismissal', () => {
  it('closes on Escape by default and attaches the key listener only while open', () => {
    const harness = createHarness()
    expect(harness.document.listenerCount('keydown')).toBe(0)

    harness.controller.open(descriptor('a'))
    expect(harness.document.listenerCount('keydown')).toBe(1)

    harness.document.dispatch('keydown', { key: 'Escape' })

    expect(harness.controller.size).toBe(0)
    expect(harness.events.at(-1)).toMatchObject({ phase: 'close', reason: 'escape' })
    expect(harness.document.listenerCount('keydown')).toBe(0)
  })

  it('ignores Escape when the option is off', () => {
    const harness = createHarness({ closeOnEscape: false })
    harness.controller.open(descriptor('a'))
    harness.document.dispatch('keydown', { key: 'Escape' })

    expect(harness.controller.size).toBe(1)
  })

  it('closes on a map click outside the callout, but not inside it', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    // A flush must land first; before it, the click being handled is still the
    // one that opened the callout.
    harness.frames.runFrame()

    const host = harness.controller.hostFor('a')
    harness.document.dispatch('click', { target: host })
    expect(harness.controller.size).toBe(1)

    harness.document.dispatch('click', { target: harness.container })

    expect(harness.controller.size).toBe(0)
    expect(harness.events.at(-1)).toMatchObject({ reason: 'map-click' })
  })

  it('never dismisses on the click that opened the callout', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))

    harness.document.dispatch('click', { target: harness.container })

    expect(harness.controller.size).toBe(1)
  })

  it('ignores a click outside the map container entirely', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    harness.document.dispatch('click', { target: createElement('div') })

    expect(harness.controller.size).toBe(1)
  })

  it('closes every callout on a deselect without an annotation mapping', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))

    harness.map.dispatch('deselect', { annotation: {} })

    expect(harness.controller.size).toBe(0)
    expect(harness.events.at(-1)?.reason).toBe('deselect')
  })

  it('closes only the deselected annotation when a key mapping is supplied', () => {
    const harness = createHarness({
      keyForAnnotation: (annotation) => (annotation as { key?: string })?.key ?? null,
      mode: 'multi',
    })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))

    harness.map.dispatch('deselect', { annotation: { key: 'a' } })

    expect(harness.controller.openKeys).toEqual(['b'])
  })

  it('does not subscribe to deselect when the option is off', () => {
    const harness = createHarness({ closeOnDeselect: false })
    expect(harness.map.listenerCount('deselect')).toBe(0)

    harness.controller.open(descriptor('a'))
    harness.map.dispatch('deselect', { annotation: {} })

    expect(harness.controller.size).toBe(1)
  })

  it('follows a pan by default and dismisses on one only when asked', () => {
    const following = createHarness()
    following.controller.open(descriptor('a'))
    following.map.dispatch('region-change-start')
    expect(following.controller.size).toBe(1)
    expect(following.controller.following).toBe(true)

    const dismissing = createHarness({ closeOnPan: true })
    dismissing.controller.open(descriptor('a'))
    dismissing.map.dispatch('region-change-start')

    expect(dismissing.controller.size).toBe(0)
    expect(dismissing.events.at(-1)?.reason).toBe('pan')
    expect(dismissing.controller.following).toBe(false)
  })
})

// ── Region following ─────────────────────────────────────────

describe('MapKitCalloutController region following', () => {
  it('drives every open callout from one frame loop, not one per callout', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))
    harness.controller.open(descriptor('c'))

    // Three opens, one pending frame.
    expect(harness.frames.pending()).toBe(1)
    harness.frames.runFrame()
    expect(harness.projections).toBe(3)
    expect(harness.frames.pending()).toBe(0)

    harness.map.dispatch('region-change-start')
    expect(harness.frames.pending()).toBe(1)

    harness.frames.runFrame()
    expect(harness.projections).toBe(6)
    // The loop re-arms itself for as long as the camera is moving.
    expect(harness.frames.pending()).toBe(1)

    harness.frames.runFrame()
    expect(harness.projections).toBe(9)
    expect(harness.frames.pending()).toBe(1)
  })

  it('stops the loop after one final reposition when the camera settles', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    harness.map.dispatch('region-change-start')
    harness.frames.runFrame()
    expect(harness.controller.following).toBe(true)

    harness.map.dispatch('region-change-end')
    expect(harness.controller.following).toBe(false)

    const before = harness.projections
    harness.frames.runFrame()
    expect(harness.projections).toBe(before + 1)
    expect(harness.frames.pending()).toBe(0)
  })

  it('coalesces many reposition requests into a single flush', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    const before = harness.projections
    harness.controller.reposition()
    harness.controller.reposition()
    harness.controller.reposition()
    expect(harness.frames.pending()).toBe(1)

    harness.frames.runFrame()

    expect(harness.projections).toBe(before + 1)
  })

  it('moves the callout with the camera and skips a write when nothing moved', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()
    const frame = frameOf(harness.container, 'a')!
    expect(frame.style.transform).toBe('translate(120px, 108px)')

    harness.projection = { x: 260, y: 240 }
    harness.controller.repositionNow()
    expect(frame.style.transform).toBe('translate(180px, 148px)')

    frame.style.transform = 'sentinel'
    harness.controller.repositionNow()
    expect(frame.style.transform).toBe('sentinel')
  })

  it('subtracts the container origin and the page scroll from a page-space projection', () => {
    const harness = createHarness({ window: { scrollX: 1000, scrollY: 2000 } })
    harness.container.rect = { height: 400, left: 40, top: 60, width: 400 }
    harness.projection = { x: 1240, y: 2260 }

    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    // Anchor lands at (200, 200) in container space: centred, 12px above.
    expect(frameOf(harness.container, 'a')?.style.transform).toBe('translate(120px, 108px)')
  })

  it('takes a container-space projection verbatim when told to', () => {
    const harness = createHarness({ coordinateSpace: 'container' })
    harness.container.rect = { height: 400, left: 40, top: 60, width: 400 }
    harness.projection = { x: 200, y: 200 }

    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    expect(frameOf(harness.container, 'a')?.style.transform).toBe('translate(120px, 108px)')
  })

  it('applies an anchor offset, so a callout can clear the pin it belongs to', () => {
    const harness = createHarness()
    harness.controller.open({ ...descriptor('a'), anchorOffset: { x: 0, y: -24 } })
    harness.frames.runFrame()

    expect(frameOf(harness.container, 'a')?.style.transform).toBe('translate(120px, 84px)')
  })

  it('hides rather than closes a callout whose anchor leaves the container', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    harness.projection = { x: 900, y: 200 }
    harness.controller.repositionNow()

    const frame = frameOf(harness.container, 'a')
    expect(frame?.style.visibility).toBe('hidden')
    expect(frame?.style.pointerEvents).toBe('none')
    expect(harness.controller.isOpen('a')).toBe(true)

    harness.projection = { x: 200, y: 200 }
    harness.controller.repositionNow()
    expect(frame?.style.visibility).toBe('visible')
  })

  it('hides a callout whose coordinate cannot be projected at all', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.frames.runFrame()

    harness.projection = null
    harness.controller.repositionNow()

    expect(frameOf(harness.container, 'a')?.style.visibility).toBe('hidden')
    expect(harness.controller.layoutFor('a')).toBeNull()
  })
})

// ── Focus and accessibility ──────────────────────────────────

describe('MapKitCalloutController accessibility', () => {
  it('labels the frame and leaves focus alone by default', () => {
    const harness = createHarness({ ariaLabel: 'Station detail' })
    harness.controller.open(descriptor('a'))

    const frame = frameOf(harness.container, 'a')
    expect(frame?.attributes).toMatchObject({
      'aria-label': 'Station detail',
      role: 'dialog',
      tabindex: '-1',
    })
    expect(frame?.focusCalls).toBe(0)
  })

  it('moves focus into the callout and returns it on close when opted in', () => {
    const previous = createElement('button')
    const harness = createHarness({ focusOnOpen: true })
    harness.document.activeElement = previous

    harness.controller.open(descriptor('a'))
    const frame = frameOf(harness.container, 'a')
    expect(frame?.focusCalls).toBe(1)

    harness.controller.close('a')
    expect(previous.focusCalls).toBe(1)
  })

  it('does not return focus when restoration is switched off', () => {
    const previous = createElement('button')
    const harness = createHarness({ focusOnOpen: true, restoreFocus: false })
    harness.document.activeElement = previous

    harness.controller.open(descriptor('a'))
    harness.controller.close('a')

    expect(previous.focusCalls).toBe(0)
  })

  it('honours a per-callout role and label over the controller defaults', () => {
    const harness = createHarness({ ariaLabel: 'Default', role: 'tooltip' })
    harness.controller.open({ ...descriptor('a'), ariaLabel: 'Specific' })

    expect(frameOf(harness.container, 'a')?.attributes).toMatchObject({
      'aria-label': 'Specific',
      role: 'tooltip',
    })
  })
})

// ── Teardown ─────────────────────────────────────────────────

describe('MapKitCalloutController teardown', () => {
  it('closes open callouts, removes the layer, and detaches every listener', () => {
    const harness = createHarness({ mode: 'multi' })
    harness.controller.open(descriptor('a'))
    harness.controller.open(descriptor('b'))
    harness.frames.runFrame()
    harness.map.dispatch('region-change-start')

    harness.controller.destroy()

    expect(harness.cleanups).toEqual(['a', 'b'])
    expect(harness.events.slice(-2).map((event) => `${event.key}:${event.reason}`)).toEqual([
      'a:destroy',
      'b:destroy',
    ])
    expect(harness.controller.destroyed).toBe(true)
    expect(harness.controller.following).toBe(false)
    expect(layerOf(harness.container)).toBeNull()
    expect(harness.container.children).toHaveLength(0)
    expect(harness.document.listenerCount()).toBe(0)
    expect(harness.map.listenerCount()).toBe(0)
  })

  it('cancels a pending frame so nothing repositions after destruction', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.controller.destroy()

    expect(harness.frames.pending()).toBe(0)
    const before = harness.projections
    harness.frames.runFrame()
    expect(harness.projections).toBe(before)
  })

  it('is idempotent, and refuses to open afterwards', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.controller.destroy()
    harness.controller.destroy()

    expect(harness.cleanups).toEqual(['a'])
    expect(() => harness.controller.open(descriptor('b'))).toThrow(
      'callout controller is destroyed',
    )
  })

  it('drops subscribers so a late close cannot notify a torn-down consumer', () => {
    const harness = createHarness()
    harness.controller.open(descriptor('a'))
    harness.controller.destroy()

    const seen = harness.events.length
    harness.controller.close('a')
    harness.controller.closeAll()

    expect(harness.events).toHaveLength(seen)
  })

  it('creates no layer at all for a controller nobody opens', () => {
    const harness = createHarness()

    expect(harness.container.children).toHaveLength(0)
    expect(harness.document.listenerCount()).toBe(0)

    harness.controller.destroy()
    expect(harness.container.children).toHaveLength(0)
  })

  it('closes this callout from inside its own rendered content', () => {
    let close: (() => void) | null = null
    const harness = createHarness({
      render: (context) => {
        close = context.close
        return
      },
    })
    harness.controller.open(descriptor('a'))

    close!()

    expect(harness.controller.size).toBe(0)
    expect(harness.events.at(-1)).toMatchObject({ phase: 'close', reason: 'api' })
  })
})
