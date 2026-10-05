// @vitest-environment happy-dom
/*
 * NeCommandPaletteTrigger, mounted: a button that opens the shared palette,
 * warms it on intent, binds the shortcuts, and shows the right hint.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import NeCommandPaletteTrigger from '../src/runtime/components/NeCommandPaletteTrigger.vue'
import { useCommandPalette } from '../src/runtime/composables/use-command-palette'

import type { NeCommandPaletteTriggerProps } from '../src/runtime/components/ne-command-palette-types'

function mountTrigger(
  props: NeCommandPaletteTriggerProps = {},
  attrs: Record<string, unknown> = {},
) {
  return mount(NeCommandPaletteTrigger, { attachTo: document.body, attrs, props })
}

function setPlatform(value: string) {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value })
}

beforeEach(() => {
  useCommandPalette().close()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('NeCommandPaletteTrigger', () => {
  it('is a button named by its placeholder, that announces a dialog', () => {
    const wrapper = mountTrigger({ placeholder: 'Find a river, state or gauge' })
    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('Find a river, state or gauge')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    expect(button.attributes('aria-keyshortcuts')).toBe('Control+K Meta+K')
    expect(button.text()).toContain('Find a river, state or gauge')
    wrapper.unmount()
  })

  it('takes a separate accessible label', () => {
    const wrapper = mountTrigger({ label: 'Search River Status', placeholder: 'Search' })
    expect(wrapper.get('button').attributes('aria-label')).toBe('Search River Status')
    wrapper.unmount()
  })

  it('opens the palette on click', async () => {
    const wrapper = mountTrigger()
    expect(useCommandPalette().isOpen.value).toBe(false)
    await wrapper.get('button').trigger('click')
    expect(useCommandPalette().isOpen.value).toBe(true)
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('arms the lazy palette on pointer-enter, focus and touch, without opening it', async () => {
    for (const event of ['pointerenter', 'focus', 'touchstart']) {
      useCommandPalette().close()
      const wrapper = mountTrigger()
      await wrapper.get('button').trigger(event)
      expect(useCommandPalette().armed.value).toBe(true)
      expect(useCommandPalette().isOpen.value).toBe(false)
      wrapper.unmount()
    }
  })

  it('binds Cmd/Ctrl+K, and not when shortcuts are off', async () => {
    const on = mountTrigger()
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'k' }))
    await nextTick()
    expect(useCommandPalette().isOpen.value).toBe(true)
    on.unmount()

    useCommandPalette().close()
    const off = mountTrigger({ shortcuts: false })
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'k' }))
    await nextTick()
    expect(useCommandPalette().isOpen.value).toBe(false)
    off.unmount()
  })

  it('hints ⌘K on a Mac and Ctrl K elsewhere, decided after mount', async () => {
    setPlatform('MacIntel')
    const mac = mountTrigger()
    await nextTick()
    expect(mac.get('kbd').text()).toBe('⌘K')
    expect(mac.get('kbd').attributes('aria-hidden')).toBe('true')
    mac.unmount()

    setPlatform('Win32')
    const win = mountTrigger()
    await nextTick()
    expect(win.get('kbd').text()).toBe('Ctrl K')
    win.unmount()
  })

  it('passes class and attributes to the button, and a compact mode keeps the label for assistive tech', () => {
    const wrapper = mountTrigger(
      { compact: true, placeholder: 'Search' },
      { class: 'header-search', id: 'hs' },
    )
    const button = wrapper.get('button')
    expect(button.classes()).toContain('header-search')
    expect(button.classes()).toContain('is-compact')
    expect(button.attributes('id')).toBe('hs')
    expect(button.attributes('aria-label')).toBe('Search')
    wrapper.unmount()
  })

  it('with a fallback action sits in a GET form whose button submits until the click is handled', async () => {
    const wrapper = mountTrigger({ fallbackAction: '/search' })
    const form = wrapper.get('form')
    expect(form.attributes('action')).toBe('/search')
    expect(form.attributes('method')).toBe('get')
    expect(form.attributes('role')).toBe('search')
    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('submit')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.element.dispatchEvent(click)
    // Once the script has run the click opens the palette, not the page.
    expect(click.defaultPrevented).toBe(true)
    expect(useCommandPalette().isOpen.value).toBe(true)
    wrapper.unmount()
  })

  it('without a fallback has no form around it', () => {
    const wrapper = mountTrigger()
    expect(wrapper.find('form').exists()).toBe(false)
    wrapper.unmount()
  })
})
