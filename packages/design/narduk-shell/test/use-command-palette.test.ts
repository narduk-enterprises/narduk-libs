// @vitest-environment happy-dom
/*
 * `useCommandPalette()` and its shortcuts: the flags a header button, the
 * keyboard and the lazy palette share, and which keys open it.
 *
 * Under vitest `#imports` is Nuxt UI's stub, whose `useState` is a keyed store
 * for the whole file, so each case starts by closing and disarming the palette.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  isEditableTarget,
  shortcutFor,
  useCommandPalette,
  useCommandPaletteShortcuts,
} from '../src/runtime/composables/use-command-palette'

function key(init: Partial<KeyboardEvent> & { key: string }, target: EventTarget | null = null) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    metaKey: false,
    shiftKey: false,
    target,
    ...init,
  }
}

function field(tag: string, type?: string): HTMLElement {
  const element = document.createElement(tag)
  if (type) element.setAttribute('type', type)
  return element
}

describe('shortcutFor', () => {
  it('toggles on Cmd+K and Ctrl+K, in either case', () => {
    expect(shortcutFor(key({ key: 'k', metaKey: true }))).toBe('toggle')
    expect(shortcutFor(key({ key: 'K', ctrlKey: true }))).toBe('toggle')
  })

  it('toggles from inside a text field too, as the palette is on top of it', () => {
    expect(shortcutFor(key({ key: 'k', metaKey: true }, field('input', 'text')))).toBe('toggle')
  })

  it('does not take Cmd+Shift+K or Cmd+Alt+K, or a bare k', () => {
    expect(shortcutFor(key({ key: 'k', metaKey: true, shiftKey: true }))).toBe('none')
    expect(shortcutFor(key({ key: 'k', altKey: true, ctrlKey: true }))).toBe('none')
    expect(shortcutFor(key({ key: 'k' }))).toBe('none')
  })

  it('opens on "/" outside a field', () => {
    expect(shortcutFor(key({ key: '/' }, document.body))).toBe('open')
  })

  it('leaves "/" alone in a text field, a textarea, a select and an editable element', () => {
    expect(shortcutFor(key({ key: '/' }, field('input', 'text')))).toBe('none')
    expect(shortcutFor(key({ key: '/' }, field('input')))).toBe('none')
    expect(shortcutFor(key({ key: '/' }, field('input', 'search')))).toBe('none')
    expect(shortcutFor(key({ key: '/' }, field('textarea')))).toBe('none')
    expect(shortcutFor(key({ key: '/' }, field('select')))).toBe('none')
    const editable = field('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(shortcutFor(key({ key: '/' }, editable))).toBe('none')
  })

  it('opens on "/" from a checkbox or a button, which take no typing', () => {
    expect(shortcutFor(key({ key: '/' }, field('input', 'checkbox')))).toBe('open')
    expect(shortcutFor(key({ key: '/' }, field('button')))).toBe('open')
  })

  it('does not open on "/" with a modifier, or when slash is turned off', () => {
    expect(shortcutFor(key({ key: '/', metaKey: true }))).toBe('none')
    expect(shortcutFor(key({ key: '/', ctrlKey: true }))).toBe('none')
    expect(shortcutFor(key({ key: '/' }), { slash: false })).toBe('none')
  })

  it('ignores keys while an IME is composing', () => {
    expect(shortcutFor(key({ key: 'k', metaKey: true, isComposing: true }))).toBe('none')
  })
})

describe('isEditableTarget', () => {
  it('is false for no target and for a non-element', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(window)).toBe(false)
  })
})

describe('useCommandPalette', () => {
  beforeEach(() => {
    useCommandPalette().close()
  })

  it('open arms and opens, close only closes, so the lazy chunk stays mounted', () => {
    const palette = useCommandPalette()
    palette.open()
    expect(palette.isOpen.value).toBe(true)
    expect(palette.armed.value).toBe(true)
    palette.close()
    expect(palette.isOpen.value).toBe(false)
    expect(palette.armed.value).toBe(true)
  })

  it('preload arms without opening', () => {
    const palette = useCommandPalette()
    palette.close()
    palette.preload()
    expect(palette.armed.value).toBe(true)
    expect(palette.isOpen.value).toBe(false)
  })

  it('toggle flips the open state', () => {
    const palette = useCommandPalette()
    palette.close()
    palette.toggle()
    expect(palette.isOpen.value).toBe(true)
    palette.toggle()
    expect(palette.isOpen.value).toBe(false)
  })

  it('shares one state across callers', () => {
    useCommandPalette().open()
    expect(useCommandPalette().isOpen.value).toBe(true)
    useCommandPalette().close()
  })
})

describe('useCommandPaletteShortcuts', () => {
  const Host = defineComponent({
    props: { slash: { type: Boolean, default: true } },
    setup(props) {
      useCommandPaletteShortcuts({ slash: props.slash })
      return () => h('div')
    },
  })

  afterEach(() => {
    document.body.innerHTML = ''
    useCommandPalette().close()
  })

  function press(init: KeyboardEventInit, target: EventTarget = document.body) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('Cmd+K opens, a second Cmd+K closes, and the browser default is prevented', () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const palette = useCommandPalette()
    const first = press({ key: 'k', metaKey: true })
    expect(first.defaultPrevented).toBe(true)
    expect(palette.isOpen.value).toBe(true)
    press({ key: 'k', metaKey: true })
    expect(palette.isOpen.value).toBe(false)
    wrapper.unmount()
  })

  it('"/" opens outside a field and types normally inside one', () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const palette = useCommandPalette()
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    const typed = press({ key: '/' }, input)
    expect(typed.defaultPrevented).toBe(false)
    expect(palette.isOpen.value).toBe(false)
    const outside = press({ key: '/' })
    expect(outside.defaultPrevented).toBe(true)
    expect(palette.isOpen.value).toBe(true)
    wrapper.unmount()
  })

  it('binds one listener for any number of components, and removes it with the last', () => {
    const one = mount(Host, { attachTo: document.body })
    const two = mount(Host, { attachTo: document.body })
    const palette = useCommandPalette()
    press({ key: 'k', ctrlKey: true })
    // Two listeners would toggle twice and end closed.
    expect(palette.isOpen.value).toBe(true)
    one.unmount()
    press({ key: 'k', ctrlKey: true })
    expect(palette.isOpen.value).toBe(false)
    two.unmount()
    press({ key: 'k', ctrlKey: true })
    expect(palette.isOpen.value).toBe(false)
  })
})
