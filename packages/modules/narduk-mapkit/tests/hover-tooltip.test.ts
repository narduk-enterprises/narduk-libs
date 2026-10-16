/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createMapKitHoverTooltip } from '../src/client/hover-tooltip.js'

import { createFakeTimer } from './fake-timer.js'

function pointer(type: string, pointerType: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

function setup(options: { pointerTypes?: readonly string[] } = {}) {
  const timer = createFakeTimer()
  const container = document.createElement('div')
  document.body.append(container)
  const target = document.createElement('button')
  container.append(target)
  const tooltip = createMapKitHoverTooltip({ container, scheduler: timer, ...options })
  let text: string | null = 'Dauphin Island'
  tooltip.attach(target, () => text)
  return {
    container,
    setText: (value: string | null) => {
      text = value
    },
    target,
    timer,
    tooltip,
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('MapKitHoverTooltip', () => {
  it('shows after the delay when a mouse rests on the marker, and links it with aria-describedby', () => {
    const { target, timer, tooltip } = setup()

    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(100)
    expect(tooltip.visible).toBe(false)

    timer.advance(60)
    expect(tooltip.visible).toBe(true)
    expect(tooltip.element.getAttribute('role')).toBe('tooltip')
    expect(tooltip.element.textContent).toBe('Dauphin Island')
    expect(tooltip.element.hidden).toBe(false)
    expect(target.getAttribute('aria-describedby')).toBe(tooltip.element.id)
  })

  it('shows nothing for a pointer that only crosses the marker', () => {
    const { target, timer, tooltip } = setup()

    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(50)
    target.dispatchEvent(pointer('pointerleave', 'mouse'))
    timer.advance(500)

    expect(tooltip.visible).toBe(false)
    expect(timer.pending()).toBe(0)
  })

  it('hides on pointer leave and removes aria-describedby', () => {
    const { target, timer, tooltip } = setup()
    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(200)

    target.dispatchEvent(pointer('pointerleave', 'mouse'))
    timer.advance(0)

    expect(tooltip.visible).toBe(false)
    expect(tooltip.element.hidden).toBe(true)
    expect(target.hasAttribute('aria-describedby')).toBe(false)
  })

  it('ignores touch pointers, which have no hover', () => {
    const { target, timer, tooltip } = setup()

    target.dispatchEvent(pointer('pointerenter', 'touch'))
    timer.advance(1000)

    expect(tooltip.visible).toBe(false)
  })

  it('can be told to accept other pointer types', () => {
    const { target, timer, tooltip } = setup({ pointerTypes: ['touch'] })

    target.dispatchEvent(pointer('pointerenter', 'touch'))
    timer.advance(200)

    expect(tooltip.visible).toBe(true)
  })

  it('shows on keyboard focus and hides on blur', () => {
    const { target, timer, tooltip } = setup()

    target.dispatchEvent(new Event('focus'))
    timer.advance(200)
    expect(tooltip.visible).toBe(true)

    target.dispatchEvent(new Event('blur'))
    timer.advance(0)
    expect(tooltip.visible).toBe(false)
  })

  it('is dismissed by Escape without moving the pointer or focus (WCAG 1.4.13)', () => {
    const { target, timer, tooltip } = setup()
    target.dispatchEvent(new Event('focus'))
    timer.advance(200)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(tooltip.visible).toBe(false)
  })

  it('hides when the marker is pressed, so it never sits on top of the callout it opens', () => {
    const { target, timer, tooltip } = setup()
    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(200)

    target.dispatchEvent(new Event('pointerdown'))

    expect(tooltip.visible).toBe(false)
  })

  it('shows nothing when the content says there is no tooltip right now', () => {
    const { setText, target, timer, tooltip } = setup()
    setText(null)

    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(200)

    expect(tooltip.visible).toBe(false)
  })

  it('moves from one marker to the next, leaving aria-describedby only on the current one', () => {
    const { container, target, tooltip } = setup()
    const other = document.createElement('button')
    container.append(other)

    tooltip.show(target, 'one')
    tooltip.show(other, 'two')

    expect(target.hasAttribute('aria-describedby')).toBe(false)
    expect(other.getAttribute('aria-describedby')).toBe(tooltip.element.id)
    expect(tooltip.element.textContent).toBe('two')
  })

  it('is not interactive: pointer-events none', () => {
    const { tooltip } = setup()

    expect(tooltip.element.style.pointerEvents).toBe('none')
  })

  it('places itself above the marker, centred, when it can be measured', () => {
    const { container, target, tooltip } = setup()
    const define = (element: HTMLElement, name: string, value: number) =>
      Object.defineProperty(element, name, { configurable: true, value })
    define(container, 'clientWidth', 600)
    define(container, 'clientHeight', 400)
    define(tooltip.element, 'offsetWidth', 100)
    define(tooltip.element, 'offsetHeight', 24)
    container.getBoundingClientRect = () => new DOMRect(10, 20, 600, 400)
    target.getBoundingClientRect = () => new DOMRect(310, 220, 16, 16)

    tooltip.show(target, 'Dauphin Island')

    // Marker centre x = 318 - 10 = 308; top = 200. Box: 100 x 24, 8 px above.
    expect(tooltip.element.style.left).toBe('258px')
    expect(tooltip.element.style.top).toBe('168px')
    expect(tooltip.element.getAttribute('data-mapkit-tooltip-placement')).toBe('above')
    expect(tooltip.element.style.visibility).toBe('visible')
  })

  it('flips below a marker at the top edge and stays inside the map', () => {
    const { container, target, tooltip } = setup()
    const define = (element: HTMLElement, name: string, value: number) =>
      Object.defineProperty(element, name, { configurable: true, value })
    define(container, 'clientWidth', 600)
    define(container, 'clientHeight', 400)
    define(tooltip.element, 'offsetWidth', 100)
    define(tooltip.element, 'offsetHeight', 24)
    container.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400)
    target.getBoundingClientRect = () => new DOMRect(2, 6, 16, 16)

    tooltip.show(target, 'Dauphin Island')

    expect(tooltip.element.getAttribute('data-mapkit-tooltip-placement')).toBe('below')
    expect(tooltip.element.style.left).toBe('4px')
  })

  it('detaches its listeners and removes itself on destroy', () => {
    const { container, target, timer, tooltip } = setup()
    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(200)

    tooltip.destroy()
    target.dispatchEvent(pointer('pointerenter', 'mouse'))
    timer.advance(200)

    expect(container.querySelector('[data-mapkit-tooltip]')).toBeNull()
    expect(tooltip.visible).toBe(false)
    expect(target.hasAttribute('aria-describedby')).toBe(false)
  })
})
