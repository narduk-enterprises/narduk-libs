// @vitest-environment happy-dom
/*
 * NeFilterBar, mounted (narduk-libs#261): the promoted operator-portal
 * `FilterBar`. The three kinds carry different roles and ARIA; a filter with
 * no producer stays reachable; the tablist keyboard model is the APG one.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeFilterBar from '../src/runtime/components/NeFilterBar.vue'

// From the package root, not the module file: these are caller-built shapes, so
// a consumer types its items array with them, and the exports map admits no
// deep subpath. Importing them here the way a pilot must is what makes the
// barrel's re-export a checked fact rather than an intention (the sibling
// pattern in NeDataTable.mount.test.ts).
import type { NeFilterBarItem, NeFilterBarProps } from '../src/index'

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
    const row = wrapper.get('[data-ne-filter-controls]')
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
    expect(wrapper.get('[data-ne-filter-controls]').attributes('role')).toBe('group')
    wrapper.unmount()
  })
})

describe('NeFilterBar: tabs (the APG tablist model)', () => {
  const tabs = (modelValue: string | null = 'all') =>
    render({ kind: 'tabs', modelValue, idPrefix: 'work' })

  it('is a tablist whose tabs name the panels they control', () => {
    const wrapper = tabs()
    expect(wrapper.get('[data-ne-filter-controls]').attributes('role')).toBe('tablist')

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

/*
 * The roving model and the disabled set (review of narduk-libs#604).
 *
 * Both of these are the same defect seen from two sides: `choose` refuses a
 * disabled item, so anything that treats a disabled control as an ordinary
 * destination ends up with the visual state and the ARIA state answering
 * differently. The suite above only ever drove enabled controls, which is why
 * neither path was proven.
 */
describe('NeFilterBar: tabs whose destinations are disabled', () => {
  const GAPPED: NeFilterBarItem[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open', disabled: true },
    { key: 'done', label: 'Done' },
  ]

  const gapped = (modelValue: string | null = 'all', items = GAPPED) =>
    mount(NeFilterBar, {
      attachTo: document.body,
      props: { items, kind: 'tabs' as const, label: 'State', modelValue, idPrefix: 'work' },
    })

  it('walks past a disabled tab rather than landing on it', async () => {
    const wrapper = gapped('all')
    await controls(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
    // 'open' is disabled, so the destination is 'done' — not a focus move that
    // leaves aria-selected behind on 'all'.
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['done'])
    wrapper.unmount()
  })

  it('walks past it in the other direction too', async () => {
    // Driven from the LAST tab, where the naive index and the correct one
    // differ: stepping back from 'done' lands on disabled 'open', whose
    // refusal would emit nothing at all.
    const wrapper = gapped('done')
    await controls(wrapper)[2]!.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['all'])
    wrapper.unmount()
  })

  it('wraps past a disabled tab at the end of the row', async () => {
    // 'done' is last; ArrowRight wraps to 'all' rather than stopping.
    const wrapper = gapped('done')
    await controls(wrapper)[2]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['all'])
    wrapper.unmount()
  })

  it('takes Home and End to the enabled ends, not the literal ones', async () => {
    const edges: NeFilterBarItem[] = [
      { key: 'first', label: 'First', disabled: true },
      { key: 'middle', label: 'Middle' },
      { key: 'last', label: 'Last', disabled: true },
    ]
    const wrapper = gapped('middle', edges)
    await controls(wrapper)[1]!.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['middle'])
    await controls(wrapper)[1]!.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['middle'])
    wrapper.unmount()
  })

  it('leaves selection alone when every tab is disabled', async () => {
    const wrapper = gapped('all', [
      { key: 'all', label: 'All', disabled: true },
      { key: 'open', label: 'Open', disabled: true },
    ])
    await controls(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('NeFilterBar: a disabled chip that is the current selection', () => {
  const items: NeFilterBarItem[] = [
    { key: 'all', label: 'All' },
    { key: 'spend', label: 'Spend', disabled: true },
  ]

  it('still says it is pressed, so the two readings of the row agree', () => {
    // A URL-synced page can arrive on a key whose producer is missing. The chip
    // paints selected; without aria-pressed a screen reader would hear only a
    // disabled button, and the row would answer "filtered by what?" two ways.
    const wrapper = mount(NeFilterBar, {
      attachTo: document.body,
      props: { items, label: 'State', modelValue: 'spend' },
    })
    expect(controls(wrapper)[1]!.attributes('aria-pressed')).toBe('true')
    expect(controls(wrapper)[1]!.attributes('aria-disabled')).toBe('true')
    wrapper.unmount()
  })

  it('stays unpressed when it is disabled and not the selection', () => {
    // Unchanged: a filter nothing can answer is not an untoggled one.
    const wrapper = mount(NeFilterBar, {
      attachTo: document.body,
      props: { items, label: 'State', modelValue: 'all' },
    })
    expect(controls(wrapper)[1]!.attributes('aria-pressed')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('NeFilterBar: what the tablist owns, and what it must not', () => {
  const items: NeFilterBarItem[] = [
    { key: 'all', label: 'All' },
    { key: 'spend', label: 'Spend', disabled: true },
  ]

  /**
   * WAI-ARIA's tablist owns tabs. A caption and an action are neither, and
   * this row carries both — `note` and the `after` slot. They used to sit
   * inside the element holding `role="tablist"`, which no test drove because
   * the tabs suite never passed either one.
   */
  it('keeps the note and the after slot outside the tablist', () => {
    const wrapper = mount(NeFilterBar, {
      attachTo: document.body,
      props: { items, kind: 'tabs', label: 'State', note: 'Spend lands with the ledger' },
      slots: { after: '<button data-probe>Refresh</button>' },
    })

    const tablist = wrapper.get('[role="tablist"]')
    expect(tablist.attributes('data-ne-filter-controls')).toBeDefined()
    expect(tablist.find('[data-ne-filter-note]').exists()).toBe(false)
    expect(tablist.find('[data-probe]').exists()).toBe(false)
    // Still in the row itself — moved out of the tablist, not off the page.
    expect(wrapper.find('[data-ne-filter-note]').exists()).toBe(true)
    expect(wrapper.find('[data-probe]').exists()).toBe(true)
    wrapper.unmount()
  })

  /**
   * The SFC says `aria-disabled` is used so a keyboard user can land on the
   * control and read its `title`. Under `tabs` that is false — APG skips
   * disabled tabs and `nextEnabled` implements it — so the reason has to reach
   * a screen reader some other way, or the component is claiming a courtesy it
   * does not extend.
   */
  it('points a disabled tab at the row note, since no arrow key can reach it', () => {
    const wrapper = mount(NeFilterBar, {
      attachTo: document.body,
      props: { idPrefix: 'state', items, kind: 'tabs', label: 'State', note: 'Spend lands with the ledger' },
    })

    expect(controls(wrapper)[1]!.attributes('aria-describedby')).toBe('state-note')
    expect(wrapper.get('[data-ne-filter-note]').attributes('id')).toBe('state-note')
    // An enabled tab is reachable and needs no such pointer.
    expect(controls(wrapper)[0]!.attributes('aria-describedby')).toBeUndefined()
    wrapper.unmount()
  })

  it('describes nothing when the row states no note', () => {
    const wrapper = mount(NeFilterBar, {
      attachTo: document.body,
      props: { items, kind: 'tabs', label: 'State' },
    })
    expect(controls(wrapper)[1]!.attributes('aria-describedby')).toBeUndefined()
    wrapper.unmount()
  })
})
