// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NeCursorPager from '../src/runtime/components/NeCursorPager.vue'
import type { NeCursorCollectionState } from '../src/runtime/composables/use-cursor-collection'

const state: NeCursorCollectionState<unknown> = { cursor: null, error: null, hasNext: true, hasPrevious: false, items: [1], limit: 1, nextCursor: 'older', pending: false, q: '', sort: null, total: null }
describe('NeCursorPager', () => {
  it('offers semantic older/newer navigation without inventing totals, and disables pending actions', async () => {
    const wrapper = mount(NeCursorPager, { props: { state } })
    expect(wrapper.text()).toContain('total unknown')
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Cursor pagination')
    const older = wrapper.findAll('button').find((button) => button.text() === 'Older')!
    await older.trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)
    await wrapper.setProps({ state: { ...state, pending: true } })
    expect(older.attributes('disabled')).toBeDefined()
    await wrapper.setProps({ state: { ...state, hasNext: false } })
    expect(wrapper.text()).toContain('End of results')
  })
})
