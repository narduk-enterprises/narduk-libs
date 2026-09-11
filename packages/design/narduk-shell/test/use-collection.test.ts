/*
 * `useCollection()` behaviour contract — components backlog item 11
 * (narduk-libs#258).
 *
 * Every assertion here counts REQUESTS, not rendered rows. That is the whole
 * point of the file: a test that only checks the final list passes for an
 * implementation with no single-flight at all, no coalescing and no stale-scope
 * discard, because the last response to arrive happens to be the right one most
 * of the time. AGENTS.md § Simplicity Reflex → data-path performance asks for
 * the scaling shape to be proven in the repository, with the axes varied
 * independently; `deferredFetch` below is that instrument — it hands each call
 * back so a test can decide the arrival ORDER, which is the only way to make
 * "the stale one was discarded" observable.
 *
 * Runs in vitest's `node` environment (this package's default), with no DOM
 * anywhere: the state machine needs none. The `syncQuery` half needs a mounted
 * component, because `useRoute()`/`useRouter()` are injections, so it lives in
 * `use-collection.route-sync.test.ts` under happy-dom instead.
 */
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  LIST_QUERY_DEFAULT_LIMIT,
  LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH,
  type OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'

import {
  NE_COLLECTION_DEBOUNCE_MS,
  useCollection,
  type NeCollection,
  type NeCollectionOptions,
  type NeCollectionQuery,
} from '../src/runtime/composables/use-collection'

interface Runner {
  id: string
}

/** A `listResponse` page, built the way the contract's own helper builds one. */
function page(options: {
  items?: Runner[]
  limit?: number
  offset?: number
  q?: string | null
  sort?: string | null
  total?: number | null
}): OffsetListResponse<Runner> {
  const limit = options.limit ?? LIST_QUERY_DEFAULT_LIMIT
  return {
    items: options.items ?? [],
    limit,
    offset: options.offset ?? 0,
    q: options.q ?? null,
    sort: options.sort ?? null,
    total: options.total ?? null,
  }
}

const rows = (count: number, prefix = 'r'): Runner[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

/**
 * A fetch whose every call is resolved by hand.
 *
 * `calls[n].query` is exactly what the composable put on the wire for request
 * n, and `calls[n].resolve(...)` decides when — and in what order — request n
 * answers. Without that control, "the superseded response was discarded" is
 * untestable: a fetch that resolves in call order can never produce the race.
 */
function deferredFetch() {
  const calls: Array<{
    query: NeCollectionQuery
    reject: (cause: unknown) => void
    resolve: (value: OffsetListResponse<Runner>) => void
    signal: AbortSignal
  }> = []

  const fetch = vi.fn((query: NeCollectionQuery, context: { signal: AbortSignal }) => {
    return new Promise<OffsetListResponse<Runner>>((resolve, reject) => {
      calls.push({ query, reject, resolve, signal: context.signal })
    })
  })

  return { calls, fetch }
}

/**
 * Runs the composable inside a real effect scope so its watchers and
 * `onScopeDispose` behave as they do in a component, and returns a `stop()`.
 */
function withCollection<TItem, TRaw>(
  options: NeCollectionOptions<TItem, TRaw>,
): { collection: NeCollection<TItem>; stop: () => void } {
  const scope = effectScope()
  const collection = scope.run(() => useCollection(options))!
  return { collection, stop: () => scope.stop() }
}

/** Lets every already-resolved microtask and every watcher flush. */
async function settle(times = 4): Promise<void> {
  for (let index = 0; index < times; index++) await nextTick()
}

describe('the wire query', () => {
  it('sends the contract keys, and omits q and sort rather than sending null', async () => {
    const { calls, fetch } = deferredFetch()
    const { stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    expect(fetch).toHaveBeenCalledTimes(1)
    // `.strict()` + `z.string()` means a literal null on the wire is a 400,
    // not "no search". Absence is the only way to say "no search".
    expect(calls[0]!.query).toEqual({ limit: LIST_QUERY_DEFAULT_LIMIT, offset: 0 })
    expect('q' in calls[0]!.query).toBe(false)
    expect('sort' in calls[0]!.query).toBe(false)
    stop()
  })

  it('defaults limit to the contract constant rather than a number of its own', async () => {
    const { calls, fetch } = deferredFetch()
    const { stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    expect(calls[0]!.query.limit).toBe(LIST_QUERY_DEFAULT_LIMIT)
    stop()
  })

  it('turns page into the contract offset', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 20,
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(20), limit: 20, total: 200 }))
    await settle()

    collection.setPage(4)
    await settle()

    expect(calls[1]!.query).toEqual({ limit: 20, offset: 60 })
    stop()
  })

  it('flattens filters alongside the reserved keys', async () => {
    const { calls, fetch } = deferredFetch()
    const { stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      filters: () => ({ state: 'idle' }),
      sort: 'name:asc',
      sortable: ['name'],
    })
    await settle()

    expect(calls[0]!.query).toEqual({
      limit: LIST_QUERY_DEFAULT_LIMIT,
      offset: 0,
      sort: 'name:asc',
      state: 'idle',
    })
    stop()
  })

  it('refuses a filter that collides with a reserved key instead of dropping it', async () => {
    // A silently ignored filter reads to the caller as "nothing narrowed the
    // page" and hands back the wrong rows — the exact bug class item 10's
    // contract exists to remove, so the client half must not reintroduce it.
    const { fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      filters: () => ({ limit: 5 }),
    })
    await settle()

    expect(fetch).not.toHaveBeenCalled()
    expect(String(collection.error)).toContain('collide with reserved list-query keys: limit')
    stop()
  })

  it('clamps q to the contract maximum length', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      debounce: 0,
      fetch,
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()

    collection.q = 'x'.repeat(LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH + 50)
    await settle()

    expect(String(calls[1]!.query.q)).toHaveLength(LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH)
    stop()
  })
})

