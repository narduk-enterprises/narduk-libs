/// <reference lib="dom" />
// @vitest-environment happy-dom
/* The DOM lib reference must stay the first line (see preferences-state.test.ts). */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createStoredState, resolveWebStorage, useStoredState } from '../runtime/app/stored-state'

import type { StoredStateOptions, StoredStateRef } from '../runtime/app/stored-state'

const KEY = 'narduk-farm:nav-open'

/** A Storage whose every method throws, as Safari's does over quota or when blocked. */
function refusingStorage(error = new DOMException('blocked', 'SecurityError')): Storage {
  const fail = () => {
    throw error
  }
  return {
    clear: fail,
    getItem: fail,
    key: fail,
    get length(): number {
      return fail()
    },
    removeItem: fail,
    setItem: fail,
  }
}

/** Makes `window.localStorage` itself throw on access, as a blocked-storage browser does. */
function blockLocalStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('resolveWebStorage', () => {
  it('answers null instead of throwing when the storage property itself throws', () => {
    blockLocalStorage()
    expect(() => resolveWebStorage('local')).not.toThrow()
    expect(resolveWebStorage('local')).toBeNull()
  })

  it('answers the chosen area', () => {
    expect(resolveWebStorage('local')).toBe(window.localStorage)
    expect(resolveWebStorage('session')).toBe(window.sessionStorage)
  })
})

describe('createStoredState', () => {
  const basemaps = ['streets', 'satellite'] as const
  type Basemap = (typeof basemaps)[number]
  const basemapOptions: StoredStateOptions<Basemap> = {
    default: 'streets',
    validate: (value): value is Basemap => basemaps.includes(value as Basemap),
  }

  it('round-trips through JSON by default', () => {
    const store = createStoredState('basemap', basemapOptions)
    expect(store.read()).toBeUndefined()
    expect(store.write('satellite')).toBe(true)
    expect(window.localStorage.getItem('basemap')).toBe('"satellite"')
    expect(store.read()).toBe('satellite')
    expect(store.remove()).toBe(true)
    expect(store.read()).toBeUndefined()
  })

  it('uses the key exactly as given, with no prefix', () => {
    createStoredState(KEY, { default: true }).write(false)
    expect(Object.keys(window.localStorage)).toEqual([KEY])
  })

  it('refuses a stored value the validator rejects', () => {
    window.localStorage.setItem('basemap', '"hybrid"')
    expect(createStoredState('basemap', basemapOptions).read()).toBeUndefined()
  })

  it('refuses malformed JSON', () => {
    window.localStorage.setItem('basemap', '{nope')
    expect(createStoredState('basemap', basemapOptions).read()).toBeUndefined()
  })

  it('without a validator, refuses a value of another JSON type than the default', () => {
    const store = createStoredState<string[]>('history', { default: [] })
    window.localStorage.setItem('history', '{"not":"an array"}')
    expect(store.read()).toBeUndefined()
    window.localStorage.setItem('history', '["https://a.test"]')
    expect(store.read()).toEqual(['https://a.test'])
  })

  it('takes a custom parse and serialize, undefined meaning the default', () => {
    const store = createStoredState<boolean>(KEY, {
      default: true,
      parse: (raw) => (raw === 'false' ? false : raw === 'true' ? true : undefined),
      serialize: String,
    })
    store.write(false)
    expect(window.localStorage.getItem(KEY)).toBe('false')
    expect(store.read()).toBe(false)
    window.localStorage.setItem(KEY, 'maybe')
    expect(store.read()).toBeUndefined()
  })

  it('uses sessionStorage when asked', () => {
    createStoredState('tab', { default: 'a', storage: 'session' }).write('b')
    expect(window.sessionStorage.getItem('tab')).toBe('"b"')
    expect(window.localStorage.getItem('tab')).toBeNull()
  })

  it.each([
    ['blocked', new DOMException('blocked', 'SecurityError')],
    ['full', new DOMException('full', 'QuotaExceededError')],
  ])('swallows every failure when storage is %s', (_label, error) => {
    const store = createStoredState('basemap', basemapOptions, () => refusingStorage(error))
    expect(store.read()).toBeUndefined()
    expect(store.write('satellite')).toBe(false)
    expect(store.remove()).toBe(false)
  })

  it('swallows the property access throwing too', () => {
    blockLocalStorage()
    const store = createStoredState('basemap', basemapOptions)
    expect(store.read()).toBeUndefined()
    expect(store.write('satellite')).toBe(false)
    expect(store.remove()).toBe(false)
  })
})

function harness(setup: () => StoredStateRef<boolean>) {
  let open!: StoredStateRef<boolean>
  const Component = defineComponent({
    setup() {
      open = setup()
      return () => h('span', { 'data-open': String(open.value) })
    },
  })
  return { Component, open: () => open }
}

const navOptions: StoredStateOptions<boolean> = { default: true }

describe('useStoredState', () => {
  it('renders the default on the server even when a value is stored', async () => {
    window.localStorage.setItem(KEY, 'false')
    const { Component } = harness(() => useStoredState(KEY, navOptions))
    expect(await renderToString(createSSRApp(Component))).toBe('<span data-open="true"></span>')
  })

  it('applies the stored value after mount, without a hydration mismatch', async () => {
    window.localStorage.setItem(KEY, 'false')
    const { Component } = harness(() => useStoredState(KEY, navOptions))
    const html = await renderToString(createSSRApp(Component))
    const container = document.createElement('div')
    container.innerHTML = html
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    createSSRApp(Component).mount(container)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    await nextTick()
    expect(container.innerHTML).toBe('<span data-open="false"></span>')
  })

  it('writes changes back and does not write on restore', async () => {
    window.localStorage.setItem(KEY, 'false')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { Component, open } = harness(() => useStoredState(KEY, navOptions))
    const wrapper = mount(Component)
    await nextTick()
    expect(open().value).toBe(false)
    expect(setItem).not.toHaveBeenCalled()

    open().value = true
    await nextTick()
    expect(window.localStorage.getItem(KEY)).toBe('true')
    wrapper.unmount()
  })

  it('writes deep changes to an object value', async () => {
    let prefs!: StoredStateRef<{ layers: string[] }>
    const wrapper = mount(
      defineComponent({
        setup() {
          prefs = useStoredState('prefs', { default: () => ({ layers: [] as string[] }) })
          return () => h('span')
        },
      }),
    )
    await nextTick()
    prefs.value.layers.push('buoys')
    await nextTick()
    expect(window.localStorage.getItem('prefs')).toBe('{"layers":["buoys"]}')
    wrapper.unmount()
  })

  it('clear() removes the key and restores the default without writing it back', async () => {
    window.localStorage.setItem(KEY, 'false')
    const { Component, open } = harness(() => useStoredState(KEY, navOptions))
    const wrapper = mount(Component)
    await nextTick()
    open().clear()
    await nextTick()
    expect(open().value).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBeNull()

    open().value = false
    await nextTick()
    expect(window.localStorage.getItem(KEY)).toBe('false')
    wrapper.unmount()
  })

  it('keeps working for this visit when storage is blocked', async () => {
    blockLocalStorage()
    const { Component, open } = harness(() => useStoredState(KEY, navOptions))
    const wrapper = mount(Component)
    await nextTick()
    open().value = false
    await nextTick()
    expect(wrapper.html()).toBe('<span data-open="false"></span>')
    expect(() => open().clear()).not.toThrow()
    wrapper.unmount()
  })
})
