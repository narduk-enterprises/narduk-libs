// @vitest-environment happy-dom
/*
 * NeAdminListPage, mounted — components backlog item 20 (narduk-libs#267).
 *
 * The page is composition: NePageHeader + NeSearchInput / filters + NeDataTable
 * + NePager, all reading ONE `useCollection()`. So this suite drives a REAL
 * `useCollection` over an in-memory route, not a stub: the claim under test is
 * that every control on the page writes to the same collection and that the
 * rows, the sort arrow and the pager summary all read back from it. The
 * behaviour of each piece (debounce, reflow, clamp) is already proven in its
 * own suite and is not repeated here.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, type Component, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeAdminListPage from '../src/runtime/components/NeAdminListPage.vue'
import { useCollection } from '../src/runtime/composables/use-collection'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type {
  NeAdminListPageProps,
  NeCollection,
  NeCollectionQuery,
  NeDataColumn,
} from '../src/index'

interface Runner {
  id: string
  name: string
  state: string
}

const RUNNERS: Runner[] = Array.from({ length: 60 }, (_, index) => ({
  id: `r${index + 1}`,
  name: `runner-${String(index + 1).padStart(2, '0')}`,
  state: index % 2 === 0 ? 'online' : 'offline',
}))

const columns: Array<NeDataColumn<Runner>> = [
  { key: 'name', label: 'Name', sortKey: 'name' },
  { key: 'state', label: 'State' },
]

const Blank: Component = defineComponent({ setup: () => () => h('div') })

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
  })
}

type Fetch = (query: NeCollectionQuery) => unknown

/** In-memory `listResponse`: filters by `q`, sorts by `name`, slices a page. */
function route(rows: readonly Runner[] = RUNNERS): Fetch {
  return (query) => {
    let items = [...rows]
    if (typeof query.q === 'string') items = items.filter((row) => row.name.includes(query.q!))
    if (query.sort === 'name:desc') items.reverse()
    return {
      items: items.slice(query.offset, query.offset + query.limit),
      limit: query.limit,
      offset: query.offset,
      q: query.q ?? null,
      sort: query.sort ?? null,
      total: items.length,
    }
  }
}

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function render(
  options: {
    fetch?: Fetch
    props?: Partial<NeAdminListPageProps<Runner>>
    slots?: Record<string, (scope: never) => VNode | VNode[] | string>
  } = {},
) {
  const fetch = vi.fn(options.fetch ?? route())
  let collection!: NeCollection<Runner>
  const Harness = defineComponent({
    setup() {
      collection = useCollection<Runner>({
        debounce: 0,
        fetch: (query) => fetch(query) as never,
        limit: 25,
        sortable: ['name'],
      })
      return () =>
        h(
          NeAdminListPage,
          {
            collection,
            columns,
            noun: 'runners',
            rowKey: (row: Runner) => row.id,
            title: 'Runners',
            ...options.props,
          } as never,
          options.slots,
        )
    },
  })
  const wrapper = mount(Harness, {
    attachTo: document.body,
    global: { components: nuxtUiStubs, plugins: [makeRouter()] },
  })
  mounted.push(wrapper)
  return { collection: () => collection, fetch, wrapper }
}

