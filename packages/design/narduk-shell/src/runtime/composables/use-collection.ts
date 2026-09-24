/**
 * `useCollection<T>()` — the estate's one paged-list state machine (components
 * backlog item 11, narduk-libs#258).
 *
 * Pagination is in nine apps and eleven pagers, and every one of them
 * hand-rolls the same five decisions. They get them wrong in the same five
 * ways, which is why this file is a state machine with a behaviour contract
 * rather than a `ref(page)` and a `watch`:
 *
 * 1. **Single-flight.** One request is in flight at a time. Triggers that
 *    arrive during a flight coalesce into exactly ONE follow-up request, not
 *    one per trigger. Typing four characters into a search box that is already
 *    loading issues two requests total, never five.
 * 2. **Stale-scope cancellation.** A response whose query is no longer the
 *    current one is DISCARDED, never rendered. Without this the coalesced
 *    follow-up still paints the superseded page first, and the reader watches
 *    the list flash the wrong rows. The superseded request is aborted through
 *    its `AbortSignal` as well, so the work stops rather than merely being
 *    ignored.
 * 3. **Debounced `q`.** A keystroke does not issue a request; the debounce
 *    window (250ms, pacc-trac's measured number) does.
 * 4. **`page` resets to 1 whenever `q`, a filter, `sort` or `limit` changes.**
 *    This is stonx#219 / #218 / #5 — "search after page" — removed by
 *    construction rather than by remembering to reset in eleven call sites.
 * 5. **`page` is clamped on the response that lands.** Deleting the last row
 *    of page two must land the reader on the new last page, not on an empty
 *    one (pacc-trac's `clampPagedOffset`). Only a page that LANDED may clamp:
 *    clamping on a failed request rewound page three to page one on every
 *    transient error there, and the retry then fetched a page nobody asked for.
 *
 * The wire shape is `@narduk-enterprises/narduk-platform/list-query` (item 10,
 * narduk-libs#257) and this file does not redefine it: the request keys, the
 * default page size and the maximum `q` length are imported from the contract,
 * and the response is read as the contract's `OffsetListResponse<T>`.
 *
 * Offset mode only, deliberately. The contract also has a cursor mode, but a
 * cursor collection cannot answer "how many pages are there", so it needs a
 * different control from the page-numbered `NePager` this item ships with.
 * Adding it here would double the state machine for a consumer that does not
 * exist in the three pilots. See the README's "Not cursor mode" note.
 */
