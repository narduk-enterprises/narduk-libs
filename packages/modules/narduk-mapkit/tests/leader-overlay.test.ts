/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAPKIT_LEADER_ATTRIBUTE,
  MAPKIT_LEADER_LINE_ATTRIBUTE,
  MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE,
  MapKitLeaderOverlay,
} from '../src/client/index.js'

function size(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
  element.getBoundingClientRect = () =>
    ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
    }) as DOMRect
}

function harness(options: {
  anchor?: { height: number; width: number; x: number; y: number }
  onOffscreen?: (offscreen: boolean) => void
  point?: { x: number; y: number } | null
}) {
  const container = document.createElement('div')
  document.body.append(container)
  size(container, 1000, 800)

  let point = options.point === undefined ? { x: 200, y: 160 } : options.point
  let anchor: HTMLElement | null = null
  if (options.anchor) {
    anchor = document.createElement('div')
    document.body.append(anchor)
    const box = options.anchor
    anchor.getBoundingClientRect = () =>
      ({
        bottom: box.y + box.height,
        height: box.height,
        left: box.x,
        right: box.x + box.width,
        top: box.y,
        width: box.width,
        x: box.x,
        y: box.y,
      }) as DOMRect
  }

  const overlay = new MapKitLeaderOverlay({
    container,
    getAnchor: () => anchor,
    getPoint: () => point,
    ...(options.onOffscreen ? { onOffscreen: options.onOffscreen } : {}),
  })

  return {
    container,
    overlay,
    setPoint(next: { x: number; y: number } | null) {
      point = next
    },
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('MapKitLeaderOverlay (narduk-libs#517)', () => {
  it('draws a line from the annotation point to the anchor centre', () => {
    const { container } = harness({
      anchor: { height: 80, width: 200, x: 700, y: 40 },
    })

    const svg = container.querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)
    const line = container.querySelector(`[${MAPKIT_LEADER_LINE_ATTRIBUTE}]`)
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(line?.getAttribute('x1')).toBe('200')
    expect(line?.getAttribute('y1')).toBe('160')
    expect(line?.getAttribute('x2')).toBe('800')
    expect(line?.getAttribute('y2')).toBe('80')
    expect(line?.hasAttribute('hidden')).toBe(false)
    expect(svg?.hasAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE)).toBe(false)
  })

  it('reports off-screen when the point leaves the frame and hides the line', () => {
    const onOffscreen = vi.fn()
    const { container, overlay, setPoint } = harness({
      anchor: { height: 80, width: 200, x: 700, y: 40 },
      onOffscreen,
    })

    expect(onOffscreen).toHaveBeenCalledWith(false)

    setPoint({ x: -40, y: 160 })
    overlay.refresh()

    expect(overlay.offscreen).toBe(true)
    expect(onOffscreen).toHaveBeenLastCalledWith(true)
    expect(
      container.querySelector(`[${MAPKIT_LEADER_LINE_ATTRIBUTE}]`)?.hasAttribute('hidden'),
    ).toBe(true)
    expect(
      container
        .querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)
        ?.hasAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE),
    ).toBe(true)
  })

  it('hides the line without claiming off-screen when there is no point', () => {
    const onOffscreen = vi.fn()
    const { container } = harness({
      anchor: { height: 80, width: 200, x: 700, y: 40 },
      onOffscreen,
      point: null,
    })

    expect(onOffscreen).toHaveBeenCalledWith(false)
    expect(
      container.querySelector(`[${MAPKIT_LEADER_LINE_ATTRIBUTE}]`)?.hasAttribute('hidden'),
    ).toBe(true)
    expect(
      container
        .querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)
        ?.hasAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE),
    ).toBe(false)
  })

  it('hides the line without claiming off-screen when the pin is in frame but the anchor is missing', () => {
    const onOffscreen = vi.fn()
    const { container } = harness({ onOffscreen })

    expect(onOffscreen).toHaveBeenCalledWith(false)
    expect(
      container.querySelector(`[${MAPKIT_LEADER_LINE_ATTRIBUTE}]`)?.hasAttribute('hidden'),
    ).toBe(true)
    expect(
      container
        .querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)
        ?.hasAttribute(MAPKIT_LEADER_OFFSCREEN_ATTRIBUTE),
    ).toBe(false)
  })

  it('removes the svg on destroy', () => {
    const { container, overlay } = harness({})
    expect(container.querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)).not.toBeNull()

    overlay.destroy()
    overlay.destroy()

    expect(container.querySelector(`[${MAPKIT_LEADER_ATTRIBUTE}]`)).toBeNull()
  })
})
