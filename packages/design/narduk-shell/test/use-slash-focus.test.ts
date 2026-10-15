// @vitest-environment happy-dom
/*
 * useSlashFocus(): "/" outside a field focuses the target; "/" inside a field
 * is typing. The key handling is Nuxt UI's `defineShortcuts`, so these cases
 * pin the seam (what is focused, when) rather than re-test the shortcut engine.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { resolveFocusTarget, useSlashFocus } from '../src/runtime/composables/use-slash-focus'

import type { NeSlashFocusTarget } from '../src/runtime/composables/use-slash-focus'

function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function mountSearch(options?: { key?: string }) {
  return mount(
    defineComponent({
      setup() {
        const search = ref<HTMLInputElement | null>(null)
        useSlashFocus(search, options)
        return () =>
          h('div', [
            h('input', { id: 'search', ref: search, value: 'previous query' }),
            h('input', { id: 'other' }),
            h('button', { id: 'button' }, 'x'),
          ])
      },
    }),
    { attachTo: document.body },
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useSlashFocus', () => {
  it('focuses the target and selects its text on "/"', () => {
    const wrapper = mountSearch()
    const search = document.querySelector<HTMLInputElement>('#search')!

    const event = press('/')

    expect(document.activeElement).toBe(search)
    expect(search.selectionStart).toBe(0)
    expect(search.selectionEnd).toBe('previous query'.length)
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('works from a focused button, which is not a text field', () => {
    const wrapper = mountSearch()
    const button = document.querySelector<HTMLButtonElement>('#button')!
    button.focus()

    press('/', button)

    expect(document.activeElement).toBe(document.querySelector('#search'))
    wrapper.unmount()
  })

  it('leaves "/" alone while the user is typing in another field', () => {
    const wrapper = mountSearch()
    const other = document.querySelector<HTMLInputElement>('#other')!
    other.focus()

    const event = press('/', other)

    expect(document.activeElement).toBe(other)
    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('does nothing for other keys, and honours a different key', () => {
    const wrapper = mountSearch({ key: 's' })
    press('/')
    expect(document.activeElement).toBe(document.body)

    press('s')
    expect(document.activeElement).toBe(document.querySelector('#search'))
    wrapper.unmount()
  })

  it('stops listening when the component unmounts', () => {
    const wrapper = mountSearch()
    wrapper.unmount()
    document.body.innerHTML = '<input id="search" />'

    press('/')

    expect(document.activeElement).toBe(document.body)
  })

  it('does nothing while the target is not mounted', () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          useSlashFocus(() => null)
          return () => h('div')
        },
      }),
      { attachTo: document.body },
    )

    expect(() => press('/')).not.toThrow()
    wrapper.unmount()
  })
})

describe('resolveFocusTarget', () => {
  it('returns a field as it is, and the first field inside a wrapper', () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<span><input id="inner" /></span>'
    const input = wrapper.querySelector('input')!

    expect(resolveFocusTarget(input)).toBe(input)
    expect(resolveFocusTarget(wrapper)).toBe(input)
  })

  it('unwraps a component instance through $el', () => {
    const root = document.createElement('div')
    root.innerHTML = '<input />'
    const instance: NeSlashFocusTarget = { $el: root }

    expect(resolveFocusTarget(instance)).toBe(root.querySelector('input'))
  })

  it('returns null for nothing, a text node or an element with no field', () => {
    expect(resolveFocusTarget(null)).toBeNull()
    expect(resolveFocusTarget(undefined)).toBeNull()
    expect(resolveFocusTarget({ $el: null })).toBeNull()
    expect(
      resolveFocusTarget({ $el: document.createTextNode('x') as unknown as Element }),
    ).toBeNull()
    expect(resolveFocusTarget(document.createElement('div'))).toBeNull()
  })
})
