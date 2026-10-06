/// <reference lib="dom" />
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import { createServerResource } from '../runtime/app/utils/serverResource'

import type { ServerResourceNuxt } from '../runtime/app/utils/serverResource'
import type { Ref } from 'vue'

/**
 * `defineServerResource()`'s core against a small stand-in for Nuxt's data layer that
 * keeps Nuxt's sharing rules: ONE `useAsyncData` entry per key, the FIRST
 * registration's handler, `dedupe: 'defer'` sharing the request in flight,
 * `getCachedData` consulted when an entry is built, and an error resetting
 * `data` to `undefined`. `useState` is one map, as one app's payload is.
 */
interface FakeEntry {
  data: Ref<unknown>
  handler: (app: unknown, options: { signal?: AbortSignal }) => Promise<unknown>
  promise: Promise<unknown> | undefined
  status: Ref<string>
}

const app = {
  _asyncData: {} as Record<string, FakeEntry>,
  isHydrating: false,
  payload: { data: {} as Record<string, unknown> },
  runWithContext: <R>(fn: () => R) => fn(),
}
const state = new Map<string, Ref<unknown>>()
const requestFetch = vi.fn()

function execute(key: string, dedupe: string) {
  const entry = app._asyncData[key]!
  if (entry.promise && dedupe === 'defer') return entry.promise
  entry.status.value = 'pending'
  const promise = entry
    .handler(app, {})
    .then((value) => {
      app.payload.data[key] = value
      entry.data.value = value
      entry.status.value = 'success'
      return value
    })
    .catch(() => {
      entry.data.value = undefined
      entry.status.value = 'error'
    })
    .finally(() => {
      if (entry.promise === promise) entry.promise = undefined
    })
  entry.promise = promise
  return promise
}

const nuxt = {
  refreshNuxtData: async (keys: string[]) => {
    await Promise.all(
      keys.filter((key) => app._asyncData[key]).map((key) => execute(key, 'cancel')),
    )
  },
  useAsyncData: (
    key: string,
    handler: FakeEntry['handler'],
    options: { getCachedData?: (key: string, app: unknown, context: { cause: string }) => unknown },
  ) => {
    if (!app._asyncData[key]) {
      const cached = options.getCachedData
        ? options.getCachedData(key, app, { cause: 'initial' })
        : app.isHydrating
          ? app.payload.data[key]
          : undefined
      app._asyncData[key] = { data: ref(cached), status: ref('idle'), promise: undefined, handler }
    }
    const entry = app._asyncData[key]
    return {
      data: entry.data,
      status: entry.status,
      refresh: ({ dedupe = 'cancel' }: { dedupe?: string } = {}) => execute(key, dedupe),
    }
  },
  useNuxtApp: () => app,
  useRequestFetch: () => requestFetch,
  useState: (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init()))
    return state.get(key)
  },
} as unknown as ServerResourceNuxt

interface Catalog {
  available: boolean
  products: Array<{ id: string; name: string }>
}

const writes = vi.fn()
const useCatalog = createServerResource(
  {
    key: 'catalog',
    fetch: ({ fetch }) => fetch<Catalog>('/api/products'),
    ttlMs: 60_000,
    absent: (catalog) => !catalog.available,
    writes: {
      rename: {
        invalidates: ['catalog-summary'],
        run: async ({ fetch }, id: string, name: string) => {
          writes(id, name)
          return fetch(`/api/products/${id}`, { method: 'POST', body: { name } })
        },
      },
    },
  },
  nuxt,
)
const useSummary = createServerResource(
  {
    key: 'catalog-summary',
    fetch: ({ fetch }) => fetch<{ count: number }>('/api/summary'),
    keepAlive: true,
  },
  nuxt,
)

const alpha = (name = 'Alpha'): Catalog => ({ available: true, products: [{ id: 'a', name }] })

