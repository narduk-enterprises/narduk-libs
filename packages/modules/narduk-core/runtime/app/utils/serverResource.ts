// Explicit imports (not Nuxt auto-imports): packed package consumers compile this
// file outside the owning Nuxt source tree, and isolated Vitest has no `#imports`.
// The Nuxt data API is injected (`ServerResourceNuxt`); `defineServerResource`
// passes the real one.
import {
  computed,
  effectScope,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  onServerPrefetch,
  shallowRef,
} from 'vue'

import { useIntervalRefresh } from '../composables/useIntervalRefresh'

import { MUTATION_METHODS } from './mutationMethods'

import type { ComputedRef, Ref } from 'vue'

/**
 * - `loading`: nothing has been read yet (or the read is in flight).
 * - `ready`: the last read answered.
 * - `absent`: the last read answered, and the answer says the source is not
 *   there (not configured, not published) — `options.absent` decides.
 * - `error`: the last read failed. `data` still holds the last good answer, if
 *   there was one; an error never blanks it.
 */
export type ServerResourceState = 'loading' | 'ready' | 'absent' | 'error'

/** A failed read, as it travels in the payload (an `Error` does not serialise). */
export interface ServerResourceError {
  /** Epoch ms of the failure. */
  at: number
  message: string
  statusCode?: number
}

export interface ServerResourceFetchOptions {
  [option: string]: unknown
  body?: unknown
  headers?: HeadersInit | Record<string, string>
  method?: string
  query?: Record<string, unknown>
  signal?: AbortSignal
}

/** `useRequestFetch()`'s shape, as far as a resource uses it. */
export type ServerResourceRequestFetch = <R = unknown>(
  request: string,
  options?: ServerResourceFetchOptions,
) => Promise<R>

interface AsyncDataLike {
  data: Ref<unknown>
  refresh: (options?: { dedupe?: 'cancel' | 'defer' }) => Promise<unknown>
  status: Ref<string>
}

/** The Nuxt data API a resource is built on, injected so the core runs without `#imports`. */
export interface ServerResourceNuxt {
  refreshNuxtData: (keys: string[]) => Promise<void>
  useAsyncData: (
    key: string,
    handler: (app: unknown, options: { signal?: AbortSignal }) => Promise<unknown>,
    options: Record<string, unknown>,
  ) => AsyncDataLike
  useNuxtApp: () => unknown
  useRequestFetch: () => ServerResourceRequestFetch
  useState: <S>(key: string, init: () => S) => Ref<S>
}

export interface ServerResourceFetchContext {
  /** `useRequestFetch()`: forwards the inbound request's cookies during SSR. */
  fetch: ServerResourceRequestFetch
  /** `refresh({ force: true })` asked for this read: bypass any server-side cache. */
  force: boolean
  signal?: AbortSignal
}

export interface ServerResourceWriteContext<T> {
  /** The value the resource holds when the write starts. */
  data: T | undefined
  /** The request fetch, plus `X-Requested-With` on every mutation method (as `useAppFetch()`). */
  fetch: ServerResourceRequestFetch
}

export interface ServerResourceWrite<T, A extends unknown[] = unknown[]> {
  /**
   * Other resource keys this write makes stale. The resource's own key is
   * always refreshed; these are marked stale and refreshed if mounted.
   */
  invalidates?: readonly string[]
  run: (context: ServerResourceWriteContext<T>, ...args: A) => Promise<unknown>
}

/** Write name → its argument list. Inferred from `writes`; never spelled out by a caller. */
export type ServerResourceWriteArgs = Record<string, unknown[]>

