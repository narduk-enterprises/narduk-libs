// @vitest-environment happy-dom
/*
 * NeAbsent, mounted: a value nothing produced is a named hatch, never a blank,
 * a zero or a dash. `cell` carries no words and says so to the phone card;
 * `block` names the field and takes one action.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeAbsent from '../src/runtime/components/NeAbsent.vue'
import { absentName, NE_UNREPORTED_TEXT, type NeAbsentProps } from '../src/index'

function mountAbsent(props: NeAbsentProps = {}, slot?: string) {
  return mount(NeAbsent, { props, slots: slot ? { default: slot } : undefined })
}

describe('absentName', () => {
  it('prefixes the field and falls back to the suite word', () => {
    expect(absentName('Uptime')).toBe('Uptime: not reported')
    expect(absentName()).toBe(NE_UNREPORTED_TEXT)
    expect(absentName('')).toBe(NE_UNREPORTED_TEXT)
  })
})

describe('NeAbsent: cell', () => {
  it('is an image named for the field, with the unreported state and no visible words', () => {
    const wrapper = mountAbsent({ label: '90-day uptime' })

    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('90-day uptime: not reported')
    expect(wrapper.attributes('title')).toBe('90-day uptime')
    expect(wrapper.attributes('data-state')).toBe('unreported')
    expect(wrapper.text()).toBe('')
  })

  it('is marked data-ne-empty so a phone card drops it', () => {
    expect(mountAbsent().attributes('data-ne-empty')).toBeDefined()
  })

  it('is named "Not reported" with no label, and has no title', () => {
    const wrapper = mountAbsent()
    expect(wrapper.attributes('aria-label')).toBe(NE_UNREPORTED_TEXT)
    expect(wrapper.attributes('title')).toBeUndefined()
  })

  it('ignores the default slot', () => {
    expect(mountAbsent({}, '<a href="/x">Propose</a>').find('a').exists()).toBe(false)
  })
})

describe('NeAbsent: block', () => {
  it('says the field and the word, joined, as visible text', () => {
    const wrapper = mountAbsent({ variant: 'block', label: 'Uptime' })

    expect(wrapper.get('.ne-absent__text').text()).toBe('Uptime · Not reported')
    expect(wrapper.attributes('data-state')).toBe('unreported')
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.attributes('data-ne-empty')).toBeUndefined()
  })

  it('takes another word, or none', () => {
    expect(mountAbsent({ variant: 'block', label: 'Uptime', word: 'no producer' }).text()).toBe(
      'Uptime · no producer',
    )
    expect(mountAbsent({ variant: 'block', label: 'Uptime', word: null }).text()).toBe('Uptime')
    expect(mountAbsent({ variant: 'block' }).text()).toBe(NE_UNREPORTED_TEXT)
  })

  it('renders the action slot after the words', () => {
    const wrapper = mountAbsent({ variant: 'block', label: 'Uptime' }, '<a href="/x">Propose</a>')
    expect(wrapper.get('a').attributes('href')).toBe('/x')
  })
})
