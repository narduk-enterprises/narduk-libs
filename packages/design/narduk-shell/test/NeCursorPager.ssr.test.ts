import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import NeCursorPager from '../src/runtime/components/NeCursorPager.vue'
import type { NeCursorCollectionState } from '../src/runtime/composables/use-cursor-collection'

const state: NeCursorCollectionState<unknown> = {
  cursor: null,
  error: null,
  hasNext: false,
  hasPrevious: false,
  items: [],
  limit: 25,
  nextCursor: null,
  pending: false,
  q: '',
  sort: null,
  total: null,
}
describe('NeCursorPager SSR', () => {
  it('renders accessible native controls and an honest unknown total without a router or browser', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(NeCursorPager, { state }) }))
    expect(html).toContain('aria-label="Cursor pagination"')
    expect(html).toContain('total unknown')
    expect(html).toContain('End of results')
    expect(html.match(/ disabled/g)).toHaveLength(3)
  })
  it('does not call a failed read exhausted', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(NeCursorPager, { state: { ...state, error: new Error('unavailable') } }),
      }),
    )
    expect(html).not.toContain('End of results')
  })
})