export interface ServerResourceOptions<T, W extends ServerResourceWriteArgs> {
  /** The answer says the source is not there: `state` reads `absent`, not `ready`. */
  absent?: (data: T) => boolean
  fetch: (context: ServerResourceFetchContext) => Promise<T>
  /**
   * Keep the answer after the last consumer unmounts (stale-while-revalidate
   * across navigation). Defaults to `false`: Nuxt purges it with its last
   * consumer.
   */
  keepAlive?: boolean
  /** The one `useAsyncData` key every caller of this resource shares. */
  key: string
  /** Poll while at least one consumer is mounted. One timer per key, paused while the page is hidden. */
  poll?: { everyMs: number }
  /** Read during SSR. Defaults to `true`; `false` reads only in the browser, after mount on hydration. */
  server?: boolean
  /**
   * How long an answer counts as fresh on the client: a `load()` inside this
   * window reuses it. Defaults to 0 — every route entry reads again, except
   * that an answer read during this server render, or hydrated from it, is
   * always reused (no double fetch on hydration).
   */
  ttlMs?: number
  /** Write actions. Each refreshes this resource (and `invalidates`) after it runs. */
  writes?: { [K in keyof W]: ServerResourceWrite<T, W[K]> }
}

export interface ServerResourceCallOptions {
  /** Start reading when called (default). `false` reads only on `load()`/`ensure()`/`refresh()`. */
  immediate?: boolean
  /** Read after mount, in the browser only: never during SSR, never blocking navigation. */
  lazy?: boolean
}

export interface ServerResourceHandle<T> {
  /** The last good answer; `undefined` until one arrives. Shared by every caller. */
  data: Ref<T | undefined>
  /** `load()`, then the answer — or a rejection with the reason there is none. */
  ensure: () => Promise<T>
  error: Readonly<Ref<ServerResourceError | null>>
  /** Read unless a fresh answer is held. Concurrent callers share one request. Never rejects. */
  load: () => Promise<ServerResourceHandle<T>>
  pending: ComputedRef<boolean>
  /** Epoch ms of the last good read, hydrated from the server. */
  readAt: Readonly<Ref<number | null>>
  /** Read now, whatever the stamp says. `force` reaches `fetch` as `context.force`. */
  refresh: (options?: { force?: boolean }) => Promise<void>
  state: ComputedRef<ServerResourceState>
}

/** Each write, callable with its own arguments; it resolves with what `run` resolved. */
type WriteMethods<W extends ServerResourceWriteArgs> = {
  [K in keyof W]: (...args: W[K]) => Promise<unknown>
}

export type ServerResource<T, W extends ServerResourceWriteArgs> = ServerResourceHandle<T> &
  WriteMethods<W>

interface ResourceEntry {
  force: boolean
  pollers: number
  /** The freshness stamp, held so code outside a setup context reaches it without one. */
  readAt?: Ref<number | null>
  stopPolling: (() => void) | undefined
}

interface AppWithResources {
  _asyncData: Record<string, { data: Ref<unknown> } | undefined>
  _nardukServerResources?: Map<string, ResourceEntry>
  isHydrating?: boolean
  payload: { data: Record<string, unknown> }
  /**
   * Synchronous in the browser; on the server Nuxt answers with a promise
   * (`callWithNuxt` goes through unctx `callAsync`), so every result is awaited.
   */
  runWithContext: <R>(fn: () => R) => R | Promise<R>
}

const readAtKey = (key: string) => `narduk:resource:${key}:read-at`
const errorKey = (key: string) => `narduk:resource:${key}:error`

