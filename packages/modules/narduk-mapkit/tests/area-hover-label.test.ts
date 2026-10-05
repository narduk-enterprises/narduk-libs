import { describe, expect, it, vi } from 'vitest'

import { createAreaHoverLabel } from '../src/client/index.js'

import type { AreaHoverLabelElement, PointLayerView } from '../src/client/index.js'

function fakeElement() {
  const attributes: Record<string, string> = {}
  const element: AreaHoverLabelElement & { attributes: Record<string, string> } = {
    attributes,
    dataset: {},
    style: { cssText: '', opacity: '', transform: '', transition: '' },
    remove: vi.fn(),
    setAttribute: (name, value) => {
      attributes[name] = value
    },
    textContent: '',
  }
  return element
}

function setup(options: { reducedMotion?: boolean } = {}) {
  const element = fakeElement()
  const appended: unknown[] = []
  const label = createAreaHoverLabel({
    className: 'rs-state-hover',
    container: { appendChild: (child) => appended.push(child) },
    createElement: () => element,
    reducedMotion: false,
    style: 'font-size:44px',
    ...options,
  })
  return { appended, element, label }
}

const VIEW: PointLayerView = { height: 600, latitude: 40, longitude: -95, width: 1000, zoom: 5 }
const OHIO = { latitude: 40.3, longitude: -82.8, text: 'OH' }

describe('createAreaHoverLabel', () => {
  it('is in the container, hidden from assistive technology, silent to the pointer, and hidden', () => {
    const { appended, element } = setup()
    expect(appended).toEqual([element])
    expect(element.attributes).toMatchObject({ 'aria-hidden': 'true', class: 'rs-state-hover' })
    expect(element.style.cssText).toContain('pointer-events:none')
    expect(element.style.cssText).toContain('font-size:44px')
    expect(element.style.opacity).toBe('0')
    expect(element.dataset.visible).toBe('false')
    expect(element.style.transition).toBe('opacity 140ms ease-out')
  })

  it('centres the text on its anchor when the anchor is on screen', () => {
    const { element, label } = setup()
    label.update(VIEW)
    label.show(OHIO, { x: 700, y: 300 })
    expect(label.placement).toBe('anchor')
    expect(label.text).toBe('OH')
    expect(element.textContent).toBe('OH')
    expect(element.style.opacity).toBe('1')
    expect(element.dataset.visible).toBe('true')
    // Zoom 5: 8192 px round the world. 12.2 degrees east of the centre, 0.3 north of 40.
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(element.style.transform)
    expect(Number(match?.[1])).toBeCloseTo(500 + (12.2 / 360) * 8192, -1)
    expect(Number(match?.[2])).toBeLessThan(300)
    expect(element.style.transform).toContain('translate(-50%, -50%)')
  })

  it('moves with the map', () => {
    const { element, label } = setup()
    label.update(VIEW)
    label.show(OHIO)
    const before = element.style.transform
    label.update({ ...VIEW, longitude: -94 })
    expect(element.style.transform).not.toBe(before)
    expect(label.placement).toBe('anchor')
  })

  it('sits above the pointer when the anchor is off the screen, and hides with no pointer', () => {
    const { element, label } = setup()
    label.update({ ...VIEW, longitude: -120, zoom: 6 })
    label.show(OHIO, { x: 410, y: 320 })
    expect(label.placement).toBe('pointer')
    expect(element.style.transform).toContain('translate(410px, 292px)')

    label.show(OHIO, null)
    expect(label.placement).toBe('hidden')
    expect(element.style.opacity).toBe('0')
  })

  it('treats an anchor within the inset of the edge as off the screen', () => {
    const { label } = setup()
    // 460 px east of the centre of a 1000 px view is 40 px from the edge, inside the 48 px inset.
    label.update({ ...VIEW, width: 1000, zoom: 5 })
    label.show({ ...OHIO, longitude: -95 + (460 / 8192) * 360 }, { x: 5, y: 5 })
    expect(label.placement).toBe('pointer')
    label.show({ ...OHIO, longitude: -95 + (460 / 8192) * 360 }, null)
    expect(label.placement).toBe('hidden')
  })

  it('fades out on hide, keeping its text for the fade', () => {
    const { element, label } = setup()
    label.update(VIEW)
    label.show(OHIO)
    label.hide()
    expect(element.style.opacity).toBe('0')
    expect(element.dataset.visible).toBe('false')
    expect(element.textContent).toBe('OH')
    expect(label.text).toBe('')
    // A map move after the leave does not bring it back.
    label.update({ ...VIEW, longitude: -90 })
    expect(element.style.opacity).toBe('0')
  })

  it('does not wait for a fade with reduced motion', () => {
    const { element } = setup({ reducedMotion: true })
    expect(element.style.transition).toBe('none')
  })

  it('removes its element on destroy and ignores what follows', () => {
    const { element, label } = setup()
    label.update(VIEW)
    label.destroy()
    label.destroy()
    expect(element.remove).toHaveBeenCalledTimes(1)
    label.show(OHIO)
    expect(element.style.opacity).toBe('0')
  })
})
