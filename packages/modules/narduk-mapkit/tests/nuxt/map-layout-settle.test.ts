// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useMapKitLayoutSettle } from '../../src/nuxt/runtime/composables/index.js'
import { createFakeMapKit } from '../../src/testing/index.js'

afterEach(() => vi.unstubAllGlobals())

describe('bare map layout settling', () => {
  it('waits for size, restores inline height, and cancels work on replacement and disposal', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => callbacks.delete(handle))
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = disconnect
        observe() {}
      },
    )
    const tick = () => {
      const batch = [...callbacks.values()]
      callbacks.clear()
      for (const callback of batch) callback(0)
    }
    const fake = createFakeMapKit()
    const map = new fake.mapkit.Map(document.createElement('div'))
    const host = map.element!
    host.style.setProperty('height', '50%', 'important')
    let width = 0
    Object.defineProperty(host, 'clientWidth', { get: () => width })
    Object.defineProperty(host, 'clientHeight', { value: 200 })
    const scope = effectScope()
    const layout = scope.run(useMapKitLayoutSettle)!
    try {
      layout.handleMapReady(map)
      expect(host.style.height).toBe('50%')
      width = 400
      tick()
      expect(host.style.height).toBe('201px')
      tick()
      tick()
      expect(host.style.height).toBe('50%')
      expect(host.style.getPropertyPriority('height')).toBe('important')

      layout.handleMapReady(map)
      expect(host.style.height).toBe('201px')
      layout.handleMapReady(null)
      expect(host.style.height).toBe('50%')
      expect(callbacks.size).toBe(0)
      expect(disconnect).toHaveBeenCalledTimes(2)

      layout.handleMapReady(map)
      scope.stop()
      expect(host.style.height).toBe('50%')
      expect(callbacks.size).toBe(0)
      expect(disconnect).toHaveBeenCalledTimes(3)
    } finally {
      scope.stop()
    }
  })
})
