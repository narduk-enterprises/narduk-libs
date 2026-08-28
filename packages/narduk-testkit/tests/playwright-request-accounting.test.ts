import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectRequestCounts, readResourceRequests } from '../src/playwright/request-accounting.js'

import type { Page } from '@playwright/test'

const ORIGIN = 'http://127.0.0.1:4173'

/**
 * A page whose `evaluate` really runs the callback, against a stubbed Resource Timing API.
 *
 * Stubbing the RESULT would leave the part that actually decides what gets counted — the origin
 * filter, the scope filter, the relative-path arithmetic — untested. Stubbing `performance` and
 * `location` instead means the browser-side code in this module is the code under test.
 */
function stubPage(resources: string[]) {
  const loadStates: string[] = []
  vi.stubGlobal('performance', {
    getEntriesByType: (type: string) =>
      type === 'resource' ? resources.map((name) => ({ name })) : [],
  })
  vi.stubGlobal('location', { origin: ORIGIN })

  const page = {
    evaluate: (callback: (argument: never) => unknown, argument: unknown) =>
      Promise.resolve(callback(argument as never)),
    waitForLoadState: (state: string) => {
      loadStates.push(state)
      return Promise.resolve()
    },
  }

  return { loadStates, page: page as unknown as Page }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readResourceRequests', () => {
  it('reports same-origin requests as paths', async () => {
    const stub = stubPage([
      `${ORIGIN}/api/overview?boatClass=bay`,
      `${ORIGIN}/assets/index.js`,
      'https://fonts.googleapis.com/css2?family=Inter',
    ])

    await expect(readResourceRequests(stub.page)).resolves.toEqual([
      '/api/overview?boatClass=bay',
      '/assets/index.js',
    ])
  })

  it('narrows to a scope', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview`, `${ORIGIN}/assets/index.js`])

    await expect(readResourceRequests(stub.page, { scope: '/api/' })).resolves.toEqual([
      '/api/overview',
    ])
  })

  it('can report absolute URLs', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview`])

    await expect(readResourceRequests(stub.page, { relative: false })).resolves.toEqual([
      `${ORIGIN}/api/overview`,
    ])
  })

  it('waits for the network to go quiet, because a count taken mid-flight is a race', async () => {
    const stub = stubPage([])
    await readResourceRequests(stub.page)

    expect(stub.loadStates).toEqual(['networkidle'])
  })

  it('can be told not to wait', async () => {
    const stub = stubPage([])
    await readResourceRequests(stub.page, { waitForIdle: false })

    expect(stub.loadStates).toEqual([])
  })
})

describe('expectRequestCounts', () => {
  it('passes when the page fetched exactly what the budget allows', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview?boatClass=bay`, `${ORIGIN}/api/map-context`])

    await expect(
      expectRequestCounts(
        stub.page,
        { '/api/map-context': 1, '/api/overview': 1 },
        { scope: '/api/' },
      ),
    ).resolves.toBeUndefined()
  })

  it('catches the duplicate fetch it exists to catch', async () => {
    const stub = stubPage([
      `${ORIGIN}/api/overview`,
      `${ORIGIN}/api/overview?boatClass=bay`,
      `${ORIGIN}/api/map-context`,
    ])

    await expect(
      expectRequestCounts(
        stub.page,
        { '/api/map-context': 1, '/api/overview': 1 },
        { scope: '/api/' },
      ),
    ).rejects.toThrow(/cold-boot budget/)
  })

  it('catches a request nobody budgeted for', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview`, `${ORIGIN}/api/telemetry`])

    await expect(
      expectRequestCounts(stub.page, { '/api/overview': 1 }, { scope: '/api/' }),
    ).rejects.toThrow(/in no budget entry/)
  })

  it('lets a budget with no scope stay open-ended', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview`, `${ORIGIN}/api/telemetry`])

    await expect(expectRequestCounts(stub.page, { '/api/overview': 1 })).resolves.toBeUndefined()
  })

  it('gives a path to the longest matching prefix, so a nested budget is possible', async () => {
    const stub = stubPage([
      `${ORIGIN}/api/routes/galveston`,
      `${ORIGIN}/api/routes/cameron`,
      `${ORIGIN}/api/overview`,
    ])

    await expect(
      expectRequestCounts(stub.page, { '/api/': 1, '/api/routes/': 2 }, { scope: '/api/' }),
    ).resolves.toBeUndefined()
  })

  it('accepts a zero budget as "this must not be fetched at all"', async () => {
    const stub = stubPage([`${ORIGIN}/api/overview`])

    await expect(
      expectRequestCounts(stub.page, { '/api/legacy': 0, '/api/overview': 1 }, { scope: '/api/' }),
    ).resolves.toBeUndefined()
  })
})
