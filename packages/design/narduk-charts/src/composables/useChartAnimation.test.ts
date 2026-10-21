// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NardukBarChart from '../components/NardukBarChart.vue'
import NardukLineChart from '../components/NardukLineChart.vue'

class VisibilityObserver {
  static instances: VisibilityObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(readonly notify: (entries: Array<{ isIntersecting: boolean }>) => void) {
    VisibilityObserver.instances.push(this)
  }
}

let frames: Map<number, FrameRequestCallback>
let nextFrame: number

async function paint() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(0)
  await nextTick()
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  VisibilityObserver.instances = []
  frames = new Map()
  nextFrame = 1
  vi.stubGlobal('IntersectionObserver', VisibilityObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const charts: Array<[string, Component, string, string, string, string]> = [
  ['line', NardukLineChart, '.narduk-line-path', 'stroke-dashoffset', '1', '0'],
  ['bar', NardukBarChart, '.narduk-bar-rect', 'height', '0', '100'],
]

describe.each(charts)(
  '%s draw-on-visible',
  (_name, component, selector, attribute, hidden, shown) => {
    function render(extra = {}) {
      return mount(component, {
        props: {
          labels: ['A', 'B'],
          series: [{ name: 'Value', data: [10, 10] }],
          width: 300,
          height: 100,
          yMin: 0,
          yMax: 10,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          animate: true,
          drawOnVisible: true,
          ...extra,
        },
      })
    }

    it('waits for intersection, reveals once, and disconnects', async () => {
      const wrapper = render()
      await nextTick()
      const observer = VisibilityObserver.instances[0]!
      expect(observer.observe).toHaveBeenCalledOnce()
      expect(wrapper.get(selector).attributes(attribute)).toBe(hidden)
      observer.notify([{ isIntersecting: false }])
      await paint()
      expect(wrapper.get(selector).attributes(attribute)).toBe(hidden)
      observer.notify([{ isIntersecting: true }])
      await paint()
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
      expect(observer.disconnect).toHaveBeenCalledOnce()
      await wrapper.setProps({ drawOnVisible: false })
      await wrapper.setProps({ drawOnVisible: true })
      expect(VisibilityObserver.instances).toHaveLength(1)
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
    })

    it('preserves mount animation without the visibility opt-in', async () => {
      const wrapper = render({ drawOnVisible: false })
      expect(VisibilityObserver.instances).toHaveLength(0)
      expect(wrapper.get(selector).attributes(attribute)).toBe(hidden)
      await paint()
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
    })

    it('renders immediately when animation is disabled', () => {
      const wrapper = render({ animate: false })
      expect(VisibilityObserver.instances).toHaveLength(0)
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
    })

    it('reveals without IntersectionObserver support', async () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      const wrapper = render()
      await paint()
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
    })

    it('honors reduced motion even while waiting for visibility', async () => {
      const matchMedia = window.matchMedia.bind(window)
      vi.spyOn(window, 'matchMedia').mockImplementation(query => {
        const media = matchMedia(query)
        Object.defineProperty(media, 'matches', { value: query.includes('reduced-motion') })
        return media
      })
      const wrapper = render()
      await nextTick()
      expect(wrapper.get(selector).attributes(attribute)).toBe(shown)
      expect(VisibilityObserver.instances).toHaveLength(0)
    })

    it('disconnects on unmount and cancels a queued reveal', async () => {
      const wrapper = render()
      const observer = VisibilityObserver.instances[0]!
      wrapper.unmount()
      expect(observer.disconnect).toHaveBeenCalledOnce()
      const queued = render({ drawOnVisible: false })
      expect(frames.size).toBe(1)
      queued.unmount()
      expect(frames.size).toBe(0)
      await paint()
    })
  },
)