describe('single-flight', () => {
  it('coalesces every trigger that arrives during a flight into ONE follow-up', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      debounce: 0,
      fetch,
      limit: 10,
    })
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)

    // Four more triggers while request 1 is still unresolved.
    collection.setPage(2)
    collection.setPage(3)
    collection.setSort('name:asc')
    collection.q = 'gtm'
    await settle()

    // The count is the assertion. A queue-per-trigger implementation is at
    // five here; a fire-and-forget one is at five too, and both render the
    // same final list.
    expect(fetch).toHaveBeenCalledTimes(1)

    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 100 }))
    await settle()

    expect(fetch).toHaveBeenCalledTimes(2)
    // One follow-up, carrying the LATEST intent, not a replay of each trigger.
    expect(calls[1]!.query).toEqual({ limit: 10, offset: 0, q: 'gtm', sort: 'name:asc' })

    calls[1]!.resolve(page({ items: rows(10, 'q'), limit: 10, total: 30, q: 'gtm' }))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
    stop()
  })

  it('never has two requests unresolved at the same time', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      debounce: 0,
      fetch,
      limit: 10,
    })
    await settle()

    for (let index = 2; index <= 6; index++) {
      collection.setPage(index)
      await settle()
      // Each round-trip: exactly one outstanding call, whatever happened while
      // it was in flight.
      const outstanding = calls.length - calls.filter((call) => call.signal.aborted).length
      expect(outstanding).toBeLessThanOrEqual(1)
    }

    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })

  it('aborts the superseded request rather than merely ignoring its answer', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    expect(calls[0]!.signal.aborted).toBe(false)
    collection.setPage(5)
    await settle()

    expect(calls[0]!.signal.aborted).toBe(true)
    stop()
  })
})

describe('stale-scope cancellation', () => {
  it('discards a superseded response instead of rendering it for a frame', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 5,
    })
    await settle()

    // Supersede request 1, THEN answer it. Without a scope token the stale
    // page is applied here and the reader watches the list flash page one.
    collection.setPage(3)
    await settle()

    const seen: string[][] = []
    const record = (): void => {
      seen.push(collection.items.map((item) => item.id))
    }

    calls[0]!.resolve(page({ items: rows(5, 'stale'), limit: 5, offset: 0, total: 50 }))
    await settle()
    record()

    calls[1]!.resolve(page({ items: rows(5, 'fresh'), limit: 5, offset: 10, total: 50 }))
    await settle()
    record()

    // The stale ids are never observed, at any point — not "eventually
    // replaced", which is what a list-only assertion would have accepted.
    expect(seen[0]).toEqual([])
    expect(seen[1]).toEqual(rows(5, 'fresh').map((item) => item.id))
    expect(collection.page).toBe(3)
    stop()
  })

  it('discards a superseded FAILURE too, so a dead request cannot set the error', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    collection.setPage(2)
    await settle()
    calls[0]!.reject(new Error('the page nobody is looking at any more'))
    await settle()

    expect(collection.error).toBeNull()
    calls[1]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()
    expect(collection.error).toBeNull()
    stop()
  })

  it('keeps the last good page on screen when a live request fails', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    calls[0]!.resolve(page({ items: rows(3, 'good'), total: 3 }))
    await settle()

    void collection.refresh()
    await settle()
    calls[1]!.reject(new Error('upstream is down'))
    await settle()

    expect(collection.items.map((item) => item.id)).toEqual(rows(3, 'good').map((item) => item.id))
    expect(String(collection.error)).toContain('upstream is down')
    expect(collection.pending).toBe(false)
    stop()
  })
})