import {
  computed,
  onScopeDispose,
  reactive,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  LIST_QUERY_DEFAULT_LIMIT,
  LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH,
  LIST_QUERY_RESERVED_KEYS,
  type ListSortDirection,
  type OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'

import type { LocationQuery, LocationQueryRaw, RouteLocationNormalizedLoaded } from 'vue-router'

export type { ListSortDirection }

/** Debounce applied to `q`. pacc-trac's number: one request for "GTM1500". */
export const NE_COLLECTION_DEBOUNCE_MS = 250

/** The route-query keys `syncQuery: true` owns. Everything else is untouched. */
export const NE_COLLECTION_SYNCED_KEYS = ['page', 'q', 'sort'] as const

/**
 * The query handed to `fetch`, already in the contract's wire shape.
 *
 * `q` and `sort` are OMITTED rather than sent as `null` when they are unset:
 * the contract's schema is `.strict()` over `z.string()`, so a literal `null`
 * on the wire is a 400, not an empty search.
 */
export interface NeCollectionQuery {
  [filter: string]: unknown
  limit: number
  offset: number
  q?: string
  sort?: string
}

/** Second argument to `fetch`, so a caller can forward the abort signal. */
export interface NeCollectionFetchContext {
  /** Aborted when this request is superseded by a newer one. */
  signal: AbortSignal
}

/**
 * One immutable reading of the collection. `NePager` takes this as its
 * `v-model:state` and a data table will take the same object.
 */
export interface NeCollectionState<TItem> {
  /** The last request's failure, or `null`. Items keep the last good page. */
  error: unknown
  /** The filter set that produced this page, already on the wire. */
  filters: Readonly<Record<string, unknown>>
  /** Whether a next page is known (or, for an uncounted route, likely). */
  hasNext: boolean
  hasPrevious: boolean
  items: readonly TItem[]
  limit: number
  /** `(page - 1) * limit`, the value actually sent. */
  offset: number
  /** 1-based. */
  page: number
  /** `null` when the route does not count (`total: null`). */
  pageCount: number | null
  pending: boolean
  /** The applied search term — after the debounce, not the keystroke. */
  q: string
  /** Wire form, `'<key>:<asc|desc>'`, or `null`. */
  sort: string | null
  /** `null` when the route does not count. */
  total: number | null
}

export interface NeCollectionOptions<TItem, TRaw = OffsetListResponse<TItem>> {
  /**
   * Turns a route's own response into the contract's shape. Required for a
   * route that has not migrated to `listResponse` yet; omit it once it has.
   */
  adapter?: (raw: TRaw) => OffsetListResponse<TItem>
  /** `q` debounce in ms. `0` disables it (a test usually wants that). */
  debounce?: number
  /**
   * False while the page has no scope to ask with. A scoped list called with
   * no scope is a 400 by design; the fix is not to send it. The collection
   * fetches by itself the moment this turns true.
   */
  enabled?: MaybeRefOrGetter<boolean>
  /** Issues one request. Called at most once per settled intent. */
  fetch: (query: NeCollectionQuery, context: NeCollectionFetchContext) => Promise<TRaw> | TRaw
  /** Extra allowlisted query keys. A change resets to page one. */
  filters?: MaybeRefOrGetter<Record<string, unknown>>
  /** Fetch on creation. `false` for an SSR page that awaits `refresh()`. */
  immediate?: boolean
  /** Page size. Clamped to `maxLimit`, then to whatever the route echoes. */
  limit?: number
  /** Longest `q` sent. Defaults to the contract's own maximum. */
  maxQueryLength?: number
  /** Client-side page-size ceiling. The route's own `maxLimit` still wins. */
  maxLimit?: number
  /** Initial sort, wire form. Must satisfy `sortable` when that is given. */
  sort?: string | null
  /** Allowlisted sort keys, mirroring the route's. Gates `setSort` and the URL. */
  sortable?: readonly string[]
  /** Mirror `page`/`q`/`sort` in the route query, without a navigation loop. */
  syncQuery?: boolean
}

export interface NeCollection<TItem> {
  /** True while `page` can move forward / back. */
  canNext: boolean
  canPrevious: boolean
  error: unknown
  items: readonly TItem[]
  page: number
  pageCount: number | null
  pending: boolean
  /**
   * The search box's own value — written on every keystroke, applied after the
   * debounce. Bind it with `v-model="c.q"`.
   */
  q: string
  /** Re-issues the current query. Resolves when the collection settles. */
  refresh: () => Promise<void>
  /** Page-size ceiling excluded: see `setLimit`. */
  setLimit: (limit: number) => void
  setPage: (page: number) => void
  setSort: (sort: string | null) => void
  sort: string | null
  /**
   * The snapshot `NePager` binds with `v-model:state`.
   *
   * Assigning to it applies `page` and NOTHING ELSE. A control that could
   * smuggle a new `q`, `sort` or filter set through the pager's model would be
   * able to change the query without the page reset in (4) above ever running.
   * `setLimit` / `setSort` / `c.q` are the ways to change those.
   */
  state: NeCollectionState<TItem>
  total: number | null
}

/** A sort in wire form, if it is one the route accepts. */
function readSort(value: unknown, sortable: readonly string[] | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const parts = trimmed.split(':')
  if (parts.length !== 2) return null
  const [key, direction] = parts
  if (!key) return null
  if (direction !== 'asc' && direction !== 'desc') return null
  if (sortable && !sortable.includes(key)) return null
  return trimmed
}

function readPage(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null
  return parsed
}

// `LocationQuery[string]` excludes `undefined`, but indexing a `LocationQuery`
// under the stricter `noUncheckedIndexedAccess` a generated app compiles with
// yields `| undefined` -- so the four call sites below fail to typecheck inside
// a consumer even though they pass here. The body already returns `null` for
// `undefined` (`Array.isArray(undefined)` is false, and `typeof undefined` is
// never `'string'`), so this widens the type to match behaviour that was
// already correct. Caught by release:consumer-smoke, not by this package's own
// typecheck.
function firstQueryValue(value: LocationQuery[string] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : null
}

/**
 * Key-order-independent identity for a filter set.
 *
 * A `filters` getter that rebuilds its object every render is the normal way
 * to write one, so comparing by reference would refetch forever. Comparing by
 * a stable serialisation bounds the work to filter sets that actually differ.
 */
function filtersKeyOf(filters: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, filters[key]]),
  )
}

