/// <reference lib="dom" />
// @vitest-environment happy-dom
/* The triple-slash directive must stay the first thing in the file (see
   preferences-state.test.ts): this test hydrates into a real document. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createSsrNowClock } from '../runtime/app/utils/ssrNowClock'

import type { SsrNowClockOptions } from '../runtime/app/utils/ssrNowClock'
import type { Ref } from 'vue'

/**
 * The payload store `useState` reads from. One map stands for one side of a
 * request: the server's is filled by the initialiser, and the client's is
 * seeded with the server's values as a serialised payload would be. The
 * `#imports` wiring of the real composable is pinned in use-ssr-now-wiring.test.ts;
 * this file drives the lifecycle half with real Vue SSR and hydration.
 */
const store = { state: new Map<string, unknown>() }

function useState<T>(key: string, init: () => T): Ref<T> {
  if (!store.state.has(key)) store.state.set(key, ref(init()))
  return store.state.get(key) as Ref<T>
}

function useSsrNow(key: string, options: SsrNowClockOptions = {}) {
  return createSsrNowClock(
    useState(`narduk:now:${key}`, () => Date.now()),
    options,
  )
}

const STATE_KEY = 'narduk:now:station-page'
const SERVER_NOW = Date.UTC(2026, 8, 18, 12, 0, 59, 900)
const CLIENT_NOW = Date.UTC(2026, 8, 18, 12, 1, 2, 0)
const OBSERVED_AT = Date.UTC(2026, 8, 18, 11, 27, 0, 0)

function ageComponent(tickMs?: number) {
  return defineComponent({
    setup() {
      const now = useSsrNow('station-page', tickMs === undefined ? {} : { tickMs })
      return () => h('p', {}, `${Math.floor((now.value - OBSERVED_AT) / 60_000)} min ago`)
    },
  })
}

/** Carries every server `useState` value to a fresh client store as JSON. */
function throughPayload(server: Map<string, unknown>): Map<string, unknown> {
  const client = new Map<string, unknown>()
  for (const [key, value] of server) {
    client.set(key, ref(JSON.parse(JSON.stringify((value as Ref<unknown>).value))))
  }
  return client
}

async function renderOnServer(tickMs?: number) {
  store.state = new Map()
  vi.setSystemTime(SERVER_NOW)
  const html = await renderToString(createSSRApp(ageComponent(tickMs)))
  return { html, payload: store.state }
}

function captureWarnings() {
  const warnings: string[] = []
  const capture = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  const spies = [
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
  ]
  return {
    restore: () => {
      for (const spy of spies) spy.mockRestore()
    },
    warnings,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useSsrNow', () => {
  it('stores one server reading under narduk:now:<key>', async () => {
    const { html, payload } = await renderOnServer()

    expect([...payload.keys()]).toEqual([STATE_KEY])
    expect((payload.get(STATE_KEY) as Ref<number>).value).toBe(SERVER_NOW)
    expect(html).toContain('33 min ago')
  })

  it('hydrates with the server value, then switches to the browser clock after mount', async () => {
    const { html, payload } = await renderOnServer()

    // The client clock is past a minute boundary the server was not: a render
    // that read Date.now() on each side would say 33 vs 34 and mismatch.
    store.state = throughPayload(payload)
    vi.setSystemTime(CLIENT_NOW)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const captured = captureWarnings()
    let hydratedText: string | undefined
    try {
      createSSRApp(ageComponent()).mount(container)
      // onMounted has run, but its re-render has not flushed: this is the
      // hydrated markup.
      hydratedText = container.textContent
    } finally {
      captured.restore()
    }

    expect(captured.warnings.filter((entry) => /hydrat|mismatch/iu.test(entry))).toEqual([])
    expect(hydratedText).toBe('33 min ago')

    await nextTick()
    expect(container.textContent).toBe('34 min ago')
    expect((store.state.get(STATE_KEY) as Ref<number>).value).toBe(CLIENT_NOW)
  })

  it('reproduces the mismatch when the client reads its own clock (control)', async () => {
    const { html } = await renderOnServer()

    // No payload: the client initialiser runs Date.now() itself.
    store.state = new Map()
    vi.setSystemTime(CLIENT_NOW)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const captured = captureWarnings()
    try {
      createSSRApp(ageComponent()).mount(container)
    } finally {
      captured.restore()
    }

    expect(captured.warnings.some((entry) => /hydrat|mismatch/iu.test(entry))).toBe(true)
  })

  it('ticks every tickMs after mount and clears the interval on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    store.state = new Map()
    vi.setSystemTime(CLIENT_NOW)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createSSRApp(ageComponent(60_000))
    app.mount(container)
    const now = store.state.get(STATE_KEY) as Ref<number>
    expect(now.value).toBe(CLIENT_NOW)

    vi.advanceTimersByTime(60_000)
    expect(now.value).toBe(CLIENT_NOW + 60_000)
    vi.advanceTimersByTime(60_000)
    expect(now.value).toBe(CLIENT_NOW + 120_000)
    expect(vi.getTimerCount()).toBe(1)

    app.unmount()
    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(180_000)
    expect(now.value).toBe(CLIENT_NOW + 120_000)
    clearSpy.mockRestore()
  })

  it('updates once on mount and schedules nothing without a positive tickMs', async () => {
    for (const tickMs of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      store.state = new Map([[STATE_KEY, ref(SERVER_NOW)]])
      vi.setSystemTime(CLIENT_NOW)
      const container = document.createElement('div')
      document.body.appendChild(container)

      const app = createSSRApp(ageComponent(tickMs))
      app.mount(container)

      expect((store.state.get(STATE_KEY) as Ref<number>).value).toBe(CLIENT_NOW)
      expect(vi.getTimerCount()).toBe(0)
      app.unmount()
    }
  })

  it('returns a readonly ref', () => {
    store.state = new Map()
    const captured = captureWarnings()
    let now: Readonly<Ref<number>> | undefined
    try {
      const app = createSSRApp(
        defineComponent({
          setup() {
            now = useSsrNow('readonly')
            return () => h('span')
          },
        }),
      )
      app.mount(document.createElement('div'))
      const before = now?.value
      ;(now as Ref<number>).value = 1
      expect(now?.value).toBe(before)
      app.unmount()
    } finally {
      captured.restore()
    }
    expect(captured.warnings.some((entry) => /readonly/iu.test(entry))).toBe(true)
  })
})
