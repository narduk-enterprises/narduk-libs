import { attachMapKitPointerProbe } from '../src/client/index.js'
import { createFakeTimer } from './fake-timer.js'

import type {
  MapKitProbeElement,
  MapKitProbeEvent,
  MapKitProbePointerEventLike,
  MapKitProbePointerSample,
} from '../src/client/index.js'
import type { MapKitPoint } from '../src/types.js'

interface FakeElement extends MapKitProbeElement {
  captured: number[]
  dispatch: (type: string, event: MapKitProbePointerEventLike) => void
  listenerCount: () => number
}

function createElement(rect: { left: number; top: number } = { left: 0, top: 0 }): FakeElement {
  const listeners = new Map<string, Set<(event: MapKitProbePointerEventLike) => void>>()
  const captured: number[] = []

  return {
    addEventListener(type: string, listener: (event: MapKitProbePointerEventLike) => void): void {
      const existing = listeners.get(type) ?? new Set()
      existing.add(listener)
      listeners.set(type, existing)
    },
    captured,
    dispatch(type: string, event: MapKitProbePointerEventLike): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    getBoundingClientRect: () => rect,
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    releasePointerCapture(pointerId: number): void {
      const index = captured.indexOf(pointerId)
      if (index >= 0) captured.splice(index, 1)
    },
    removeEventListener(
      type: string,
      listener: (event: MapKitProbePointerEventLike) => void,
    ): void {
      listeners.get(type)?.delete(listener)
    },
    setPointerCapture(pointerId: number): void {
      captured.push(pointerId)
    },
  }
}

function pointerEvent(
  x: number,
  y: number,
  overrides: Partial<MapKitProbePointerEventLike> = {},
): MapKitProbePointerEventLike {
  return { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...overrides }
}

/** Element-relative point → the identity coordinate, so assertions stay legible. */
function identityCoordinate(sample: MapKitProbePointerSample): MapKitPoint {
  return { lat: sample.point.y, lng: sample.point.x }
}

function setup(
  options: Partial<Parameters<typeof attachMapKitPointerProbe<MapKitPoint>>[0]> = {},
  rect: { left: number; top: number } = { left: 0, top: 0 },
) {
  const element = createElement(rect)
  const events: Array<MapKitProbeEvent<MapKitPoint>> = []
  const timer = createFakeTimer()
  const probe = attachMapKitPointerProbe<MapKitPoint>({
    coordinateForPoint: identityCoordinate,
    element,
    onEvent: (event) => events.push(event),
    timer,
    ...options,
  })
  return { element, events, probe, timer }
}

function phases(events: ReadonlyArray<MapKitProbeEvent<MapKitPoint>>): string[] {
  return events.map((event) => `${event.mode}:${event.phase}`)
}

describe('MapKitPointerProbe hover', () => {
  it('emits a leading hover sample and throttles the rest', () => {
    const { element, events, timer } = setup()

    element.dispatch('pointermove', pointerEvent(10, 10))
    expect(phases(events)).toEqual(['hover:begin'])
    expect(events[0]?.coordinate).toEqual({ lat: 10, lng: 10 })

    timer.advance(10)
    element.dispatch('pointermove', pointerEvent(20, 20))
    timer.advance(10)
    element.dispatch('pointermove', pointerEvent(30, 30))
    expect(phases(events)).toEqual(['hover:begin'])

    // Trailing edge lands one throttle window after the leading sample and
    // carries the newest position, not the one that was dropped.
    timer.advance(70)
    expect(phases(events)).toEqual(['hover:begin', 'hover:move'])
    expect(events[1]?.point).toEqual({ x: 30, y: 30 })
  })

  it('honors a custom throttle interval', () => {
    const { element, events, timer } = setup({ hoverThrottleMs: 200 })

    element.dispatch('pointermove', pointerEvent(1, 1))
    timer.advance(100)
    element.dispatch('pointermove', pointerEvent(2, 2))
    expect(events).toHaveLength(1)

    timer.advance(99)
    expect(events).toHaveLength(1)
    timer.advance(1)
    expect(events).toHaveLength(2)
  })

  it('subtracts the element origin from client coordinates', () => {
    const { element, events } = setup({}, { left: 40, top: 25 })

    element.dispatch('pointermove', pointerEvent(140, 125))

    expect(events[0]?.point).toEqual({ x: 100, y: 100 })
    expect(events[0]?.pointer.client).toEqual({ x: 140, y: 125 })
  })

  it('ends hover when the pointer leaves', () => {
    const { element, events } = setup()

    element.dispatch('pointermove', pointerEvent(10, 10))
    element.dispatch('pointerleave', pointerEvent(10, 10))

    expect(phases(events)).toEqual(['hover:begin', 'hover:end'])
    expect(events[1]?.coordinate).toBeNull()
  })

  it('never hovers for touch pointers', () => {
    const { element, events } = setup()

    element.dispatch('pointermove', pointerEvent(10, 10, { pointerType: 'touch' }))

    expect(events).toHaveLength(0)
  })

  it('suppresses hover while a pin is placed', () => {
    const { element, events } = setup()

    element.dispatch('pointerdown', pointerEvent(50, 50))
    element.dispatch('pointerup', pointerEvent(50, 50))
    expect(phases(events)).toEqual(['pinned:begin'])

    element.dispatch('pointermove', pointerEvent(60, 60))
    expect(phases(events)).toEqual(['pinned:begin'])
  })
})

