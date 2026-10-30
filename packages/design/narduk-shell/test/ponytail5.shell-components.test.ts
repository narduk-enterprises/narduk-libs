// @vitest-environment happy-dom
/* ponytail-5 repro: shell-src #8/#9/#10, shell-tests #4/#8/#14. */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import NeCommandPalette from '../src/runtime/components/NeCommandPalette.vue'
import NeMessageProse from '../src/runtime/components/NeMessageProse.vue'
import NeStatePanel from '../src/runtime/components/NeStatePanel.vue'
import { useCommandPalette } from '../src/runtime/composables/use-command-palette'
import { toCsv } from '../src/runtime/utils/data-table'
import { nuxtUiStubs } from './nuxt-ui-stubs'

describe('NeCommandPalette default navigation (shell-src #8, shell-tests #8)', () => {
  const assign = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    window.localStorage.clear()
    useCommandPalette().close()
    assign.mockClear()
    vi.stubGlobal('location', { ...window.location, assign })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function pressEnterOn(to: string) {
    const wrapper = mount(NeCommandPalette, {
      attachTo: document.body,
      props: {
        groups: [{ id: 'pages', label: 'Pages', items: [{ id: 'home', label: 'Home', to }] }],
        recentsKey: 'test:recents',
      },
      global: { mocks: { $router: { push: vi.fn() } } },
    })
    useCommandPalette().open()
    await nextTick()
    await nextTick()
    await wrapper.get('[data-ne-command-input]').setValue('home')
    await flushPromises()
    await wrapper.get('[data-ne-command-input]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    wrapper.unmount()
  }

  it('does not location.assign a javascript: target', async () => {
    await pressEnterOn('javascript:alert(1)')
    expect(assign).not.toHaveBeenCalled()
  })

  it('does not location.assign a protocol-relative target', async () => {
    await pressEnterOn('//evil.example')
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('NeMessageProse outbound link (shell-src #9)', () => {
  it('sets noreferrer on an https link', () => {
    const wrapper = mount(NeMessageProse, { props: { text: '[notes](https://example.com/notes)' } })
    expect(wrapper.get('a').attributes('rel')).toContain('noreferrer')
  })
})

describe('NeStatePanel unblocksHref (shell-src #10)', () => {
  it('does not render a javascript: href', () => {
    const wrapper = mount(NeStatePanel, {
      global: { components: nuxtUiStubs },
      props: { state: 'blocked', unblocksOn: 'the feed', unblocksHref: 'javascript:alert(1)' },
    })
    expect(wrapper.html()).not.toContain('javascript:')
  })
})

describe('toCsv formula guard (shell-tests #4)', () => {
  it('neutralises a text cell that starts with a space then =', () => {
    const text = toCsv<{ note: string }>(
      [{ key: 'note', label: 'Note' }],
      [{ note: ' =HYPERLINK("x")' }],
    )
    const cell = text.split('\r\n')[1]!
    expect(cell.replace(/^"/, '')).toMatch(/^'|^\s*'/)
  })
})
