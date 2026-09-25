// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useChart } from './useChart'

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
}

const Probe = defineComponent({
  props: { width: { type: Number, default: undefined } },
  setup(props, { expose }) {
    const container = ref<HTMLElement | null>(null)
    const { chartWidth } = useChart(container, props)
    expose({ chartWidth })
    return () => h('div', { ref: container })
  },
})

describe('useChart container observer', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('observes the container when mounted without a width', async () => {
    const wrapper = mount(Probe)
    await nextTick()
    await nextTick()
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect((wrapper.vm as unknown as { chartWidth: number }).chartWidth).toBe(1200)
    wrapper.unmount()
  })

  // #934: a chart mounted with a fixed width never became responsive again.
  it('starts observing when width goes from set to unset', async () => {
    const wrapper = mount(Probe, { props: { width: 800 } })
    await nextTick()
    await nextTick()
    expect(FakeResizeObserver.instances).toHaveLength(0)
    expect((wrapper.vm as unknown as { chartWidth: number }).chartWidth).toBe(800)

    await wrapper.setProps({ width: undefined })
    await nextTick()
    await nextTick()
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect((wrapper.vm as unknown as { chartWidth: number }).chartWidth).toBe(1200)
    wrapper.unmount()
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true)
  })

  // #934: unmounting before the post-mount tick left an observer attached.
  it('does not attach an observer when unmounted before the post-mount tick', async () => {
    const wrapper = mount(Probe)
    wrapper.unmount()
    await nextTick()
    await nextTick()
    expect(FakeResizeObserver.instances).toHaveLength(0)
  })
})