describe('debounced q', () => {
  it('issues one request for a word, not one per keystroke', async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetch } = deferredFetch()
      const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
      await settle()
      calls[0]!.resolve(page({ items: rows(3), total: 3 }))
      await settle()
      expect(fetch).toHaveBeenCalledTimes(1)

      for (const value of ['G', 'GT', 'GTM', 'GTM1', 'GTM15', 'GTM150', 'GTM1500']) {
        collection.q = value
        vi.advanceTimersByTime(20)
      }
      await settle()

      // Seven keystrokes inside the window; still one request, and it has not
      // been issued yet.
      expect(fetch).toHaveBeenCalledTimes(1)
      // The input is live for the search box even though nothing was sent.
      expect(collection.q).toBe('GTM1500')

      vi.advanceTimersByTime(NE_COLLECTION_DEBOUNCE_MS)
      await settle()

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(calls[1]!.query.q).toBe('GTM1500')
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not re-fetch when the debounce settles on the value already applied', async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetch } = deferredFetch()
      const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
      await settle()
      calls[0]!.resolve(page({ items: rows(3), total: 3 }))
      await settle()

      collection.q = 'abc'
      vi.advanceTimersByTime(NE_COLLECTION_DEBOUNCE_MS)
      await settle()
      calls[1]!.resolve(page({ items: rows(1), total: 1, q: 'abc' }))
      await settle()
      expect(fetch).toHaveBeenCalledTimes(2)

      // Typed and undone inside one window.
      collection.q = 'abcd'
      collection.q = 'abc'
      vi.advanceTimersByTime(NE_COLLECTION_DEBOUNCE_MS)
      await settle()

      expect(fetch).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('page resets to 1 — the search-after-page bug, removed by construction', () => {
  const onPage = async (
    pageNumber: number,
  ): Promise<{
    calls: ReturnType<typeof deferredFetch>['calls']
    collection: NeCollection<Runner>
    fetch: ReturnType<typeof deferredFetch>['fetch']
    stop: () => void
  }> => {
    const { calls, fetch } = deferredFetch()
    const filters = { state: 'idle' }
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      debounce: 0,
      fetch,
      filters: () => filters,
      limit: 10,
      sortable: ['name', 'updatedAt'],
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()
    collection.setPage(pageNumber)
    await settle()
    calls[1]!.resolve(
      page({ items: rows(10), limit: 10, offset: (pageNumber - 1) * 10, total: 500 }),
    )
    await settle()
    return { calls, collection, fetch, stop }
  }

  it('resets when q changes', async () => {
    const { calls, collection, stop } = await onPage(12)
    expect(collection.page).toBe(12)

    collection.q = 'gtm'
    await settle()

    expect(collection.page).toBe(1)
    expect(calls.at(-1)!.query.offset).toBe(0)
    stop()
  })

  it('resets when sort changes', async () => {
    const { calls, collection, stop } = await onPage(12)

    collection.setSort('updatedAt:desc')
    await settle()

    expect(collection.page).toBe(1)
    expect(calls.at(-1)!.query).toEqual({
      limit: 10,
      offset: 0,
      sort: 'updatedAt:desc',
      state: 'idle',
    })
    stop()
  })

  it('resets when limit changes', async () => {
    const { calls, collection, stop } = await onPage(12)

    collection.setLimit(50)
    await settle()

    expect(collection.page).toBe(1)
    expect(calls.at(-1)!.query.limit).toBe(50)
    expect(calls.at(-1)!.query.offset).toBe(0)
    stop()
  })

  it('does not refetch when a filters getter rebuilds an equal object', async () => {
    // The normal way to write a filters getter rebuilds its object literal on
    // every evaluation. Comparing by reference would refetch forever; the work
    // has to be bounded to filter sets that actually differ.
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      // Key order deliberately unstable between evaluations.
      filters: () => (Math.random() > 0.5 ? { a: 1, b: 2 } : { b: 2, a: 1 }),
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()

    for (let index = 0; index < 20; index++) {
      // Read the snapshot the way a template would, forcing re-evaluation.
      expect(collection.state.filters).toEqual({ a: 1, b: 2 })
      await settle(1)
    }

    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('reactive filters', () => {
  it('resets to page one and refetches when the filter set really changes', async () => {
    const { calls, fetch } = deferredFetch()
    const filters = ref<Record<string, unknown>>({ status: 'idle' })
    const scope = effectScope()
    const collection = scope.run(() => useCollection<Runner>({ fetch, filters, limit: 10 }))!
    await settle()
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()
    collection.setPage(7)
    await settle()
    calls[1]!.resolve(page({ items: rows(10), limit: 10, offset: 60, total: 500 }))
    await settle()
    expect(collection.page).toBe(7)

    filters.value = { status: 'busy' }
    await settle()

    expect(collection.page).toBe(1)
    expect(calls[2]!.query).toEqual({ limit: 10, offset: 0, status: 'busy' })
    expect(fetch).toHaveBeenCalledTimes(3)
    scope.stop()
  })
})

describe('clamping', () => {
  it('clamps limit to maxLimit before it reaches the wire', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 5000,
      maxLimit: 100,
    })
    await settle()

    expect(calls[0]!.query.limit).toBe(100)
    collection.setLimit(0)
    await settle()
    expect(collection.state.limit).toBe(1)
    stop()
  })

  it('adopts the limit and offset the route actually served', async () => {
    // The route's own `maxLimit` is the real ceiling and only it knows the
    // number. `listResponse` echoes what it used, so the pager shows the page
    // the reader is really on rather than the one the client hoped for.
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 500,
    })
    await settle()
    expect(calls[0]!.query.limit).toBe(500)

    calls[0]!.resolve(page({ items: rows(100), limit: 100, offset: 0, total: 1000 }))
    await settle()

    expect(collection.state.limit).toBe(100)
    expect(collection.pageCount).toBe(10)
    // Adopting the echo must not itself trigger another request.
    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })

  it('lands on the new last page when a delete empties the one being viewed', async () => {
    // pacc-trac's clampPagedOffset, as a request count: 26 rows at limit 25,
    // reader on page 2, the last row is resolved. The refresh answers with an
    // empty page 2 and a total of 25 — exactly ONE more request puts the
    // reader on page 1, and `26–25 of 25` is never rendered.
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    calls[0]!.resolve(page({ items: rows(25), offset: 0, total: 26 }))
    await settle()

    collection.setPage(2)
    await settle()
    calls[1]!.resolve(page({ items: rows(1), offset: 25, total: 26 }))
    await settle()
    expect(collection.page).toBe(2)

    void collection.refresh()
    await settle()
    calls[2]!.resolve(page({ items: [], offset: 25, total: 25 }))
    await settle()

    expect(collection.page).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(calls[3]!.query.offset).toBe(0)

    calls[3]!.resolve(page({ items: rows(25), offset: 0, total: 25 }))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(4)
    stop()
  })

  it('clamps an out-of-range URL page in one extra request, not a walk', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    collection.setPage(999)
    await settle()
    calls[0]!.resolve(page({ items: rows(25), total: 60 }))
    await settle()
    calls[1]!.resolve(page({ items: [], offset: 24_950, total: 60 }))
    await settle()

    expect(collection.page).toBe(3)
    expect(fetch).toHaveBeenCalledTimes(3)
    stop()
  })

  it('falls back to page one for an uncounted route that lands empty', async () => {
    // `total: null` is `listResponse`'s DEFAULT, so this is the common path.
    // Without a count there is no way to know the last page that still has a
    // row, and walking back one page at a time is O(page) requests — page one
    // is the only page always in range, so it costs exactly one.
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    calls[0]!.resolve(page({ items: rows(25), total: null }))
    await settle()

    collection.setPage(4)
    await settle()
    calls[1]!.resolve(page({ items: [], offset: 75, total: null }))
    await settle()

    expect(collection.page).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(3)
    stop()
  })

  it('leaves an empty FIRST page alone — an empty collection is not a clamp', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    calls[0]!.resolve(page({ items: [], offset: 0, total: 0 }))
    await settle()

    expect(collection.page).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(collection.state.pageCount).toBe(1)
    stop()
  })
})