describe('NeAdminListPage: one collection drives the whole page', () => {
  it('renders the page title as the one h1, and the first page of rows in the table', async () => {
    const { wrapper } = render()
    await flushPromises()

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Runners')
    expect(wrapper.find('[data-ne-admin-list-page]').exists()).toBe(true)
    expect(wrapper.find('[data-ne-data-table]').exists()).toBe(true)
    expect(wrapper.text()).toContain('runner-01')
    expect(wrapper.text()).toContain('runner-25')
    expect(wrapper.text()).not.toContain('runner-26')
  })

  it("draws the pager from the same collection's state", async () => {
    const { wrapper } = render()
    await flushPromises()

    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('1–25 of 60 runners')
  })

  it("writes a header sort click to the collection's setSort, and draws what lands", async () => {
    const { collection, fetch, wrapper } = render()
    await flushPromises()

    await wrapper.get('[data-ne-sort-header] button').trigger('click')
    await flushPromises()

    expect(collection().sort).toBe('name:asc')
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name:asc' }))
    expect(wrapper.get('[data-ne-sort-header]').attributes('data-ne-sort-direction')).toBe('asc')
  })

  it('binds the built-in search to c.q, so a term refetches from page one', async () => {
    const { collection, fetch, wrapper } = render({ props: { searchLabel: 'Search runners' } })
    await flushPromises()
    collection().setPage(2)
    await flushPromises()

    const input = wrapper.get('[data-ne-search-input] input')
    expect(input.attributes('aria-label')).toBe('Search runners')
    await input.setValue('runner-0')
    await flushPromises()

    expect(collection().q).toBe('runner-0')
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, q: 'runner-0' }))
    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('1–9 of 9 runners')
  })

  it('renders no search field unless searchLabel names one', async () => {
    const { wrapper } = render()
    await flushPromises()

    expect(wrapper.find('[data-ne-search-input]').exists()).toBe(false)
  })

  it('renders the header actions beside the title and the filters in the toolbar', async () => {
    const { wrapper } = render({
      slots: {
        actions: () => h('button', { 'data-new': '', type: 'button' }, 'New runner'),
        filters: () => h('div', { 'data-filters': '' }, 'State: all'),
      },
    })
    await flushPromises()

    const heading = wrapper.get('h1')
    const action = wrapper.get('[data-new]')
    expect(
      heading.element.compareDocumentPosition(action.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(wrapper.get('[data-ne-admin-list-toolbar] [data-filters]').text()).toBe('State: all')
  })

  it('forwards a <key>-cell slot to the table with the row', async () => {
    const { wrapper } = render({
      slots: {
        'state-cell': ({ row }: { row: Runner }) =>
          h('span', { 'data-state-chip': row.id }, row.state.toUpperCase()),
      } as never,
    })
    await flushPromises()

    expect(wrapper.get('[data-state-chip="r1"]').text()).toBe('ONLINE')
    expect(wrapper.get('[data-state-chip="r2"]').text()).toBe('OFFLINE')
  })

  it('draws the empty panel, not an empty table, when the route answers with no rows', async () => {
    const { wrapper } = render({
      fetch: route([]),
      props: { emptyMessage: 'Add one to get started.', emptyTitle: 'No runners' },
    })
    await flushPromises()

    expect(wrapper.find('[data-ne-data-table]').exists()).toBe(false)
    expect(wrapper.get('[data-stub="UEmpty"]').text()).toContain('No runners')
    expect(wrapper.text()).toContain('Add one to get started.')
    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('No runners')
  })

  it('lets the empty slot replace the empty panel entirely', async () => {
    const { wrapper } = render({
      fetch: route([]),
      slots: { empty: () => h('p', { 'data-custom-empty': '' }, 'Register your first runner') },
    })
    await flushPromises()

    expect(wrapper.get('[data-custom-empty]').text()).toBe('Register your first runner')
    expect(wrapper.find('[data-stub="UEmpty"]').exists()).toBe(false)
  })

  it('draws the loading panel while the first page is in flight', async () => {
    const { wrapper } = render({
      fetch: () => new Promise(() => {}),
      props: { loadingTitle: 'Loading runners' },
    })
    await flushPromises()

    expect(wrapper.find('[data-ne-data-table]').exists()).toBe(false)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading runners')
  })

  it('draws the error panel when the first page fails, without stringifying the error', async () => {
    const { wrapper } = render({
      fetch: () => Promise.reject(new Error('D1_ERROR: secret detail')),
      props: { errorTitle: 'Runners did not load' },
    })
    await flushPromises()

    expect(wrapper.find('[data-ne-data-table]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Runners did not load')
    expect(wrapper.text()).not.toContain('secret detail')
  })

  it('moves the collection when the pager moves', async () => {
    const { collection, fetch, wrapper } = render()
    await flushPromises()

    const next = wrapper
      .findAll('[data-ne-pager] button')
      .find((button) => button.attributes('aria-label')?.toLowerCase().includes('next'))
    expect(next).toBeDefined()
    await next!.trigger('click')
    await flushPromises()

    expect(collection().page).toBe(2)
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }))
    expect(wrapper.text()).toContain('runner-26')
  })

  it('mounts directly on a collection the page created in its own scope', async () => {
    const scope = effectScope()
    const fetch = vi.fn(route())
    const collection = scope.run(() =>
      useCollection<Runner>({ debounce: 0, fetch: (query) => fetch(query) as never, limit: 25 }),
    )!
    const wrapper = mount(NeAdminListPage, {
      global: { components: nuxtUiStubs, plugins: [makeRouter()] },
      props: { collection, columns, noun: 'runners', title: 'Runners' } as never,
    })
    mounted.push(wrapper)
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.get('h1').text()).toBe('Runners')
    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('1–25 of 60 runners')
    scope.stop()
  })
})
