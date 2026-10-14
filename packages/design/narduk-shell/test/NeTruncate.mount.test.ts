// @vitest-environment happy-dom
/*
 * NeTruncate, mounted (narduk-libs#1855): the full value stays the text and the
 * tooltip, and a title alone is not the only way in -- the root is focusable and
 * Enter, Space or a click expands it.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeTruncate from '../src/runtime/components/NeTruncate.vue'

const PATH = '/var/lib/narduk/releases/2026-10-14/build-output.tar.gz'

describe('NeTruncate', () => {
  it('keeps the whole value as text content and tooltip', () => {
    const wrapper = mount(NeTruncate, { props: { text: PATH, kind: 'path' } })
    expect(wrapper.text()).toBe(PATH)
    expect(wrapper.attributes('title')).toBe(PATH)
  })

  it('splits the path so the filename is the whole tail', () => {
    const wrapper = mount(NeTruncate, { props: { text: PATH, kind: 'path' } })
    expect(wrapper.get('.ne-truncate__tail').text()).toBe('/build-output.tar.gz')
    expect(wrapper.get('.ne-truncate__head').text() + '/build-output.tar.gz').toBe(PATH)
  })

  it('uses the last `tail` characters by default and honours `tail`', () => {
    const text = 'a'.repeat(40) + 'END0123456789'
    expect(mount(NeTruncate, { props: { text } }).get('.ne-truncate__tail').text()).toBe(
      text.slice(-14),
    )
    expect(mount(NeTruncate, { props: { text, tail: 5 } }).get('.ne-truncate__tail').text()).toBe(
      '56789',
    )
  })

  it('mode="end" renders no tail', () => {
    const wrapper = mount(NeTruncate, { props: { text: PATH, mode: 'end' } })
    expect(wrapper.find('.ne-truncate__tail').exists()).toBe(false)
    expect(wrapper.text()).toBe(PATH)
  })

  it('is focusable and toggles open on click, Enter and Space', async () => {
    const wrapper = mount(NeTruncate, { props: { text: PATH } })
    expect(wrapper.attributes('tabindex')).toBe('0')
    expect(wrapper.attributes('role')).toBe('button')
    expect(wrapper.attributes('aria-expanded')).toBe('false')

    await wrapper.trigger('click')
    expect(wrapper.attributes('aria-expanded')).toBe('true')
    expect(wrapper.classes()).toContain('ne-truncate--expanded')

    await wrapper.trigger('keydown', { key: 'Enter' })
    expect(wrapper.attributes('aria-expanded')).toBe('false')

    await wrapper.trigger('keydown', { key: ' ' })
    expect(wrapper.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toBe(PATH)
  })
})
