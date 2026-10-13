// @vitest-environment happy-dom
/*
 * NeSortHeader, mounted (narduk-libs#528): the promoted stonx
 * `SortableTableHeader`. Server mode emits the wire sort; client mode drives a
 * TanStack column exactly as stonx did; `aria-sort` lands on the `<th>`.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import NeSortHeader from '../src/runtime/components/NeSortHeader.vue'

import type { NeSortHeaderProps } from '../src/runtime/components/ne-data-table-types'

function inHeaderCell(props: NeSortHeaderProps) {
  const sort = ref<string | null>(props.sort ?? null)
  const Host = defineComponent({
    setup: () => () =>
      h('table', [
        h('thead', [
          h('tr', [
            h('th', [
              h(NeSortHeader, {
                ...props,
                sort: sort.value,
                'onUpdate:sort': (next: string) => {
                  sort.value = next
                },
              }),
            ]),
          ]),
        ]),
      ]),
  })
  return { sort, wrapper: mount(Host, { attachTo: document.body }) }
}

describe('NeSortHeader: server mode', () => {
  it('first click sorts the useful way, the second flips it, and never back to unsorted', async () => {
    const { sort, wrapper } = inHeaderCell({
      firstDirection: 'desc',
      label: 'Wind',
      sortKey: 'wind',
    })
    const button = () => wrapper.get('button')

    await button().trigger('click')
    expect(sort.value).toBe('wind:desc')
    await button().trigger('click')
    expect(sort.value).toBe('wind:asc')
    await button().trigger('click')
    expect(sort.value).toBe('wind:desc')
    wrapper.unmount()
  })

  it('takes the first direction again when another column was sorted', async () => {
    const { sort, wrapper } = inHeaderCell({ label: 'Station', sort: 'wind:desc', sortKey: 'name' })
    await wrapper.get('button').trigger('click')
    expect(sort.value).toBe('name:asc')
    wrapper.unmount()
  })

  it('writes aria-sort onto the th while sorted, and removes it at rest', async () => {
    const { sort, wrapper } = inHeaderCell({ label: 'Wind', sortKey: 'wind' })
    const th = wrapper.get('th')
    expect(th.attributes('aria-sort')).toBeUndefined()

    sort.value = 'wind:desc'
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(th.attributes('aria-sort')).toBe('descending')
    expect(wrapper.get('[data-ne-sort-header]').attributes('data-ne-sort-direction')).toBe('desc')

    sort.value = 'name:asc'
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(th.attributes('aria-sort')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows the unit, muted, beside the label', () => {
    const wrapper = mount(NeSortHeader, { props: { label: 'Wind', sortKey: 'wind', unit: 'kt' } })
    expect(wrapper.get('[data-ne-unit]').text()).toBe('kt')
    expect(wrapper.text()).toContain('Wind')
  })
})

describe('NeSortHeader: sort glyph', () => {
  // The icon renders as an Iconify <svg> with no name in the DOM, so a stub button reports the
  // `trailingIcon` it was given; that is the glyph the header chose.
  const ButtonStub = defineComponent({
    inheritAttrs: false,
    props: { trailingIcon: { type: String, default: undefined } },
    setup:
      (props, { attrs, slots }) =>
      () =>
        h('button', { ...attrs, 'data-trailing-icon': props.trailingIcon }, slots.default?.()),
  })
  const glyph = (props: NeSortHeaderProps) => {
    const wrapper = mount(NeSortHeader, { global: { stubs: { UButton: ButtonStub } }, props })
    const button = wrapper.get('button')
    return {
      icon: button.attributes('data-trailing-icon'),
      state: button.attributes('data-ne-sort'),
    }
  }

  it('draws the idle up-down glyph on an unsorted header, without aria-sort', () => {
    expect(glyph({ label: 'Wind', sortKey: 'wind' })).toEqual({
      icon: 'i-lucide-arrow-up-down',
      state: 'idle',
    })
    expect(glyph({ label: 'Wind', sort: 'name:asc', sortKey: 'wind' }).icon).toBe(
      'i-lucide-arrow-up-down',
    )
    const { wrapper } = inHeaderCell({ label: 'Wind', sortKey: 'wind' })
    expect(wrapper.get('th').attributes('aria-sort')).toBeUndefined()
    expect(wrapper.findAll('button svg[data-slot="trailingIcon"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('draws exactly one arrow on a sorted header', () => {
    expect(glyph({ label: 'Wind', sort: 'wind:desc', sortKey: 'wind' })).toEqual({
      icon: 'i-lucide-arrow-down',
      state: 'active',
    })
    expect(glyph({ label: 'Wind', sort: 'wind:asc', sortKey: 'wind' })).toEqual({
      icon: 'i-lucide-arrow-up',
      state: 'active',
    })
    const { wrapper } = inHeaderCell({ label: 'Wind', sort: 'wind:desc', sortKey: 'wind' })
    expect(wrapper.findAll('button svg[data-slot="trailingIcon"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('follows the sort when it moves to and from another column', async () => {
    const { sort, wrapper } = inHeaderCell({ label: 'Wind', sortKey: 'wind' })
    const button = () => wrapper.get('button')
    sort.value = 'wind:asc'
    await wrapper.vm.$nextTick()
    expect(button().attributes('data-ne-sort')).toBe('active')
    sort.value = 'name:asc'
    await wrapper.vm.$nextTick()
    expect(button().attributes('data-ne-sort')).toBe('idle')
    wrapper.unmount()
  })
})

describe('NeSortHeader: client mode (stonx call shape)', () => {
  it('drives a TanStack column through toggleSorting', async () => {
    let sorted: false | 'asc' | 'desc' = false
    const column = {
      getIsSorted: () => sorted,
      toggleSorting: vi.fn((desc?: boolean) => {
        sorted = desc ? 'desc' : 'asc'
      }),
    }
    const wrapper = mount(NeSortHeader, {
      props: { column, firstDirection: 'desc', label: 'Rank' },
    })

    await wrapper.get('button').trigger('click')
    expect(column.toggleSorting).toHaveBeenLastCalledWith(true)
    await wrapper.setProps({ column: { ...column } })
    await wrapper.get('button').trigger('click')
    expect(column.toggleSorting).toHaveBeenLastCalledWith(false)
    expect(wrapper.emitted('update:sort')).toBeUndefined()
  })
})
