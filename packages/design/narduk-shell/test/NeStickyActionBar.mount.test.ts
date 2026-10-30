// @vitest-environment happy-dom
/*
 * NeStickyActionBar, mounted: a named group of actions, a spacer as tall as the
 * bar (so it never covers the last row), and `--ne-bottom-bar-h` kept on the
 * document while it is on screen and put back when it leaves.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'

import NeStickyActionBar from '../src/runtime/components/NeStickyActionBar.vue'

const root = () => document.documentElement

let observers: Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }> = []

function stubHeight(px: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(px)
}

function stubResizeObserver() {
  observers = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      constructor(callback: () => void) {
        observers.push({ callback, disconnect: this.disconnect })
      }
      observe() {}
      unobserve() {}
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  root().style.removeProperty('--ne-bottom-bar-h')
})

describe('NeStickyActionBar', () => {
  it('renders the slot in a named group, with an aria-hidden spacer in the flow', () => {
    const wrapper = mount(NeStickyActionBar, {
      props: { label: 'Trade actions' },
      slots: { default: () => h('button', { type: 'button' }, 'Buy') },
    })
    const bar = wrapper.get('[role="group"]')
    expect(bar.attributes('aria-label')).toBe('Trade actions')
    expect(bar.text()).toBe('Buy')
    expect(wrapper.get('.ne-sticky-action-bar__spacer').attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })

  it('is named Actions by default and phone-only by default', () => {
    const wrapper = mount(NeStickyActionBar)
    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Actions')
    expect(wrapper.attributes('data-phone-only')).toBeDefined()
    const wide = mount(NeStickyActionBar, { props: { phoneOnly: false } })
    expect(wide.attributes('data-phone-only')).toBeUndefined()
    wide.unmount()
    wrapper.unmount()
  })

  it('sizes the spacer to the measured bar and publishes the document token', async () => {
    stubHeight(72)
    const wrapper = mount(NeStickyActionBar)
    await nextTick()
    expect(wrapper.attributes('style')).toContain('--ne-sticky-action-bar-h: 72px')
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('72px')
    wrapper.unmount()
  })

  it('re-measures when the bar resizes', () => {
    stubResizeObserver()
    stubHeight(56)
    const wrapper = mount(NeStickyActionBar)
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('56px')

    stubHeight(96)
    observers[0]!.callback()
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('96px')
    wrapper.unmount()
    expect(observers[0]!.disconnect).toHaveBeenCalled()
  })

  it('puts the previous token back, or removes it, on unmount', () => {
    stubHeight(60)
    root().style.setProperty('--ne-bottom-bar-h', '3rem')
    const first = mount(NeStickyActionBar)
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('60px')
    first.unmount()
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('3rem')

    root().style.removeProperty('--ne-bottom-bar-h')
    const second = mount(NeStickyActionBar)
    second.unmount()
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('')
  })

  it("keeps the newest bar's height when an older bar leaves mid page transition", () => {
    stubHeight(60)
    root().style.setProperty('--ne-bottom-bar-h', '3rem')
    const outgoing = mount(NeStickyActionBar)
    stubHeight(80)
    const incoming = mount(NeStickyActionBar)
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('80px')

    outgoing.unmount() // the old page leaves after the new one has mounted
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('80px')

    incoming.unmount()
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('3rem')
  })

  it('works where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    stubHeight(64)
    const wrapper = mount(NeStickyActionBar)
    expect(root().style.getPropertyValue('--ne-bottom-bar-h')).toBe('64px')
    wrapper.unmount()
  })
})