describe('hasNext / hasPrevious', () => {
  it('answers exactly for a counted route', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 10,
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(10), limit: 10, offset: 0, total: 25 }))
    await settle()

    expect(collection.canPrevious).toBe(false)
    expect(collection.canNext).toBe(true)

    collection.setPage(3)
    await settle()
    calls[1]!.resolve(page({ items: rows(5), limit: 10, offset: 20, total: 25 }))
    await settle()

    expect(collection.canPrevious).toBe(true)
    expect(collection.canNext).toBe(false)
    stop()
  })

  it('reads a short page as the end for an uncounted route', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 10,
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: null }))
    await settle()
    expect(collection.canNext).toBe(true)

    collection.setPage(2)
    await settle()
    calls[1]!.resolve(page({ items: rows(4), limit: 10, offset: 10, total: null }))
    await settle()
    expect(collection.canNext).toBe(false)
    stop()
  })
})

describe('the state model', () => {
  it('applies page and NOTHING else, so a control cannot bypass the page reset', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 10,
      sortable: ['name'],
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(10), limit: 10, total: 500 }))
    await settle()

    collection.state = { ...collection.state, limit: 999, page: 4, q: 'smuggled', sort: 'name:asc' }
    await settle()

    expect(collection.page).toBe(4)
    expect(collection.state.limit).toBe(10)
    expect(collection.state.q).toBe('')
    expect(collection.state.sort).toBeNull()
    expect(calls[1]!.query).toEqual({ limit: 10, offset: 30 })
    stop()
  })

  it('exposes the offset it actually sent', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      limit: 25,
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(25), total: 100 }))
    await settle()
    collection.setPage(3)
    await settle()

    expect(collection.state.offset).toBe(50)
    expect(calls[1]!.query.offset).toBe(50)
    stop()
  })
})

