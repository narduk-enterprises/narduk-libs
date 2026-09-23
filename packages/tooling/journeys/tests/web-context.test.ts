/**
 * THE HELPERS MAY NOT PARK.
 *
 * narduk-libs#77: `scrollIntoViewIfNeeded()` was called with no options, and
 * Playwright's default action timeout is zero — no timeout at all. Two hosted
 * capture builds died at 17 minutes each on one beat whose test-mode twin
 * passed in 11 seconds.
 *
 * The property under test is not "the helper works". It is "the helper
 * TERMINATES against a page that will never let the action complete", which is
 * exactly the condition a browser-backed test cannot produce on demand and a
 * fake page can produce every time. So the page here answers
 * `scrollIntoViewIfNeeded()` with a promise that NEVER RESOLVES unless it was
 * given a timeout — which is what an unbounded Playwright call does, modelled
 * honestly rather than mocked away. Delete the bound in `src/web.ts` and these
 * tests hang until vitest kills them, which is the failure the library shipped.
 */
import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'

import { createContextApi } from '../src/web.js'

interface Recorded {
  method: string
  options: { timeout?: number } | undefined
}

/**
 * A page whose every awaited call is recorded, and whose scroll behaves like
 * the real one: unbounded means forever.
 */
function fakePage(options: { textPresent?: boolean } = {}): {
  page: Page
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  const record = (method: string, opts?: { timeout?: number }): void => {
    calls.push({ method, options: opts })
  }
  const locator = {
    nth: () => locator,
    first: () => locator,
    async count() {
      return options.textPresent === false ? 0 : 1
    },
    async waitFor(opts?: { timeout?: number }) {
      record('waitFor', opts)
    },
    async scrollIntoViewIfNeeded(opts?: { timeout?: number }) {
      record('scrollIntoViewIfNeeded', opts)
      if (opts?.timeout === undefined) {
        // The zero-timeout default, modelled: an action that never becomes
        // possible and was given no bound never settles.
        return new Promise<never>(() => {})
      }
      throw new Error(`Timeout ${opts.timeout}ms exceeded.`)
    },
    async click(opts?: { timeout?: number }) {
      record('click', opts)
    },
    async hover(opts?: { timeout?: number }) {
      record('hover', opts)
      throw new Error(`Timeout ${opts?.timeout ?? 0}ms exceeded.`)
    },
  }
  const page = {
    getByRole: () => locator,
    getByText: () => locator,
    mouse: { async wheel() {} },
    async goto(_url: string, opts?: { timeout?: number }) {
      record('goto', opts)
    },
    async waitForLoadState(_state: string, opts?: { timeout?: number }) {
      record('waitForLoadState', opts)
    },
    url: () => 'http://fake/',
  }
  return { page: page as unknown as Page, calls }
}

const bounded = (calls: Recorded[]): Recorded[] =>
  calls.filter((call) => typeof call.options?.timeout !== 'number')

describe('the web context helpers are bounded', () => {
  it('must() clicks through a scroll that would never settle', { timeout: 5_000 }, async () => {
    const { page, calls } = fakePage()
    const api = createContextApi(page, 'http://fake', 'test')

    await api.must('Finish')

    expect(calls.map((call) => call.method)).toContain('scrollIntoViewIfNeeded')
    // The press still happened: a bound on the pre-scroll degrades to clicking
    // without it, which `click()` does for itself under its own bound.
    expect(calls.map((call) => call.method)).toContain('click')
    expect(bounded(calls)).toEqual([])
  })

  it(
    'point() finishes its highlight against an element it can never reach',
    { timeout: 8_000 },
    async () => {
      const { page, calls } = fakePage()
      const api = createContextApi(page, 'http://fake', 'capture')

      await api.point('Invoices')

      expect(calls.map((call) => call.method)).toEqual([
        'scrollIntoViewIfNeeded',
        // hover is reached at all only because the scroll before it terminated
        'hover',
      ])
      expect(bounded(calls)).toEqual([])
    },
  )

  it('goto() bounds both of its waits', { timeout: 5_000 }, async () => {
    const { page, calls } = fakePage()
    const api = createContextApi(page, 'http://fake', 'test')

    await api.goto('/start')

    expect(calls.map((call) => call.method)).toEqual(['goto', 'waitForLoadState'])
    expect(bounded(calls)).toEqual([])
  })

  it('point() on absent copy draws nothing and still terminates', { timeout: 5_000 }, async () => {
    const { page, calls } = fakePage({ textPresent: false })
    const api = createContextApi(page, 'http://fake', 'capture')

    await api.point('nothing on this page')

    expect(calls).toEqual([])
  })
})

describe('a must() that finds nothing says what was there (#68)', () => {
  function emptyPage(byRole: Record<string, string[] | Error>): Page {
    const page = {
      url: () => 'https://trac-demo.example/board',
      getByRole: (role: string) => ({
        nth: () => ({
          async waitFor() {},
          async count() {
            return 0
          },
        }),
        async evaluateAll() {
          const names = byRole[role] ?? []
          if (names instanceof Error) throw names
          return names
        },
      }),
    }
    return page as unknown as Page
  }

  it('names the page, the buttons present and, for a button, the links', async () => {
    const api = createContextApi(
      emptyPage({
        button: ['Place trailer', '', 'Record arrival check-in'],
        link: ['Load into station'],
      }),
      'https://trac-demo.example',
      'test',
    )
    await expect(api.must('Load into station')).rejects.toThrow(
      [
        'no button matching "Load into station" on https://trac-demo.example/board',
        '  buttons on the page: "Place trailer", "Record arrival check-in"',
        '  links on the page: "Load into station"',
      ].join('\n'),
    )
  })

  it('caps the list at 20 names of 60 characters, and says when a role has none', async () => {
    const names = Array.from({ length: 23 }, (_, index) => `${index}`.padEnd(80, 'x'))
    const api = createContextApi(emptyPage({ tab: names }), 'https://x.example', 'test')
    const error = await api.must(/Settings/, { role: 'tab' }).catch((caught: Error) => caught)
    const message = (error as Error).message
    expect(message).toMatch(
      /^no tab matching \/Settings\/ on https:\/\/trac-demo\.example\/board\n/,
    )
    expect(message).toContain(`"0${'x'.repeat(58)}…"`)
    expect(message).toContain('(+3 more)')
    expect(message).not.toContain('links on the page')
    const none = createContextApi(emptyPage({}), 'https://x.example', 'test')
    await expect(none.must('Go')).rejects.toThrow(
      /\n {2}no buttons on the page\n {2}no links on the page$/,
    )
  })

  it('never lets the listing mask the failure it describes', async () => {
    const api = createContextApi(
      emptyPage({ button: new Error('page closed'), link: new Error('page closed') }),
      'https://x.example',
      'test',
    )
    await expect(api.must('Go')).rejects.toThrow(
      /^no button matching "Go" on https:\/\/trac-demo\.example\/board$/,
    )
  })
})
