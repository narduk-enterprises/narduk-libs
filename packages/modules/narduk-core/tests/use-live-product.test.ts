/// <reference lib="dom" />
// @vitest-environment happy-dom
/* The triple-slash directive must stay the first thing in the file (see
   preferences-state.test.ts): this test hydrates into a real document. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createLiveProduct } from '../runtime/app/utils/liveProduct'

import type { LiveProductHandle, LiveProductOptions } from '../runtime/app/utils/liveProduct'
import type { Ref } from 'vue'

/**
 * `createLiveProduct` is `useLiveProduct` with the render-safe clock injected
 * (narduk-libs#374); the `useSsrNow` wiring is pinned in
 * use-live-product-wiring.test.ts. Here it runs in a real component, through
 * real Vue SSR and hydration, on fake timers.
 */
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0, 0)
const MINUTE = 60_000

let visibility: 'hidden' | 'visible' = 'visible'
function setVisibility(next: 'hidden' | 'visible'): void {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

interface Harness {
  container: HTMLElement
  handle: () => LiveProductHandle
  now: Ref<number>
  unmount: () => void
}

function liveComponent(
  now: Ref<number>,
  refresh: () => unknown,
  options: LiveProductOptions,
  capture: (handle: LiveProductHandle) => void,
) {
  return defineComponent({
    setup() {
      const live = createLiveProduct(now, refresh, options)
      capture(live)
      return () =>
        h('p', {}, [
          live.pending.value ? 'refreshing' : 'idle',
          ' / ',
          live.updatedAgo.value ?? 'never',
        ])
    },
  })
}

function mount(refresh: () => unknown, options: LiveProductOptions): Harness {
  const now = ref(Date.now())
  let captured: LiveProductHandle | undefined
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createSSRApp(
    liveComponent(now, refresh, options, (handle) => {
      captured = handle
    }),
  )
  app.mount(container)
  return { container, handle: () => captured!, now, unmount: () => app.unmount() }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

/** Let the settled refresh promise chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useLiveProduct: SSR and hydration', () => {
  it('refreshes nothing on the server, hydrates without a mismatch, then refreshes once', async () => {
    const refresh = vi.fn(async () => {})
    const now = ref(T0)
    const options = { intervalMs: MINUTE, updatedAt: T0 - 5 * MINUTE }
    const html = await renderToString(createSSRApp(liveComponent(now, refresh, options, () => {})))
    expect(html).toContain('idle / 5 minutes ago')
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const warnings: string[] = []
    const capture = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)

    createSSRApp(liveComponent(now, refresh, options, () => {})).mount(container)
    // The hydrating render matched the server's: pending only flips after mount.
    expect(warnings.filter((entry) => /hydrat|mismatch/iu.test(entry))).toEqual([])
    expect(refresh).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(container.textContent).toBe('refreshing / 5 minutes ago')
  })
})

describe('useLiveProduct: polling', () => {
  it('polls every intervalMs after the mount refresh, and stops on unmount', async () => {
    const refresh = vi.fn(async () => {})
    const live = mount(refresh, { intervalMs: MINUTE })
    expect(refresh).toHaveBeenCalledTimes(1)
    await settle()

    vi.advanceTimersByTime(MINUTE)
    expect(refresh).toHaveBeenCalledTimes(2)
    await settle()
    vi.advanceTimersByTime(MINUTE)
    expect(refresh).toHaveBeenCalledTimes(3)

    live.unmount()
    await nextTick()
    vi.advanceTimersByTime(5 * MINUTE)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses while hidden and refreshes at once on return when a poll fell due', async () => {
    const refresh = vi.fn(async () => {})
    mount(refresh, { intervalMs: MINUTE })
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    await nextTick()
    vi.advanceTimersByTime(10 * MINUTE)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(2)
    await settle()
    // ...and the interval is re-armed from the return.
    vi.advanceTimersByTime(MINUTE)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('does not refresh on a return sooner than a poll was due', async () => {
    const refresh = vi.fn(async () => {})
    const live = mount(refresh, { intervalMs: MINUTE })
    await settle()

    setVisibility('hidden')
    vi.advanceTimersByTime(20_000)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(live.handle().visible.value).toBe(true)
  })

  it('honours enabled: no mount refresh, no interval, but refresh() still works', async () => {
    const refresh = vi.fn(async () => {})
    const enabled = ref(false)
    const live = mount(refresh, { enabled, intervalMs: MINUTE })
    vi.advanceTimersByTime(5 * MINUTE)
    expect(refresh).not.toHaveBeenCalled()

    await live.handle().refresh()
    expect(refresh).toHaveBeenCalledTimes(1)

    enabled.value = true
    await nextTick()
    vi.advanceTimersByTime(MINUTE)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

describe('useLiveProduct: refresh', () => {
  it('coalesces overlapping refreshes into the run already in flight', async () => {
    const run = deferred()
    const refresh = vi.fn(() => run.promise)
    const live = mount(refresh, { intervalMs: MINUTE, immediate: false })

    const calls = [live.handle().refresh(), live.handle().refresh()]
    vi.advanceTimersByTime(MINUTE) // a tick while the run is still going
    calls.push(live.handle().refresh())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(live.handle().pending.value).toBe(true)

    vi.setSystemTime(T0 + MINUTE + 1_000)
    run.resolve()
    await Promise.all(calls)
    expect(live.handle().pending.value).toBe(false)
    expect(live.handle().lastRefreshedAt.value).toBe(T0 + MINUTE + 1_000)

    // Settled: the next call is a new run.
    await live.handle().refresh()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('keeps a failure in error without rejecting, and clears it on the next success', async () => {
    const failure = new Error('upstream 503')
    const refresh = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const live = mount(refresh, { intervalMs: MINUTE, immediate: false })

    await expect(live.handle().refresh()).resolves.toBeUndefined()
    expect(live.handle().error.value).toBe(failure)
    expect(live.handle().lastRefreshedAt.value).toBeNull()

    await live.handle().refresh()
    expect(live.handle().error.value).toBeNull()
    expect(live.handle().lastRefreshedAt.value).toBe(T0)
  })
})

describe('useLiveProduct: updatedAgo', () => {
  it('dates the last successful refresh by default, against the injected clock', async () => {
    const live = mount(async () => {}, { intervalMs: MINUTE, immediate: false })
    expect(live.handle().updatedAgo.value).toBeNull()

    await live.handle().refresh()
    expect(live.handle().updatedAgo.value).toBe('now')
    live.now.value = T0 + 3 * MINUTE
    expect(live.handle().updatedAgo.value).toBe('3 minutes ago')
  })

  it("prefers the product's own updatedAt, in any date form, and ignores an invalid one", () => {
    const updatedAt = ref<Date | number | string | null>(new Date(T0 - 2 * 3_600_000))
    const live = mount(async () => {}, { intervalMs: MINUTE, immediate: false, updatedAt })
    expect(live.handle().updatedAgo.value).toBe('2 hours ago')

    updatedAt.value = new Date(T0 - 10 * MINUTE).toISOString()
    expect(live.handle().updatedAgo.value).toBe('10 minutes ago')
    updatedAt.value = 'not a date'
    expect(live.handle().updatedAgo.value).toBeNull()
    updatedAt.value = null
    expect(live.handle().updatedAgo.value).toBeNull()
  })
})