function entryOf(nuxtApp: AppWithResources, key: string): ResourceEntry {
  nuxtApp._nardukServerResources ??= new Map()
  let entry = nuxtApp._nardukServerResources.get(key)
  if (!entry) {
    entry = { force: false, pollers: 0, stopPolling: undefined }
    nuxtApp._nardukServerResources.set(key, entry)
  }
  return entry
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function toResourceError(error: unknown): ServerResourceError {
  const record = (typeof error === 'object' && error !== null ? error : {}) as {
    message?: unknown
    status?: unknown
    statusCode?: unknown
  }
  const statusCode =
    typeof record.statusCode === 'number'
      ? record.statusCode
      : typeof record.status === 'number'
        ? record.status
        : undefined
  const message =
    typeof record.message === 'string' && record.message ? record.message : String(error)
  return { at: Date.now(), message, ...(statusCode === undefined ? {} : { statusCode }) }
}

/** The core of `invalidateServerResources()`, with the Nuxt data API injected. */
export async function invalidateServerResourcesWith(
  nuxt: ServerResourceNuxt,
  keys: readonly string[],
): Promise<void> {
  const nuxtApp = nuxt.useNuxtApp() as AppWithResources
  for (const key of keys) {
    const stamp =
      nuxtApp._nardukServerResources?.get(key)?.readAt ??
      (await nuxtApp.runWithContext(() => nuxt.useState<number | null>(readAtKey(key), () => null)))
    stamp.value = null
  }
  await nuxt.refreshNuxtData([...keys])
}

/** The request fetch with the CSRF header narduk-core's middleware requires on mutations. */
function withMutationHeader(fetch: ServerResourceRequestFetch): ServerResourceRequestFetch {
  return (request, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase()
    if (!MUTATION_METHODS.has(method)) return fetch(request, options)
    const headers = new Headers(options.headers as HeadersInit | undefined)
    if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', 'XMLHttpRequest')
    return fetch(request, { ...options, headers })
  }
}

/**
 * The core of `defineServerResource()`, with the Nuxt data API injected.
 * Apps call `defineServerResource()`; tests call this with a stand-in.
 */
export function createServerResource<T, W extends ServerResourceWriteArgs = Record<never, never>>(
  options: ServerResourceOptions<T, W>,
  nuxt: ServerResourceNuxt,
): (call?: ServerResourceCallOptions) => ServerResource<T, W> & PromiseLike<ServerResource<T, W>> {
  const { key, ttlMs = 0, server = true, keepAlive = false, poll, absent, writes } = options

  /* One handler for every caller: Nuxt keeps the first registration's handler for a key. */
  const handler = async (app: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<T> => {
    const nuxtApp = app as AppWithResources
    const entry = entryOf(nuxtApp, key)
    const force = entry.force
    entry.force = false
    const scoped = nuxtApp.runWithContext(() => ({
      fetch: nuxt.useRequestFetch(),
      readAt: nuxt.useState<number | null>(readAtKey(key), () => null),
      error: nuxt.useState<ServerResourceError | null>(errorKey(key), () => null),
    }))
    /* Awaited only on the server: the browser keeps its read synchronous with the caller. */
    const { fetch, readAt, error } = scoped instanceof Promise ? await scoped : scoped
    try {
      const value = await options.fetch({ fetch, force, signal })
      readAt.value = Date.now()
      error.value = null
      return value
    } catch (cause) {
      if (isAbort(cause)) throw cause
      error.value = toResourceError(cause)
      /* Keep the last good answer beside the error rather than blanking it. */
      const previous = nuxtApp._asyncData[key]?.data.value as T | undefined
      if (previous !== undefined) return previous
      throw cause
    }
  }

  /*
   * keepAlive: a custom getCachedData stops Nuxt purging the answer with its
   * last consumer, and hands it back to the next one — unless a write
   * invalidated it (its stamp is null), which must read again.
   */
  const getCachedData = keepAlive
    ? (cacheKey: string, app: unknown, context: { cause: string }) => {
        const nuxtApp = app as AppWithResources
        if (!(import.meta.server || nuxtApp.isHydrating || context.cause === 'initial')) return
        /* Every consumer registers the stamp before its useAsyncData, so it is here. */
        const stamp = nuxtApp._nardukServerResources?.get(cacheKey)?.readAt
        return (stamp?.value ?? null) === null && !nuxtApp.isHydrating
          ? undefined
          : (nuxtApp.payload.data[cacheKey] as T | undefined)
      }
    : undefined

  return function useServerResource(call: ServerResourceCallOptions = {}) {
    const nuxtApp = nuxt.useNuxtApp() as AppWithResources
    const readAt = nuxt.useState<number | null>(readAtKey(key), () => null)
    entryOf(nuxtApp, key).readAt = readAt
    const error = nuxt.useState<ServerResourceError | null>(errorKey(key), () => null)
    const appFetch = withMutationHeader(nuxt.useRequestFetch())
    const request = nuxt.useAsyncData(key, handler, {
      server,
      immediate: false,
      dedupe: 'defer',
      ...(getCachedData ? { getCachedData } : {}),
    })
    const data = request.data as Ref<T | undefined>

    function isFresh(): boolean {
      if (data.value === undefined || readAt.value === null || error.value !== null) return false
      /* Read during this server render, or hydrated from it: never read twice. */
      if (import.meta.server || nuxtApp.isHydrating) return true
      return Date.now() - readAt.value < ttlMs
    }

    async function load() {
      if (import.meta.server && !server) return handle
      if (!isFresh()) await request.refresh({ dedupe: 'defer' })
      return handle
    }

    async function ensure(): Promise<T> {
      await load()
      if (data.value !== undefined) return data.value
      throw Object.assign(new Error(error.value?.message ?? `${key} has not been read`), {
        statusCode: error.value?.statusCode,
      })
    }

    async function refresh(refreshOptions: { force?: boolean } = {}) {
      if (import.meta.server && !server) return
      if (refreshOptions.force) entryOf(nuxtApp, key).force = true
      await request.refresh({ dedupe: refreshOptions.force ? 'cancel' : 'defer' })
    }

    const state = computed<ServerResourceState>(() => {
      if (error.value) return 'error'
      const value = data.value
      if (value === undefined || value === null) return 'loading'
      return absent?.(value) ? 'absent' : 'ready'
    })

    const handle = {
      data,
      error,
      pending: computed(() => request.status.value === 'pending'),
      readAt,
      state,
      load,
      ensure,
      refresh,
    } as ServerResource<T, W>

    for (const [name, write] of Object.entries(writes ?? {}) as Array<
      [string, ServerResourceWrite<T>]
    >) {
      ;(handle as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        const result = await write.run({ fetch: appFetch, data: data.value }, ...args)
        readAt.value = null
        const others = (write.invalidates ?? []).filter((other) => other !== key)
        await Promise.all([
          request.refresh({ dedupe: 'cancel' }),
          others.length ? invalidateServerResourcesWith(nuxt, others) : undefined,
        ])
        return result
      }
    }

    const instance = getCurrentInstance()
    if (!import.meta.server && instance && poll && poll.everyMs > 0) {
      const entry = entryOf(nuxtApp, key)
      let subscribed = false
      onMounted(() => {
        subscribed = true
        if (entry.pollers++ > 0) return
        /*
         * One poller per key, on narduk-core's existing interval primitive
         * (`useIntervalRefresh`, which `useLiveProduct` also builds on), held
         * in a detached scope so it outlives whichever consumer mounted first.
         */
        const visible = shallowRef(document.visibilityState !== 'hidden')
        const scope = effectScope(true)
        scope.run(() =>
          useIntervalRefresh(
            () => {
              if (visible.value) void request.refresh({ dedupe: 'defer' })
            },
            poll.everyMs,
            {
              enabled: visible,
            },
          ),
        )
        const onVisibility = () => {
          visible.value = document.visibilityState !== 'hidden'
          if (!visible.value) return
          if (readAt.value === null || Date.now() - readAt.value >= poll.everyMs) {
            void request.refresh({ dedupe: 'defer' })
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        entry.stopPolling = () => {
          scope.stop()
          document.removeEventListener('visibilitychange', onVisibility)
        }
      })
      onBeforeUnmount(() => {
        if (!subscribed) return
        subscribed = false
        if (--entry.pollers > 0) return
        entry.stopPolling?.()
        entry.stopPolling = undefined
      })
    }

    const { immediate = true, lazy = false } = call
    let started: Promise<unknown> = Promise.resolve()
    if (immediate) {
      /* A browser-only read must not change state under the hydrating render. */
      const afterMount = lazy || (!import.meta.server && !server && nuxtApp.isHydrating)
      if (afterMount) {
        if (!import.meta.server && instance) onMounted(() => void load())
        else if (!import.meta.server) void load()
      } else {
        started = load()
        if (import.meta.server && instance) onServerPrefetch(() => started)
      }
    }

    const awaited = started.then(() => handle)
    return Object.assign(Object.create(null) as object, handle, {
      then: awaited.then.bind(awaited),
    }) as ServerResource<T, W> & PromiseLike<ServerResource<T, W>>
  }
}