beforeEach(() => {
  app._asyncData = {}
  app.isHydrating = false
  app.payload.data = {}
  state.clear()
  writes.mockReset()
  requestFetch.mockReset().mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return { ok: true }
    if (path === '/api/summary') return { count: 1 }
    return alpha()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('defineServerResource', () => {
  it('reads once, and a second caller inside the TTL reuses the answer', async () => {
    const first = await useCatalog()
    const second = await useCatalog()

    expect(requestFetch).toHaveBeenCalledTimes(1)
    expect(second.data.value?.products[0]?.name).toBe('Alpha')
    expect(first.state.value).toBe('ready')
  })

  it('concurrent callers share one request', async () => {
    await Promise.all([useCatalog().load(), useCatalog().load(), useCatalog().ensure()])
    expect(requestFetch).toHaveBeenCalledTimes(1)
  })

  it('reads again once the answer is older than the TTL', async () => {
    vi.useFakeTimers()
    await useCatalog()
    vi.advanceTimersByTime(60_001)
    await useCatalog()
    expect(requestFetch).toHaveBeenCalledTimes(2)
  })

  it('never reads twice for a hydrated answer, whatever the TTL', async () => {
    app.isHydrating = true
    app.payload.data.catalog = alpha('Server')
    state.set('narduk:resource:catalog:read-at', ref(Date.now() - 10 * 60_000))

    const hydrated = await useCatalog()

    expect(requestFetch).not.toHaveBeenCalled()
    expect(hydrated.data.value?.products[0]?.name).toBe('Server')
  })

  it('an immediate: false caller reads nothing until asked', async () => {
    const catalog = useCatalog({ immediate: false })
    await Promise.resolve()
    expect(requestFetch).not.toHaveBeenCalled()
    await expect(catalog.ensure()).resolves.toEqual(alpha())
  })

  it('reads absent when the answer says the source is not there', async () => {
    requestFetch.mockResolvedValue({ available: false, products: [] })
    const catalog = await useCatalog()
    expect(catalog.state.value).toBe('absent')
  })

  it('an error keeps the last good answer beside it, and the next read clears it', async () => {
    const catalog = await useCatalog()
    requestFetch.mockRejectedValueOnce(
      Object.assign(new Error('upstream 502'), { statusCode: 502 }),
    )

    await catalog.refresh()

    expect(catalog.state.value).toBe('error')
    expect(catalog.error.value).toMatchObject({ message: 'upstream 502', statusCode: 502 })
    expect(catalog.data.value?.products[0]?.name).toBe('Alpha')

    await catalog.load()
    expect(catalog.state.value).toBe('ready')
    expect(catalog.error.value).toBeNull()
  })

  it('ensure() rejects with the reason when there is no answer at all', async () => {
    requestFetch.mockRejectedValue(new Error('refused'))
    await expect(useCatalog({ immediate: false }).ensure()).rejects.toThrow('refused')
  })

  it('refresh({ force }) reaches fetch as context.force, once', async () => {
    const seen: boolean[] = []
    const useForced = createServerResource(
      {
        key: 'forced',
        fetch: async ({ force }) => {
          seen.push(force)
          return 1
        },
      },
      nuxt,
    )
    const forced = await useForced()
    await forced.refresh({ force: true })
    await forced.refresh()
    expect(seen).toEqual([false, true, false])
  })

  it('a write sends the CSRF header, and every caller and invalidated key sees the new answer', async () => {
    const editor = await useCatalog()
    const palette = useCatalog({ immediate: false })
    await useSummary()
    requestFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: true }
      if (path === '/api/summary') return { count: 2 }
      return alpha('Alpha Prime')
    })

    await expect(editor.rename('a', 'Alpha Prime')).resolves.toEqual({ ok: true })

    const post = requestFetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(new Headers(post[1].headers).get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(palette.data.value?.products[0]?.name).toBe('Alpha Prime')
    expect(useSummary({ immediate: false }).data.value).toEqual({ count: 2 })
  })

  it('keepAlive hands its answer to the next consumer, unless it was invalidated', async () => {
    await useSummary()
    delete app._asyncData['catalog-summary'] // the last consumer unmounted

    const next = useSummary({ immediate: false })
    expect(next.data.value).toEqual({ count: 1 })

    state.get('narduk:resource:catalog-summary:read-at')!.value = null
    delete app._asyncData['catalog-summary']
    expect(useSummary({ immediate: false }).data.value).toBeUndefined()
  })

  it('polls one timer per key while mounted, paused while the page is hidden', async () => {
    vi.useFakeTimers()
    const usePolled = createServerResource(
      { key: 'polled', fetch: async () => requestFetch('/api/polled'), poll: { everyMs: 1_000 } },
      nuxt,
    )
    const Reader = defineComponent({
      setup() {
        usePolled({ immediate: false })
        return () => h('i')
      },
    })
    const root = createApp({ render: () => [h(Reader), h(Reader)] })
    const before = vi.getTimerCount()
    root.mount(document.createElement('div'))
    await nextTick()
    expect(vi.getTimerCount() - before).toBe(1) // two readers, one timer

    await vi.advanceTimersByTimeAsync(1_000) // the tick's read settles
    expect(requestFetch).toHaveBeenCalledTimes(1)

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(3_000)
    expect(requestFetch).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange')) // overdue: catches up at once
    expect(requestFetch).toHaveBeenCalledTimes(2)
    visibility.mockRestore()
    await Promise.resolve()

    root.unmount()
    vi.advanceTimersByTime(3_000)
    expect(requestFetch).toHaveBeenCalledTimes(2)
  })
})
