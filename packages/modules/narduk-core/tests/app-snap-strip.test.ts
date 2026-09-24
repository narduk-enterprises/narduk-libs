// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AppSnapStrip from '../runtime/app/components/shared/AppSnapStrip.vue'
import {
  formatSnapStripReadout,
  initialSnapStripRange,
  SNAP_STRIP_EN_DASH,
} from '../runtime/app/utils/snapStripReadout'

import { nuxtUiStubs } from './fixtures/nuxt-ui-stubs'

interface ObserverRecord {
  callback: IntersectionObserverCallback
  observed: Set<Element>
}

const observers: ObserverRecord[] = []

class FakeIntersectionObserver {
  readonly callback: IntersectionObserverCallback
  readonly observed = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observers.push({ callback, observed: this.observed })
  }

  observe(element: Element) {
    this.observed.add(element)
  }

  unobserve(element: Element) {
    this.observed.delete(element)
  }

  disconnect() {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render(itemCount = 6, itemsPerView = 2) {
  return mount(AppSnapStrip, {
    props: { itemsPerView },
    slots: {
      default: () =>
        Array.from({ length: itemCount }, (_, index) =>
          h('figure', { 'data-item': String(index) }, `Item ${index + 1}`),
        ),
    },
    global: { components: nuxtUiStubs },
  })
}

function reveal(wrapper: ReturnType<typeof render>, indexes: number[]) {
  const root = wrapper.get('[data-testid="app-snap-strip-scroller"]').element
  const observer = observers.at(-1)
  if (!observer) throw new Error('expected an IntersectionObserver')
  const entries = Array.from(root.children).map((target, index) => ({
    boundingClientRect: target.getBoundingClientRect(),
    intersectionRatio: indexes.includes(index) ? 1 : 0,
    intersectionRect: target.getBoundingClientRect(),
    isIntersecting: indexes.includes(index),
    rootBounds: null,
    target,
    time: 0,
  })) as IntersectionObserverEntry[]
  observer.callback(entries, observer as unknown as IntersectionObserver)
}

describe('AppSnapStrip readout', () => {
  it('formats a range with an en dash, not a hyphen', () => {
    expect(SNAP_STRIP_EN_DASH).toBe('\u2013')
    expect(formatSnapStripReadout(1, 2, 6)).toBe('1–2 of 6')
    expect(formatSnapStripReadout(1, 2, 6)).not.toContain('1-2')
    expect(formatSnapStripReadout(3, 3, 6)).toBe('3 of 6')
    expect(initialSnapStripRange(6, 2)).toEqual({ first: 1, last: 2 })
  })

  it('renders the first-page estimate before IntersectionObserver reports', () => {
    const wrapper = render()
    expect(wrapper.get('[data-testid="app-snap-strip-readout"]').text()).toBe('1–2 of 6')
    expect(wrapper.get('[data-testid="app-snap-strip-prev"]').attributes('disabled')).toBeDefined()
    expect(
      wrapper.get('[data-testid="app-snap-strip-next"]').attributes('disabled'),
    ).toBeUndefined()
    wrapper.unmount()
  })

  it('updates the readout from the visible children', async () => {
    const wrapper = render()
    reveal(wrapper, [2, 3])
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="app-snap-strip-readout"]').text()).toBe('3–4 of 6')
    expect(
      wrapper.get('[data-testid="app-snap-strip-prev"]').attributes('disabled'),
    ).toBeUndefined()
    wrapper.unmount()
  })

  it('renders a first-page readout on the server without IntersectionObserver', async () => {
    const app = createSSRApp({
      setup() {
        return () =>
          h(
            AppSnapStrip,
            { itemsPerView: 2 },
            {
              default: () =>
                Array.from({ length: 6 }, (_, index) => h('figure', `Item ${index + 1}`)),
            },
          )
      },
    })
    app.component('UButton', nuxtUiStubs.UButton)
    const html = await renderToString(app)
    expect(html).toContain('1–2 of 6')
    expect(html).not.toContain('1-2 of 6')
  })
})