describe('MapKitPointerProbe pinning', () => {
  it('pins on a mouse click', () => {
    const { element, events, probe } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40))
    element.dispatch('pointerup', pointerEvent(30, 40))

    expect(phases(events)).toEqual(['pinned:begin'])
    expect(events[0]?.source).toBe('click')
    expect(probe.mode).toBe('pinned')
    expect(probe.pin).toEqual({ coordinate: { lat: 40, lng: 30 }, point: { x: 30, y: 40 } })
  })

  it('pins on a touch tap that stays inside the slop radius', () => {
    const { element, events, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch' }))
    timer.advance(120)
    element.dispatch('pointerup', pointerEvent(33, 42, { pointerType: 'touch' }))

    expect(phases(events)).toEqual(['pinned:begin'])
    expect(events[0]?.source).toBe('tap')
  })

  it('treats a press dragged past the slop radius as a pan, not a pin', () => {
    const { element, events, probe, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch' }))
    timer.advance(80)
    element.dispatch('pointermove', pointerEvent(70, 40, { pointerType: 'touch' }))
    timer.advance(80)
    element.dispatch('pointerup', pointerEvent(90, 40, { pointerType: 'touch' }))

    expect(phases(events)).toEqual(['hover:cancel'])
    expect(events[0]?.source).toBe('pan')
    expect(probe.pin).toBeNull()
  })

  it('ignores a press held past the tap window with no long-press eligibility', () => {
    const { element, events, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40))
    timer.advance(800)
    element.dispatch('pointerup', pointerEvent(30, 40))

    expect(events).toHaveLength(0)
  })

  it('pins on long press and keeps the pin when the finger lifts', () => {
    const { element, events, probe, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch' }))
    timer.advance(499)
    expect(events).toHaveLength(0)

    timer.advance(1)
    expect(phases(events)).toEqual(['pinned:begin'])
    expect(events[0]?.source).toBe('long-press')

    element.dispatch('pointerup', pointerEvent(30, 40, { pointerType: 'touch' }))
    expect(phases(events)).toEqual(['pinned:begin', 'pinned:end'])
    expect(probe.pin?.coordinate).toEqual({ lat: 40, lng: 30 })
  })

  it('cancels a long press when the finger moves first', () => {
    const { element, events, probe, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch' }))
    timer.advance(200)
    element.dispatch('pointermove', pointerEvent(30, 90, { pointerType: 'touch' }))
    timer.advance(1_000)

    expect(phases(events)).toEqual(['hover:cancel'])
    expect(probe.pin).toBeNull()
  })

  it('respects custom long-press and slop thresholds', () => {
    const { element, events, timer } = setup({ longPressDurationMs: 250, moveSlopPx: 20 })

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch' }))
    timer.advance(100)
    // Inside the widened slop radius, so the long press survives the move.
    element.dispatch('pointermove', pointerEvent(45, 40, { pointerType: 'touch' }))
    timer.advance(150)

    expect(phases(events)).toEqual(['pinned:begin'])
  })

  it('abandons the gesture when a second pointer joins', () => {
    const { element, events, probe, timer } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { pointerType: 'touch', pointerId: 1 }))
    element.dispatch('pointerdown', pointerEvent(80, 40, { pointerType: 'touch', pointerId: 2 }))
    timer.advance(1_000)
    element.dispatch('pointerup', pointerEvent(30, 40, { pointerType: 'touch', pointerId: 1 }))

    expect(phases(events)).toEqual(['hover:cancel'])
    expect(probe.pin).toBeNull()
  })

  it('does not pin from a secondary mouse button', () => {
    const { element, events } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40, { button: 2 }))
    element.dispatch('pointerup', pointerEvent(30, 40, { button: 2 }))

    expect(events).toHaveLength(0)
  })

  it('refuses a pin when the point cannot be converted', () => {
    const { element, events, probe } = setup({ coordinateForPoint: () => null })

    element.dispatch('pointerdown', pointerEvent(30, 40))
    element.dispatch('pointerup', pointerEvent(30, 40))

    expect(phases(events)).toEqual(['pinned:cancel'])
    expect(probe.pin).toBeNull()
  })
})

