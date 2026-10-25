import { computed, onScopeDispose, reactive, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LIST_QUERY_DEFAULT_LIMIT, LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH, LIST_QUERY_RESERVED_KEYS, type CursorListResponse } from '@narduk-enterprises/narduk-platform/list-query'

export interface NeCursorCollectionQuery {
  [filter: string]: unknown
  cursor?: string
  limit: number
  q?: string
  sort?: string
}

export interface NeCursorCollectionOptions<T> {
  debounce?: number
  enabled?: MaybeRefOrGetter<boolean>
  fetch: (query: NeCursorCollectionQuery, context: { signal: AbortSignal }) => Promise<CursorListResponse<T>>
  filters?: MaybeRefOrGetter<Record<string, unknown>>
  immediate?: boolean
  limit?: number
  maxLimit?: number
  sort?: string | null
  sortable?: readonly string[]
  syncQuery?: boolean
}

/** Cursor navigation has no invented page count. Each answer replaces the prior bounded page. */
export interface NeCursorCollectionState<T> {
  cursor: string | null
  error: unknown
  hasNext: boolean
  hasPrevious: boolean
  items: readonly T[]
  limit: number
  nextCursor: string | null
  pending: boolean
  q: string
  sort: string | null
  total: number | null
}

/** A single-flight, cancelable cursor client. Shared by changing histories, never implemented in app pages. */
export function useCursorCollection<T>(options: NeCursorCollectionOptions<T>) {
  const route = options.syncQuery ? useRoute() : undefined
  const router = options.syncQuery ? useRouter() : undefined
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const validSort = (value: unknown) => {
    const wire = text(value)
    const [key, direction, ...extra] = wire.split(':')
    return key && extra.length === 0 && (direction === 'asc' || direction === 'desc') && (!options.sortable || options.sortable.includes(key)) ? wire : null
  }
  const cursor = ref<string | null>(text(route?.query.cursor) || null)
  const q = ref(text(route?.query.q).slice(0, LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH))
  const appliedQ = ref(q.value)
  const sort = ref(validSort(route?.query.sort) ?? validSort(options.sort) ?? null)
  const limit = ref(Math.max(1, Math.min(options.maxLimit ?? 100, options.limit ?? LIST_QUERY_DEFAULT_LIMIT)))
  const items = shallowRef<readonly T[]>([])
  const nextCursor = ref<string | null>(null)
  const total = ref<number | null>(null)
  const error = shallowRef<unknown>(null)
  const pending = ref(false)
  const previous: Array<string | null> = []
  let controller: AbortController | null = null
  let queued = false
  let disposed = false
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const filters = computed(() => {
    const value = toValue(options.filters) ?? {}
    const collisions = Object.keys(value).filter((key) => (LIST_QUERY_RESERVED_KEYS as readonly string[]).includes(key))
    if (collisions.length > 0) throw new TypeError(`useCursorCollection: filter keys collide with reserved list-query keys: ${collisions.sort().join(', ')}.`)
    return value
  })
  const enabled = computed(() => toValue(options.enabled) !== false)
  const query = computed<NeCursorCollectionQuery>(() => ({
    ...filters.value, limit: limit.value,
    ...(cursor.value ? { cursor: cursor.value } : {}),
    ...(appliedQ.value ? { q: appliedQ.value } : {}),
    ...(sort.value ? { sort: sort.value } : {}),
  }))
  const scope = computed(() => JSON.stringify(query.value))

  function syncRoute() {
    if (!route || !router) return
    const next = { ...route.query, cursor: cursor.value || undefined, q: appliedQ.value || undefined, sort: sort.value || undefined }
    if (text(route.query.cursor) === (cursor.value ?? '') && text(route.query.q) === appliedQ.value && text(route.query.sort) === (sort.value ?? '')) return
    void router.replace({ query: next })
  }
  async function drain() {
    pending.value = true
    try {
      do {
        queued = false
        if (disposed || !enabled.value) break
        const identity = scope.value
        const snapshot = { ...query.value }
        controller = new AbortController()
        try {
          const answer = await options.fetch(snapshot, { signal: controller.signal })
          if (!disposed && enabled.value && identity === scope.value && !controller.signal.aborted) {
            items.value = answer.items
            nextCursor.value = answer.nextCursor
            total.value = answer.total
            error.value = null
          }
        } catch (failure) {
          if (!disposed && identity === scope.value && !controller.signal.aborted) error.value = failure
        }
      } while (queued)
    } finally {
      controller = null
      pending.value = false
      running = null
    }
  }
  function refresh(): Promise<void> {
    if (disposed || !enabled.value) return Promise.resolve()
    if (running) { queued = true; controller?.abort(); return running }
    pending.value = true
    running = Promise.resolve().then(drain)
    return running
  }
  function reset() {
    previous.length = 0
    cursor.value = null
    nextCursor.value = null
  }
  watch(scope, () => { syncRoute(); void refresh() }, { flush: 'post' })
  watch(enabled, (value) => { if (value) void refresh(); else controller?.abort() })
  watch(q, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const normalized = q.value.trim().slice(0, LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH)
      if (normalized !== appliedQ.value) { reset(); appliedQ.value = normalized }
    }, options.debounce ?? 250)
  })
  watch(() => JSON.stringify(filters.value), reset, { flush: 'sync' })
  watch(() => route?.query, () => {
    if (!route) return
    const incoming = text(route.query.cursor) || null
    const incomingQ = text(route.query.q).slice(0, LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH)
    // A URL without a sort keeps the untouched default; any other sort was set (or cleared) and so is cleared.
    const incomingSort = validSort(route.query.sort) ?? (route.query.sort === undefined && sort.value === (validSort(options.sort) ?? null) ? sort.value : null)
    if (incomingQ !== appliedQ.value) { clearTimeout(timer); reset(); q.value = incomingQ; appliedQ.value = incomingQ }
    if (incomingSort !== sort.value) { reset(); sort.value = incomingSort }
    if (incoming !== cursor.value) { previous.length = 0; cursor.value = incoming }
  })
  onScopeDispose(() => { disposed = true; queued = false; clearTimeout(timer); controller?.abort() })
  if (options.immediate !== false && enabled.value) void refresh()
  const state = computed<NeCursorCollectionState<T>>(() => ({ cursor: cursor.value, error: error.value, hasNext: Boolean(nextCursor.value), hasPrevious: Boolean(cursor.value), items: items.value, limit: limit.value, nextCursor: nextCursor.value, pending: pending.value, q: appliedQ.value, sort: sort.value, total: total.value }))
  return reactive({
    error, items, pending, q, sort, state,
    refresh,
    next() { if (!pending.value && nextCursor.value) { previous.push(cursor.value); cursor.value = nextCursor.value; nextCursor.value = null } },
    previous() { if (!pending.value && cursor.value) { cursor.value = previous.pop() ?? null; nextCursor.value = null } },
    newest() { if (!pending.value) reset() },
    setLimit(value: number) {
      if (!Number.isFinite(value)) return
      const normalized = Math.max(1, Math.min(options.maxLimit ?? 100, Math.floor(value)))
      if (normalized !== limit.value) { reset(); limit.value = normalized }
    },
    setSort(value: string | null) { const normalized = validSort(value); if (normalized !== sort.value) { reset(); sort.value = normalized } },
  })
}
