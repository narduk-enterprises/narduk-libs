/*
 * Server-render proof for NeAdminListPage — components backlog item 20
 * (narduk-libs#267). Runs in vitest's `node` environment with no DOM.
 *
 * The header, the rows and the pager summary have to be in the first paint:
 * an admin list that server-renders an empty shell and fills in on hydration
 * is a layout shift on every visit. No router and no `:to` here, the same
 * constraint `NeCardList.ssr.test.ts` documents.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h, reactive } from 'vue'

import NeAdminListPage from '../src/runtime/components/NeAdminListPage.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeCollection, NeCollectionState, NeDataColumn } from '../src/index'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

interface Runner {
  id: string
  name: string
}

const columns: Array<NeDataColumn<Runner>> = [{ key: 'name', label: 'Name', sortKey: 'name' }]

function collection(over: Partial<NeCollectionState<Runner>> = {}): NeCollection<Runner> {
  const state: NeCollectionState<Runner> = {
    error: null,
    filters: {},
    hasNext: true,
    hasPrevious: false,
    items: [
      { id: 'r1', name: 'runner-01' },
      { id: 'r2', name: 'runner-02' },
    ],
    limit: 2,
    offset: 0,
    page: 1,
    pageCount: 3,
    pending: false,
    q: '',
    sort: 'name:asc',
    total: 6,
    ...over,
  }
  return reactive({
    canNext: state.hasNext,
    canPrevious: state.hasPrevious,
    error: state.error,
    items: state.items,
    page: state.page,
    pageCount: state.pageCount,
    pending: state.pending,
    q: state.q,
    refresh: async () => {},
    setLimit: () => {},
    setPage: () => {},
    setSort: () => {},
    sort: state.sort,
    state,
    total: state.total,
  }) as NeCollection<Runner>
}

async function render(props: Record<string, unknown>) {
  const app = createSSRApp({
    render: () =>
      h(NeAdminListPage, {
        columns,
        noun: 'runners',
        title: 'Runners',
        ...props,
      } as never),
  })
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  return renderToString(app)
}

describe('server rendering without a DOM', () => {
  it('renders the header, the search, the rows and the pager summary', async () => {
    const html = await render({ collection: collection(), searchLabel: 'Search runners' })

    expect(html).toContain('data-ne-admin-list-page')
    expect(html).toContain('<h1')
    expect(html).toContain('Runners')
    expect(html).toContain('aria-label="Search runners"')
    expect(html).toContain('runner-01')
    expect(html).toContain('runner-02')
    expect(html).toContain('data-ne-sort-direction="asc"')
    expect(html).toContain('1–2 of 6 runners')
  })

  it('renders the empty panel for a collection with no rows', async () => {
    const html = await render({
      collection: collection({ hasNext: false, items: [], pageCount: 1, total: 0 }),
      emptyTitle: 'No runners',
    })

    expect(html).not.toContain('data-ne-data-table')
    expect(html).toContain('No runners')
  })
})