describe('sortable allowlist', () => {
  it('refuses a sort the route does not accept, rather than letting it 400', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      sortable: ['name'],
    })
    await settle()
    calls[0]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()

    collection.setSort('secretColumn:asc')
    await settle()

    expect(collection.sort).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })

  it('refuses a malformed sort even with no allowlist', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()
    calls[0]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()

    collection.setSort('name:sideways')
    await settle()

    expect(collection.sort).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('adapter and enabled', () => {
  it('reads a non-contract response through the adapter', async () => {
    const calls: Array<(value: { records: Runner[]; count: number }) => void> = []
    const fetch = vi.fn(
      () => new Promise<{ records: Runner[]; count: number }>((resolve) => calls.push(resolve)),
    )
    const { collection, stop } = withCollection<Runner, { records: Runner[]; count: number }>({
      adapter: (raw) => page({ items: raw.records, total: raw.count }),
      fetch,
    })
    await settle()
    calls[0]!({ count: 2, records: rows(2, 'legacy') })
    await settle()

    expect(collection.items.map((item) => item.id)).toEqual(['legacy0', 'legacy1'])
    expect(collection.total).toBe(2)
    stop()
  })

  it('fails loudly rather than showing an empty list when a response is not a list response', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({ rows: [] } as unknown as OffsetListResponse<Runner>),
    )
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    expect(String(collection.error)).toContain('not a list-query `listResponse`')
    stop()
  })

  it('sends nothing while disabled, then fetches by itself the moment it is enabled', async () => {
    const enabled = ref(false)
    const { calls, fetch } = deferredFetch()
    const scope = effectScope()
    const collection = scope.run(() => useCollection<Runner>({ enabled, fetch }))!
    await settle()

    expect(fetch).not.toHaveBeenCalled()
    expect(collection.pending).toBe(false)

    enabled.value = true
    await settle()

    expect(fetch).toHaveBeenCalledTimes(1)
    calls[0]!.resolve(page({ items: rows(3), total: 3 }))
    await settle()
    expect(collection.items).toHaveLength(3)
    scope.stop()
  })
})

describe('refresh()', () => {
  it('resolves only once the collection has settled, including a clamp refetch', async () => {
    const { calls, fetch } = deferredFetch()
    const { collection, stop } = withCollection<Runner, OffsetListResponse<Runner>>({
      fetch,
      immediate: false,
    })
    expect(fetch).not.toHaveBeenCalled()

    collection.setPage(5)
    let settled = false
    const done = collection.refresh().then(() => {
      settled = true
      return settled
    })
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    // Page five of a forty-row collection does not exist. The clamp costs
    // exactly one more request, and `refresh()` must not resolve until that
    // one has landed too — an SSR `await c.refresh()` that returned here would
    // serialise an empty page.
    calls[0]!.resolve(page({ items: [], limit: 25, offset: 100, total: 40 }))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(settled).toBe(false)

    calls[1]!.resolve(page({ items: rows(15), limit: 25, offset: 25, total: 40 }))
    await settle()
    await done
    expect(settled).toBe(true)
    expect(collection.page).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
    stop()
  })

  it('disposes its timer and aborts the live request when the scope ends', async () => {
    const { calls, fetch } = deferredFetch()
    const { stop } = withCollection<Runner, OffsetListResponse<Runner>>({ fetch })
    await settle()

    expect(calls[0]!.signal.aborted).toBe(false)
    stop()
    expect(calls[0]!.signal.aborted).toBe(true)
  })
})
