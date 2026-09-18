// @vitest-environment happy-dom
/*
 * NeSortHeader, mounted (narduk-libs#528): the promoted stonx
 * `SortableTableHeader`. Server mode emits the wire sort; client mode drives a
 * TanStack column exactly as stonx did; `aria-sort` lands on the `<th>`.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { Component } from 'vue'

import NeSortHeader from '../src/runtime/components/NeSortHeader.vue'

function inHeaderCell(props: Record<string, unknown>) {
  const sort = ref<string | null>((props.sort as string | null | undefined) ?? null)
  const Host = defineComponent({
    setup: () => () =>
      h('table', [
        h('thead', [
          h('tr', [
            h('th', [
              h(NeSortHeader as Component, {
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