function isOffsetListResponse(raw: unknown): raw is OffsetListResponse<unknown> {
  if (!raw || typeof raw !== 'object') return false
  const candidate = raw as Partial<OffsetListResponse<unknown>>
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.limit === 'number' &&
    typeof candidate.offset === 'number'
  )
}

/**
 * True for the rejection an `AbortController` produces, under either the DOM
 * name or the `code` Node and undici use. A superseded request's failure is
 * not the collection's error.
 */
function isAbortError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const candidate = cause as { code?: unknown; name?: unknown }
  return candidate.name === 'AbortError' || candidate.code === 20 || candidate.code === 'ABORT_ERR'
}

export function useCollection<TItem, TRaw = OffsetListResponse<TItem>>(
  options: NeCollectionOptions<TItem, TRaw>,
): NeCollection<TItem> {
  const maxLimit = options.maxLimit ?? Number.MAX_SAFE_INTEGER
  const maxQueryLength = options.maxQueryLength ?? LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH
  const debounceMs = options.debounce ?? NE_COLLECTION_DEBOUNCE_MS

  const clampLimit = (value: number): number =>
    Math.min(
      Math.max(1, Math.trunc(Number.isFinite(value) ? value : LIST_QUERY_DEFAULT_LIMIT)),
      maxLimit,
    )

  const pageRef = shallowRef(1)
  const limitRef = shallowRef(clampLimit(options.limit ?? LIST_QUERY_DEFAULT_LIMIT))
  const sortRef = shallowRef<string | null>(readSort(options.sort, options.sortable))
  const searchInput = shallowRef('')
  const searchApplied = shallowRef('')
  const itemsRef = shallowRef<readonly TItem[]>([])
  const totalRef = shallowRef<number | null>(null)
  const pendingRef = shallowRef(false)
  const errorRef = shallowRef<unknown>(null)

  const filtersValue = computed<Record<string, unknown>>(() => ({
    ...(toValue(options.filters) ?? {}),
  }))
  const filtersKey = computed(() => filtersKeyOf(filtersValue.value))

  const pageCount = computed<number | null>(() =>
    totalRef.value === null ? null : Math.max(1, Math.ceil(totalRef.value / limitRef.value)),
  )

  // An uncounted route cannot say how many pages there are, so "is there a
  // next one" is answered by the page that landed: a FULL page may have more
  // behind it, a short one is the end. A counted route answers exactly.
  const hasNext = computed(() =>
    pageCount.value === null
      ? itemsRef.value.length >= limitRef.value
      : pageRef.value < pageCount.value,
  )
  const hasPrevious = computed(() => pageRef.value > 1)

  // ——— the scheduler ————————————————————————————————————————————————
  //
  // `intent` is bumped by every change that needs a new request; `settled` is
  // the intent the rendered page belongs to. `run()` loops until they agree,
  // which is what makes N triggers during one flight collapse into one
  // follow-up rather than N queued requests.
  let intent = 0
  let settled = 0
  let running = false
  let starting = false
  let runPromise: Promise<void> = Promise.resolve()
  let inFlight: AbortController | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const isEnabled = (): boolean => toValue(options.enabled) !== false

  function buildQuery(): NeCollectionQuery {
    const filters = filtersValue.value
    const collisions = Object.keys(filters).filter((key) =>
      (LIST_QUERY_RESERVED_KEYS as readonly string[]).includes(key),
    )
    if (collisions.length > 0) {
      throw new TypeError(
        `useCollection: filter keys collide with reserved list-query keys: ${collisions.sort().join(', ')}.`,
      )
    }

    const query: NeCollectionQuery = {
      ...filters,
      limit: limitRef.value,
      offset: (pageRef.value - 1) * limitRef.value,
    }
    if (searchApplied.value) query.q = searchApplied.value
    if (sortRef.value) query.sort = sortRef.value
    return query
  }

  /**
   * Writes a landed page into the state, then applies the two clamps.
   *
   * The route's echo wins over what was asked for: `listResponse` echoes the
   * `limit` it actually used (already clamped to the route's own `maxLimit`)
   * and the `offset` it actually served, so reading `page` back out of them
   * keeps the pager showing the page the reader is really on rather than the
   * one the client hoped for.
   */
  function applyResponse(raw: TRaw): void {
    const response = options.adapter
      ? options.adapter(raw)
      : ((): OffsetListResponse<TItem> => {
          if (!isOffsetListResponse(raw)) {
            throw new TypeError(
              'useCollection: the response is not a list-query `listResponse` ({ items, limit, offset, … }). ' +
                'Pass `adapter` for a route that has not migrated to the contract yet.',
            )
          }
          return raw as OffsetListResponse<TItem>
        })()

    itemsRef.value = response.items
    totalRef.value = typeof response.total === 'number' ? response.total : null
    limitRef.value = clampLimit(response.limit)
    pageRef.value = Math.max(1, Math.floor(Math.max(0, response.offset) / limitRef.value) + 1)

    // Clamp (5). Exactly one extra request, never a walk: a counted route
    // knows the last page that still has a row, and an uncounted one cannot,
    // so it goes to page one — the only page that is always in range.
    if (pageCount.value !== null && pageRef.value > pageCount.value) {
      pageRef.value = pageCount.value
      schedule()
    } else if (pageCount.value === null && pageRef.value > 1 && response.items.length === 0) {
      pageRef.value = 1
      schedule()
    }
  }

  async function run(): Promise<void> {
    running = true
    try {
      while (settled !== intent && isEnabled()) {
        const token = intent
        const controller = new AbortController()
        inFlight = controller
        try {
          const raw = await options.fetch(buildQuery(), { signal: controller.signal })
          // Superseded while awaiting: discard rather than paint the old page
          // for a frame. This is the half a rendered-list assertion cannot see.
          if (token !== intent) continue
          applyResponse(raw)
          errorRef.value = null
        } catch (cause) {
          if (token !== intent || isAbortError(cause)) continue
          // The last good page stays on screen; the consumer decides whether
          // to draw `error` over it (that is `NeStatePanel`'s job).
          errorRef.value = cause
        } finally {
          if (inFlight === controller) inFlight = null
        }
        settled = token
      }
    } finally {
      running = false
      pendingRef.value = false
    }
  }

  function schedule(): void {
    intent += 1
    if (!isEnabled()) return
    pendingRef.value = true
    if (running) {
      // Stop the superseded request instead of merely ignoring its answer.
      inFlight?.abort()
      return
    }
    if (starting) return
    // Deferred by one microtask on purpose. `run()` snapshots the query
    // SYNCHRONOUSLY (`buildQuery()` is evaluated before the first `await`), so
    // starting it inline would turn a burst of mutations in one tick —
    // `setSort(...); setPage(2)`, or the three fields a URL read applies —
    // into a request for the intermediate state plus a coalesced correction.
    // Waiting a microtask collapses the burst into the one request that was
    // actually wanted.
    starting = true
    runPromise = Promise.resolve().then(() => {
      starting = false
      return run()
    })
  }

  // ——— mutators —————————————————————————————————————————————————————
  //
  // Every one of them schedules explicitly. Nothing here watches the state
  // refs, which is why `applyResponse` can adopt the route's echoed limit and
  // offset without that adoption looping back into another request.

  /**
   * Clamps a candidate page against `pageCount` when it is already known
   * (narduk-libs#288) -- shared so a route-sourced page gets the same bound
   * a caller-sourced one does through {@link setPage}.
   */
  function clampToKnownPageCount(page: number): number {
    return pageCount.value === null ? page : Math.min(page, pageCount.value)
  }

  function setPage(next: number): void {
    const clamped = Math.max(1, Math.trunc(Number.isFinite(next) ? next : 1))
    const bounded = clampToKnownPageCount(clamped)
    if (bounded === pageRef.value) return
    pageRef.value = bounded
    schedule()
  }

  function setLimit(next: number): void {
    const clamped = clampLimit(next)
    if (clamped === limitRef.value) return
    limitRef.value = clamped
    pageRef.value = 1
    schedule()
  }

  function setSort(next: string | null): void {
    const resolved = next === null ? null : readSort(next, options.sortable)
    if (resolved === sortRef.value) return
    sortRef.value = resolved
    pageRef.value = 1
    schedule()
  }

  function applySearch(next: string): void {
    const trimmed = next.trim().slice(0, maxQueryLength)
    if (trimmed === searchApplied.value) return
    searchApplied.value = trimmed
    pageRef.value = 1
    schedule()
  }

  function setSearch(next: string): void {
    searchInput.value = next
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    if (debounceMs <= 0) {
      applySearch(next)
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      applySearch(searchInput.value)
    }, debounceMs)
  }

  watch(filtersKey, () => {
    pageRef.value = 1
    schedule()
  })

  watch(
    () => isEnabled(),
    (enabled) => {
      if (enabled && settled !== intent) schedule()
    },
  )

  onScopeDispose(() => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    inFlight?.abort()
  })

  // ——— route sync ————————————————————————————————————————————————————
  if (options.syncQuery) bindRouteQuery()

  if (options.immediate !== false) schedule()

  function bindRouteQuery(): void {
    const route: RouteLocationNormalizedLoaded | undefined = useRoute()
    const router = useRouter()
    if (!route || !router) {
      throw new Error(
        'useCollection({ syncQuery: true }) needs vue-router. Call it from a component inside a router (every Nuxt app is one), or leave syncQuery off.',
      )
    }

    /** Reads the URL into the state. Called before the first fetch, so
     *  landing on `?page=3` costs one request rather than two. */
    const readRouteQuery = (query: LocationQuery, schedules: boolean): void => {
      // Clamped the same way setPage() clamps a caller-given page (#288): a
      // stale or hand-edited URL can carry a page the client already knows
      // is out of range, and it should never send an offset for it.
      const page = clampToKnownPageCount(readPage(query.page) ?? 1)
      const search = firstQueryValue(query.q)?.trim().slice(0, maxQueryLength) ?? ''
      const sort = readSort(firstQueryValue(query.sort), options.sortable)

      // Applied as ONE change, not through the mutators. `q` and `sort` reset
      // the page, so calling them in sequence would drop the URL's own page
      // (a back button to `?q=gtm&page=3` would land on page one) and would
      // schedule twice on the way. The URL is a single intent: read all three,
      // then schedule once.
      const changed =
        page !== pageRef.value || search !== searchApplied.value || sort !== sortRef.value
      pageRef.value = page
      searchInput.value = search
      searchApplied.value = search
      sortRef.value = sort
      if (changed && schedules) schedule()
    }

    readRouteQuery(route.query, false)

    watch(
      () =>
        // Joined on a byte no URL can contain, so `?q=a&sort=b` and `?q=a%1Fb`
        // are not the same string to this watcher.
        NE_COLLECTION_SYNCED_KEYS.map((key) => firstQueryValue(route.query[key]) ?? '').join(
          '\u001F',
        ),
      () => readRouteQuery(route.query, true),
    )

    watch([pageRef, searchApplied, sortRef], () => {
      // Canonical URLs: the default of each synced key is ABSENT, not
      // `page=1`. Two URLs for the same page is a duplicate for a crawler and
      // the SEO pilot (riverstatus's rivers list) is the reason this pager
      // emits real hrefs at all.
      const desired: Record<string, string | undefined> = {
        page: pageRef.value > 1 ? String(pageRef.value) : undefined,
        q: searchApplied.value || undefined,
        sort: sortRef.value ?? undefined,
      }
      const unchanged = NE_COLLECTION_SYNCED_KEYS.every(
        (key) => (firstQueryValue(route.query[key]) ?? undefined) === desired[key],
      )
      // The loop breaker. Both halves compare before they write, so the write
      // this watcher makes wakes the reader above, which finds nothing to
      // change and stops.
      if (unchanged) return

      const next: LocationQueryRaw = { ...route.query }
      for (const key of NE_COLLECTION_SYNCED_KEYS) {
        if (desired[key] === undefined) delete next[key]
        else next[key] = desired[key]
      }
      void router.replace({ query: next })
    })
  }

  const state = computed<NeCollectionState<TItem>>({
    get: () => ({
      error: errorRef.value,
      filters: filtersValue.value,
      hasNext: hasNext.value,
      hasPrevious: hasPrevious.value,
      items: itemsRef.value,
      limit: limitRef.value,
      offset: (pageRef.value - 1) * limitRef.value,
      page: pageRef.value,
      pageCount: pageCount.value,
      pending: pendingRef.value,
      q: searchApplied.value,
      sort: sortRef.value,
      total: totalRef.value,
    }),
    set: (next) => setPage(next.page),
  })

  const search = computed<string>({
    get: () => searchInput.value,
    set: setSearch,
  })

  return reactive({
    canNext: hasNext,
    canPrevious: hasPrevious,
    error: errorRef,
    items: itemsRef,
    page: pageRef,
    pageCount,
    pending: pendingRef,
    q: search,
    refresh: (): Promise<void> => {
      schedule()
      return runPromise
    },
    setLimit,
    setPage,
    setSort,
    sort: sortRef,
    state,
    total: totalRef,
  }) as NeCollection<TItem>
}
