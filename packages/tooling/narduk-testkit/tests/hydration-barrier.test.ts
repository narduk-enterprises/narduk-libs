import { afterEach, describe, expect, it, vi } from 'vitest'

import { isVueAppHydrated, waitForHydration, waitForVueHydrated } from '../src/e2e/fixtures.js'

import type { Page } from '@playwright/test'

type Root = { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } } | null

function stubDocument(nuxtRoot: Root, bodyChildren: Root[] = []) {
  vi.stubGlobal('document', {
    body: { children: bodyChildren },
    getElementById: (id: string) => (id === '__nuxt' ? nuxtRoot : null),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isVueAppHydrated (#697)', () => {
  it('is false for server-rendered markup the client has not mounted', () => {
    stubDocument({})
    expect(isVueAppHydrated()).toBe(false)
  })

  it('is false while Nuxt is still hydrating, and true once it has finished', () => {
    const nuxt = { isHydrating: true }
    stubDocument({ __vue_app__: { $nuxt: nuxt } })
    expect(isVueAppHydrated()).toBe(false)
    nuxt.isHydrating = false
    expect(isVueAppHydrated()).toBe(true)
  })

  it('finds an app mounted on a custom root under <body>', () => {
    stubDocument(null, [{}, { __vue_app__: { $nuxt: { isHydrating: false } } }])
    expect(isVueAppHydrated()).toBe(true)
  })

  it('treats a mounted plain Vue app as hydrated', () => {
    stubDocument({ __vue_app__: {} })
    expect(isVueAppHydrated()).toBe(true)
  })
})

describe('the wait helpers', () => {
  it('waitForVueHydrated waits on the app, not the document', async () => {
    const waitForFunction = vi.fn().mockResolvedValue(undefined)
    const waitForLoadState = vi.fn()
    await waitForVueHydrated({ waitForFunction, waitForLoadState } as unknown as Page, {
      timeout: 5000,
    })
    expect(waitForFunction).toHaveBeenCalledWith(isVueAppHydrated, undefined, { timeout: 5000 })
    expect(waitForLoadState).not.toHaveBeenCalled()
  })

  it('the deprecated waitForHydration keeps its document-load behaviour', async () => {
    const waitForFunction = vi.fn()
    const waitForLoadState = vi.fn().mockResolvedValue(undefined)
    await waitForHydration({ waitForFunction, waitForLoadState } as unknown as Page)
    expect(waitForLoadState.mock.calls).toEqual([['domcontentloaded'], ['load']])
    expect(waitForFunction).not.toHaveBeenCalled()
  })
})