describe('MapKitPointerProbe pin drag and dismiss', () => {
  it('repositions the pin by dragging its handle', () => {
    const pinHandle = { id: 'pin' }
    const { element, events, probe, timer } = setup({
      isPinHandle: (target) => target === pinHandle,
    })

    element.dispatch('pointerdown', pointerEvent(30, 40))
    element.dispatch('pointerup', pointerEvent(30, 40))
    expect(probe.pin?.point).toEqual({ x: 30, y: 40 })

    element.dispatch('pointerdown', pointerEvent(30, 40, { target: pinHandle }))
    element.dispatch('pointermove', pointerEvent(31, 41, { target: pinHandle }))
    expect(phases(events)).toEqual(['pinned:begin'])

    timer.advance(100)
    element.dispatch('pointermove', pointerEvent(120, 200, { target: pinHandle }))
    expect(phases(events)).toEqual(['pinned:begin', 'pinned:move'])

    element.dispatch('pointerup', pointerEvent(120, 200, { target: pinHandle }))
    expect(phases(events)).toEqual(['pinned:begin', 'pinned:move', 'pinned:end'])
    expect(probe.pin).toEqual({ coordinate: { lat: 200, lng: 120 }, point: { x: 120, y: 200 } })
  })

  it('drags a pin through beginPinDrag for app-owned pin markup', () => {
    const { element, events, probe, timer } = setup()

    probe.pinAtPoint({ x: 10, y: 10 })
    probe.beginPinDrag(pointerEvent(10, 10))
    timer.advance(100)
    element.dispatch('pointermove', pointerEvent(60, 60))
    element.dispatch('pointerup', pointerEvent(60, 60))

    expect(phases(events)).toEqual(['pinned:begin', 'pinned:move', 'pinned:end'])
    expect(probe.pin?.point).toEqual({ x: 60, y: 60 })
  })

  it('dismisses the pin and returns to hover mode', () => {
    const { element, events, probe } = setup()

    element.dispatch('pointerdown', pointerEvent(30, 40))
    element.dispatch('pointerup', pointerEvent(30, 40))
    probe.dismiss()

    expect(phases(events)).toEqual(['pinned:begin', 'pinned:dismiss'])
    expect(events[1]?.coordinate).toEqual({ lat: 40, lng: 30 })
    expect(probe.pin).toBeNull()
    expect(probe.mode).toBe('hover')

    element.dispatch('pointermove', pointerEvent(70, 70))
    expect(phases(events)).toEqual(['pinned:begin', 'pinned:dismiss', 'hover:begin'])
  })

  it('is a no-op to dismiss with nothing pinned', () => {
    const { events, probe } = setup()
    probe.dismiss()
    expect(events).toHaveLength(0)
  })
})

describe('MapKitPointerProbe lifecycle', () => {
  it('goes inert while disabled', () => {
    const { element, events, probe } = setup()

    probe.setEnabled(false)
    element.dispatch('pointermove', pointerEvent(10, 10))
    element.dispatch('pointerdown', pointerEvent(10, 10))
    element.dispatch('pointerup', pointerEvent(10, 10))
    expect(events).toHaveLength(0)

    probe.setEnabled(true)
    element.dispatch('pointermove', pointerEvent(10, 10))
    expect(phases(events)).toEqual(['hover:begin'])
  })

  it('detaches every listener on destroy', () => {
    const { element, events, probe } = setup()

    expect(element.listenerCount()).toBe(5)
    probe.destroy()

    expect(element.listenerCount()).toBe(0)
    element.dispatch('pointermove', pointerEvent(10, 10))
    expect(events).toHaveLength(0)
    expect(probe.destroyed).toBe(true)
  })

  it('captures and releases the pointer for the active gesture', () => {
    const { element, probe } = setup()

    element.dispatch('pointerdown', pointerEvent(10, 10, { pointerId: 7 }))
    expect(element.captured).toEqual([7])

    element.dispatch('pointerup', pointerEvent(10, 10, { pointerId: 7 }))
    expect(element.captured).toEqual([])
    expect(probe.pin).not.toBeNull()
  })

  it('accepts a real HTMLElement structurally', () => {
    const asProbeElement = (element: HTMLElement): MapKitProbeElement => element
    expect(typeof asProbeElement).toBe('function')
  })
})
