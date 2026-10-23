import { afterEach, describe, expect, it, vi } from 'vitest'

import { isVueAppHydrated, warmUpApp } from '../src/e2e/fixtures.js'

import type { Browser } from '@playwright/test'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ponytail-5 s6 testkit e2e', () => {
  it('#17 another Vue root on <body> does not stand in for a hydrating #__nuxt', () => {
    vi.stubGlobal('document', {
      body: { children: [{ __vue_app__: {} }] },
      getElementById: (id: string) =>
        id === '__nuxt' ? { __vue_app__: { $nuxt: { isHydrating: true } } } : null,
    })
    expect(isVueAppHydrated()).toBe(false)
  })

  it('#18 warm-up retries an HTTP 500 until the page answers', async () => {
    const statuses = [500, 503, 200]
    const goto = vi.fn(async () => ({ status: () => statuses.shift() ?? 200 }))
    const page = { goto, waitForLoadState: vi.fn(), close: vi.fn() }
    vi.useFakeTimers()
    const done = warmUpApp({ newPage: async () => page } as unknown as Browser, 'http://x.test')
    await vi.advanceTimersByTimeAsync(5_000)
    await done
    vi.useRealTimers()
    expect(goto).toHaveBeenCalledTimes(3)
  })
})
