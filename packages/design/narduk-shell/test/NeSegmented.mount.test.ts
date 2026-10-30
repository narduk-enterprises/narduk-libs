// @vitest-environment happy-dom
/*
 * NeSegmented, mounted: a named radiogroup, one Tab stop, arrow / Home / End
 * keys that choose and skip disabled segments, disabled kept visible with its
 * reason, and a null value lighting nothing.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import NeSegmented from '../src/runtime/components/NeSegmented.vue'

import type { NeSegmentOption } from '../src/runtime/components/ne-segmented-types'

const options: Array<NeSegmentOption<string>> = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W', count: 3 },
  { value: '1m', label: '1M', disabled: true, disabledReason: 'Not enough history' },
  { value: '1y', label: '1Y' },
]

function render(modelValue: string | null = '1w', extra: Record<string, unknown> = {}) {
  return mount(NeSegmented, {
    attachTo: document.body,
    props: { modelValue, options, label: 'Range', ...extra },
  })
}

const radios = (wrapper: ReturnType<typeof render>) => wrapper.findAll('[role="radio"]')
const emitted = (wrapper: ReturnType<typeof render>) =>
  (wrapper.emitted('update:modelValue') ?? []).map((args) => args[0])

describe('NeSegmented', () => {
  it('is a named radiogroup with the chosen segment checked and the only Tab stop', () => {
    const wrapper = render()
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('Range')
    expect(radios(wrapper).map((radio) => radio.attributes('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    expect(radios(wrapper).map((radio) => radio.attributes('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
      '-1',
    ])
    expect(wrapper.get('.ne-segmented__count').text()).toBe('3')
    wrapper.unmount()
  })

  it('prefers labelledby over label', () => {
    const wrapper = render('1w', { labelledby: 'range-heading' })
    const group = wrapper.get('[role="radiogroup"]')
    expect(group.attributes('aria-labelledby')).toBe('range-heading')
    expect(group.attributes('aria-label')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits on click, but not for the chosen or a disabled segment', async () => {
    const wrapper = render()
    await radios(wrapper)[0]?.trigger('click')
    await radios(wrapper)[1]?.trigger('click')
    await radios(wrapper)[2]?.trigger('click')
    expect(emitted(wrapper)).toEqual(['1d'])
    wrapper.unmount()
  })

  it('keeps a disabled segment visible with its reason', () => {
    const wrapper = render()
    const disabled = radios(wrapper)[2]
    expect(disabled?.attributes('disabled')).toBeDefined()
    expect(disabled?.attributes('title')).toBe('Not enough history')
    wrapper.unmount()
  })

  it('moves and chooses with the arrow keys, skipping disabled and wrapping', async () => {
    const wrapper = render()
    await radios(wrapper)[1]?.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.setProps({ modelValue: '1y' })
    await nextTick()
    expect(document.activeElement?.textContent).toContain('1Y')
    await radios(wrapper)[3]?.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.setProps({ modelValue: '1d' })
    await radios(wrapper)[0]?.trigger('keydown', { key: 'ArrowLeft' })
    expect(emitted(wrapper)).toEqual(['1y', '1d', '1y'])
    wrapper.unmount()
  })

  it('jumps with Home and End to the first and last enabled segments', async () => {
    const wrapper = render('1w')
    await radios(wrapper)[1]?.trigger('keydown', { key: 'End' })
    await radios(wrapper)[1]?.trigger('keydown', { key: 'Home' })
    expect(emitted(wrapper)).toEqual(['1y', '1d'])
    wrapper.unmount()
  })

  it('lights nothing for null and puts the Tab stop on the first enabled segment', () => {
    const wrapper = mount(NeSegmented, {
      props: {
        modelValue: null,
        options: [{ value: 'a', label: 'A', disabled: true }, ...options],
        label: 'Range',
      },
    })
    expect(wrapper.findAll('[aria-checked="true"]')).toHaveLength(0)
    expect(wrapper.findAll('[role="radio"]').map((radio) => radio.attributes('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
      '-1',
      '-1',
    ])
    wrapper.unmount()
  })

  it('renders the option slot inside the radio', () => {
    const wrapper = mount(NeSegmented, {
      props: { modelValue: '1d', options, label: 'Range' },
      slots: {
        option: ({ checked, option }: { checked: boolean; option: NeSegmentOption }) =>
          `${option.label}${checked ? '*' : ''}`,
      },
    })
    expect(wrapper.findAll('[role="radio"]').map((radio) => radio.text())).toEqual([
      '1D*',
      '1W',
      '1M',
      '1Y',
    ])
    wrapper.unmount()
  })
})
