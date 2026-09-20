// @vitest-environment happy-dom
/*
 * NeFilterBar, mounted (narduk-libs#261): the promoted operator-portal
 * `FilterBar`. The three kinds carry different roles and ARIA; a filter with
 * no producer stays reachable; the tablist keyboard model is the APG one.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeFilterBar from '../src/runtime/components/NeFilterBar.vue'

import type {
  NeFilterBarItem,
  NeFilterBarProps,
} from '../src/runtime/components/ne-filter-bar-types'

const ITEMS: NeFilterBarItem[] = [
  { key: 'all', label: 'All', count: 12 },
  { key: 'open', label: 'Open', count: 3 },
  { key: 'done', label: 'Done' },
]

function render(props: Partial<NeFilterBarProps> = {}) {
  return mount(NeFilterBar, {
    attachTo: document.body,
    props: { items: ITEMS, label: 'State', ...props },
  })
}

const controls = (wrapper: ReturnType<typeof render>) => wrapper.findAll('[data-ne-filter-control]')

describe('NeFilterBar: chips', () => {
  it('is a named group whose selection is carried by aria-pressed', () => {
    const wrapper = render({ modelValue: 'open' })
    const row = wrapper.get('[data-ne-filter-bar]')
    expect(row.attributes('role')).toBe('group')
    expect(row.attributes('aria-label')).toBe('State')

    const pressed = controls(wrapper).map((control) => control.attributes('aria-pressed'))
    expect(pressed).toEqual(['false', 'true', 'false'])
    wrapper.unmount()
  })

  it('emits the chosen key and lets the caller own the selection', async () => {
    const wrapper = render()
    await controls(wrapper)[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['open']])
    // Nothing moved on its own: the row still shows nothing selected.
    expect(controls(wrapper).map((c) => c.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ])
    wrapper.unmount()
  })

  it('renders the caller count and omits it entirely when there is none', () => {
    const wrapper = render()
    const counts = controls(wrapper).map((control) =>
      control.find('[data-ne-filter-count]').exists(),
    )
    // "Done" passes no count, so no count element is rendered for it — an
    // absent count must not read as zero.
    expect(counts).toEqual([true, true, false])
    expect(controls(wrapper)[0]!.get('[data-ne-filter-count]').text()).toBe('12')
    wrapper.unmount()
  })

  it('drops an undefined attr rather than rendering the string "undefined"', () => {
    const wrapper = render({
      items: [{ key: 'a', label: 'A', attrs: { 'data-kept': 'yes', 'data-dropped': undefined } }],
    })
    const control = controls(wrapper)[0]!
    expect(control.attributes('data-kept')).toBe('yes')
    expect(control.attributes('data-dropped')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('NeFilterBar: a filter with no producer', () => {
  it('stays in the row, aria-disabled, and refuses the click', async () => {
    const wrapper = render({
      items: [
        { key: 'all', label: 'All' },
        { key: 'soon', label: 'By owner', disabled: true, title: 'Lands with the owner ledger' },
      ],
      note: 'By owner lands with the owner ledger',
    })

    const control = controls(wrapper)[1]!
    expect(controls(wrapper)).toHaveLength(2)
    expect(control.attributes('aria-disabled')).toBe('true')
    expect(control.attributes('title')).toBe('Lands with the owner ledger')
    // aria-disabled, NOT the disabled attribute: a disabled button leaves the
    // tab order, and then the reason in `title` is unreachable by keyboard.
    expect(control.attributes('disabled')).toBeUndefined()
    // A disabled control carries no pressed state — it is not a toggle.
    expect(control.attributes('aria-pressed')).toBeUndefined()

    await control.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    expect(wrapper.get('[data-ne-filter-note]').text()).toBe('By owner lands with the owner ledger')
    wrapper.unmount()
  })
})

describe('NeFilterBar: facets', () => {
  it('is a group like chips and says which kind it is', () => {
    const wrapper = render({ kind: 'facets' })
    const row = wrapper.get('[data-ne-filter-bar]')
    expect(row.attributes('data-ne-filter-kind')).toBe('facets')
    expect(row.attributes('role')).toBe('group')
    wrapper.unmount()
  })
})

describe('NeFilterBar: tabs (the APG tablist model)', () => {
  const tabs = (modelValue: string | null = 'all') =>
    render({ kind: 'tabs', modelValue, idPrefix: 'work' })

  it('is a tablist whose tabs name the panels they control', () => {
    const wrapper = tabs()
    expect(wrapper.get('[data-ne-filter-bar]').attributes('role')).toBe('tablist')

    const first = controls(wrapper)[0]!
    expect(first.attributes('role')).toBe('tab')
    expect(first.attributes('id')).toBe('work-tab-all')
    expect(first.attributes('aria-controls')).toBe('work-panel-all')
    expect(first.attributes('aria-selected')).toBe('true')
    // A tab is selected, never pressed: the two ARIA states are not both valid here.
    expect(first.attributes('aria-pressed')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps exactly one tab in the page tab order', () => {
    const selected = tabs('open')
    expect(controls(selected).map((c) => c.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
    selected.unmount()

    // Nothing selected: the first tab is the way in, so the row is reachable at all.
    const none = tabs(null)
    expect(controls(none).map((c) => c.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    none.unmount()
  })

  it('moves with the arrows and wraps at both ends', async () => {
    const wrapper = tabs('all')
    await controls(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['open'])

    await controls(wrapper)[0]!.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['done'])

    await controls(wrapper)[2]!.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['all'])
    wrapper.unmount()
  })

  it('takes Home and End to the ends', async () => {
    const wrapper = tabs('open')
    await controls(wrapper)[1]!.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['done'])

    await controls(wrapper)[1]!.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['all'])
    wrapper.unmount()
  })

  it('leaves every other key to the browser', async () => {
    const wrapper = tabs('all')
    await controls(wrapper)[0]!.trigger('keydown', { key: 'Tab' })
    await controls(wrapper)[0]!.trigger('keydown', { key: 'a' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not run the arrow model when the row is not a tablist', async () => {
    const wrapper = render({ kind: 'chips', modelValue: 'all' })
    await controls(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})
