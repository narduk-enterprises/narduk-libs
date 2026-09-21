// @vitest-environment happy-dom
/*
 * `useCollection({ syncQuery: true })` — the route half of the contract
 * (components backlog item 11, narduk-libs#258).
 *
 * Split from `use-collection.test.ts` because these cases MOUNT a component:
 * `useRoute()` / `useRouter()` are injections, so the composable has to run
 * inside a real component instance with a real router installed, and
 * `@vue/test-utils` needs a document for that. The composable itself still
 * needs no DOM — the state-machine file next door proves that in vitest's node
 * environment.
 *
 * The router here is a real `vue-router` memory history, not a stub. A stubbed
 * `replace()` cannot show a navigation loop, and the loop is the thing being
 * ruled out: every case counts both `router.replace` calls AND requests.
 */
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import type { OffsetListResponse } from '@narduk-enterprises/narduk-platform/list-query'
import { LIST_QUERY_DEFAULT_LIMIT } from '@narduk-enterprises/narduk-platform/list-query'

import {
  useCollection,
  type NeCollection,
  type NeCollectionOptions,
  type NeCollectionQuery,
} from '../src/runtime/composables/use-collection'

interface Runner {
  id: string
}

function page(options: {
  items?: Runner[]
  limit?: number
  offset?: number
  total?: number | null
}): OffsetListResponse<Runner> {
  return {
    items: options.items ?? [],
    limit: options.limit ?? LIST_QUERY_DEFAULT_LIMIT,
    offset: options.offset ?? 0,
    q: null,
    sort: null,
    total: options.total ?? null,
  }
}

const rows = (count: number, prefix = 'r'): Runner[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

function deferredFetch() {
  const calls: Array<{
    query: NeCollectionQuery
    resolve: (value: OffsetListResponse<Runner>) => void
  }> = []
  const fetch = vi.fn(
    (query: NeCollectionQuery) =>
      new Promise<OffsetListResponse<Runner>>((resolve) => {
        calls.push({ query, resolve })
      }),
  )
  return { calls, fetch }
}

/*
 * `router.replace()` is a real asynchronous navigation — the guard queue, then
 * the history entry — so draining microtasks alone shows the call but not the
 * new URL. `flushPromises()` also drains the macrotask, which is the gap a
 * browser's address bar lives in. Looping it lets a request that lands, a
 * route write and a coalesced follow-up all resolve in one `await`.
 */
async function settle(times = 3): Promise<void> {
  for (let index = 0; index < times; index++) {
    await flushPromises()
    await nextTick()
  }
}

describe('syncQuery', () => {
  const mountWithRouter = async (
    options: Omit<NeCollectionOptions<Runner, OffsetListResponse<Runner>>, 'syncQuery'>,
    initialUrl = '/runners',
  ): Promise<{ collection: NeCollection<Runner>; router: Router; unmount: () => void }> => {
    const Blank: Component = defineComponent({ setup: () => () => h('div') })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
    })
    await router.push(initialUrl)
    await router.isReady()

    let collection!: NeCollection<Runner>
    const wrapper = mount(
      defineComponent({
        setup() {
          collection = useCollection<Runner>({ ...options, syncQuery: true })
          return () => h('div')
        },
      }),
      { global: { plugins: [router] } },
    )
    await settle()
    return { collection, router, unmount: () => wrapper.unmount() }
  }

  it('reads page, q and sort out of the URL before the first request', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, unmount } = await mountWithRouter(
      { fetch, limit: 10, sortable: ['name'] },
      '/runners?page=3&q=gtm&sort=name%3Aasc',
    )

    // ONE request, already for page three. A composable that fetched page one
    // and then corrected itself would be at two here.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(calls[0]!.query).toEqual({ limit: 10, offset: 20, q: 'gtm', sort: 'name:asc' })
    expect(collection.q).toBe('gtm')
    unmount()
  })

  it('writes page, q and sort back without a navigation loop', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, router, unmount } = await mountWithRouter({ fetch, limit: 10 })
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()

    const replace = vi.spyOn(router, 'replace')
    collection.setPage(4)
    await settle()

    // One navigation, one request. A loop shows up here as either number
    // climbing, which is why both are asserted and not just the URL.
    expect(replace).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.query.page).toBe('4')
    expect(fetch).toHaveBeenCalledTimes(2)

    calls[1]!.resolve(page({ items: rows(10), limit: 10, offset: 30, total: 500 }))
    await settle()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    replace.mockRestore()
    unmount()
  })

  it('omits the defaults, so page one has exactly one canonical URL', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, router, unmount } = await mountWithRouter(
      { fetch, limit: 10 },
      '/runners?page=3&keep=me',
    )
    calls[0]!.resolve(page({ items: rows(10), limit: 10, offset: 20, total: 500 }))
    await settle()

    collection.setPage(1)
    await settle()

    // `?page=1` and `?` are the same page; two URLs for it is a duplicate for
    // a crawler, and this pager exists to be crawled.
    expect('page' in router.currentRoute.value.query).toBe(false)
    // Query keys the collection does not own are left exactly as they were.
    expect(router.currentRoute.value.query.keep).toBe('me')
    unmount()
  })

  it('follows a browser back into ?q=…&page=… without losing the page', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, router, unmount } = await mountWithRouter({
      debounce: 0,
      fetch,
      limit: 10,
      sortable: ['name'],
    })
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()

    await router.push('/runners?q=gtm&page=3')
    await settle()

    // `q` resets the page, so a naive reader applies q, resets to 1, and the
    // URL's own page is lost. The order the collection applies them in is what
    // makes the back button work.
    expect(collection.page).toBe(3)
    expect(collection.q).toBe('gtm')
    expect(calls.at(-1)!.query).toEqual({ limit: 10, offset: 20, q: 'gtm' })
    unmount()
  })

  it('drops a URL sort the route does not accept instead of sending it', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, unmount } = await mountWithRouter(
      { fetch, limit: 10, sortable: ['name'] },
      '/runners?sort=passwordHash%3Aasc',
    )

    expect(collection.sort).toBeNull()
    expect('sort' in calls[0]!.query).toBe(false)
    unmount()
  })

  it('clamps a route-driven page to a pageCount already known from a landed response (#288)', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, router, unmount } = await mountWithRouter({ fetch, limit: 10 })
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()

    // pageCount is now known: ceil(500 / 10) = 50. A stale or hand-edited
    // URL beyond it -- a Back into an older history entry, say -- should
    // clamp the same way setPage() already does, not send the raw offset
    // the client already knows is out of range.
    await router.push('/runners?page=999')
    await settle()

    expect(collection.page).toBe(50)
    expect(calls.at(-1)!.query).toEqual({ limit: 10, offset: 490 })
    unmount()
  })
})
