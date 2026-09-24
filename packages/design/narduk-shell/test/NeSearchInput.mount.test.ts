// @vitest-environment happy-dom
/*
 * NeSearchInput, mounted (narduk-libs#261): the other half of item 14. The
 * box shows the keystroke; `v-model` updates after the debounce; clear does
 * not wait. Types are imported from the package root the way a pilot must.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NE_SEARCH_DEBOUNCE_MS, type NeSearchInputProps } from '../src/index'
import NeSearchInput from '../src/runtime/components/NeSearchInput.vue'
import { NE_COLLECTION_DEBOUNCE_MS } from '../src/runtime/composables/use-collection'

function render(props: Partial<NeSearchInputProps> = {}) {
  return mount(NeSearchInput, {
    attachTo: document.body,
    props: { label: 'Search runners', ...props },
  })
}

const field = (wrapper: ReturnType<typeof render>) => wrapper.get('[data-ne-search-field]')
const input = (wrapper: ReturnType<typeof render>) => wrapper.get('input')
const typed = (wrapper: ReturnType<typeof render>) =>
  (input(wrapper).element as HTMLInputElement).value

describe('NeSearchInput: the applied term is not the keystroke', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the same debounce window useCollection applies to q', () => {
    expect(NE_SEARCH_DEBOUNCE_MS).toBe(250)
    expect(NE_SEARCH_DEBOUNCE_MS).toBe(NE_COLLECTION_DEBOUNCE_MS)
  })

  it('is a named search field whose box can be empty while nothing is applied', () => {
    const wrapper = render({ placeholder: 'Search runners' })
    expect(wrapper.find('[data-ne-search-input]').exists()).toBe(true)
    expect(field(wrapper).attributes('aria-label')).toBe('Search runners')
    expect(input(wrapper).attributes('type')).toBe('search')
    expect(input(wrapper).attributes('placeholder')).toBe('Search runners')
    expect(typed(wrapper)).toBe('')
    expect(wrapper.find('[data-ne-search-clear]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the keystroke immediately and emits the applied term after the debounce', async () => {
    const wrapper = render()
    await input(wrapper).setValue('run')
    expect(typed(wrapper)).toBe('run')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(NE_SEARCH_DEBOUNCE_MS - 1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([['run']])
    wrapper.unmount()
  })

  it('coalesces keystrokes in one window into one emit', async () => {
    const wrapper = render()
    await input(wrapper).setValue('r')
    await vi.advanceTimersByTimeAsync(100)
    await input(wrapper).setValue('ru')
    await vi.advanceTimersByTimeAsync(100)
    await input(wrapper).setValue('run')
    await vi.advanceTimersByTimeAsync(NE_SEARCH_DEBOUNCE_MS)
    expect(wrapper.emitted('update:modelValue')).toEqual([['run']])
    wrapper.unmount()
  })

  it('emits on every keystroke when debounce is 0, the useCollection binding', async () => {
    const wrapper = render({ debounce: 0 })
    await input(wrapper).setValue('r')
    await input(wrapper).setValue('ru')
    expect(wrapper.emitted('update:modelValue')).toEqual([['r'], ['ru']])
    wrapper.unmount()
  })

  it('clears the box and the model in the same tick, without waiting out the debounce', async () => {
    const wrapper = render({ modelValue: 'run' })
    expect(typed(wrapper)).toBe('run')
    await wrapper.get('[data-ne-search-clear]').trigger('click')
    expect(typed(wrapper)).toBe('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    await vi.advanceTimersByTimeAsync(NE_SEARCH_DEBOUNCE_MS)
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    wrapper.unmount()
  })

  it('adopts an external model without emitting it back', async () => {
    const wrapper = render({ debounce: 0, modelValue: 'old' })
    expect(typed(wrapper)).toBe('old')
    await wrapper.setProps({ modelValue: 'from-url' })
    expect(typed(wrapper)).toBe('from-url')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels a pending emit when the parent writes a new term', async () => {
    const wrapper = render()
    await input(wrapper).setValue('run')
    await wrapper.setProps({ modelValue: 'from-url' })
    await vi.advanceTimersByTimeAsync(NE_SEARCH_DEBOUNCE_MS)
    expect(typed(wrapper)).toBe('from-url')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('caps what can be typed at the list-query contract default', async () => {
    const wrapper = render({ debounce: 0 })
    const tooLong = 'x'.repeat(201)
    await input(wrapper).setValue(tooLong)
    expect(typed(wrapper)).toHaveLength(200)
    expect(wrapper.emitted('update:modelValue')).toEqual([['x'.repeat(200)]])
    wrapper.unmount()
  })

  it('does not emit the same applied term twice', async () => {
    const wrapper = render({ debounce: 0, modelValue: 'run' })
    await input(wrapper).setValue('run')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('marks the field busy while the collection is in flight, not only with a spinner', () => {
    const wrapper = render({ pending: true })
    expect(field(wrapper).attributes('aria-busy')).toBe('true')
    wrapper.unmount()
  })

  it('names the applied term in a live region when the caller asks for a summary', () => {
    const wrapper = render({ modelValue: 'run', showSummary: true })
    const summary = wrapper.get('[data-ne-search-summary]')
    expect(summary.attributes('aria-live')).toBe('polite')
    expect(summary.text()).toBe('Searching for “run”')
    wrapper.unmount()
  })

  it('hides the summary when nothing is applied, even if the box has a draft', async () => {
    const wrapper = render({ showSummary: true })
    await input(wrapper).setValue('run')
    expect(wrapper.find('[data-ne-search-summary]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides the clear control when the field is disabled', () => {
    const wrapper = render({ disabled: true, modelValue: 'run' })
    expect(wrapper.find('[data-ne-search-clear]').exists()).toBe(false)
    expect(input(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
