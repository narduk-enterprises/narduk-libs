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

describe('assertion vocabulary (#67)', () => {
  interface AssertionCall {
    method: string
    options?: unknown
  }

  function locatorFrom(hooks: {
    count: () => number | Promise<number>
    waitFor?: (opts?: { state?: string; timeout?: number }) => Promise<void>
    isVisible?: () => boolean | Promise<boolean>
    fill?: (value: string) => Promise<void>
    inputValue?: () => Promise<string>
    setInputFiles?: (files: unknown, opts?: { timeout?: number }) => Promise<void>
    records?: AssertionCall[]
  }) {
    const records = hooks.records
    const locator = {
      first: () => locator,
      nth: () => locator,
      async count() {
        return hooks.count()
      },
      async isVisible() {
        return hooks.isVisible ? hooks.isVisible() : (await hooks.count()) > 0
      },
      async waitFor(opts?: { state?: string; timeout?: number }) {
        records?.push({ method: 'waitFor', options: opts })
        await hooks.waitFor?.(opts)
      },
      async fill(value: string, opts?: { timeout?: number }) {
        records?.push({ method: 'fill', options: opts })
        await hooks.fill?.(value)
      },
      async inputValue() {
        return hooks.inputValue?.() ?? ''
      },
      async setInputFiles(files: unknown, opts?: { timeout?: number }) {
        records?.push({ method: 'setInputFiles', options: { files, ...opts } })
        await hooks.setInputFiles?.(files, opts)
      },
    }
    return locator
  }

  it('see() waits rather than reading once — a first sample of nothing is not a miss', async () => {
    let visible = false
    let textOpts: { exact?: boolean } | undefined
    const locator = locatorFrom({
      count: () => (visible ? 1 : 0),
      async waitFor() {
        visible = true
      },
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: (_text: string, opts?: { exact?: boolean }) => {
        textOpts = opts
        return locator
      },
    } as unknown as Page
    const api = createContextApi(page, 'https://yard.example', 'test')
    await api.see('VERIFIED')
    expect(textOpts).toEqual({ exact: true })
  })

  it('see() names the text, the URL and the timeout when it never arrives', async () => {
    const locator = locatorFrom({
      count: () => 0,
      async waitFor() {},
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: () => locator,
    } as unknown as Page
    const api = createContextApi(page, 'https://yard.example', 'test')
    await expect(api.see('VERIFIED', { timeout: 40 })).rejects.toThrow(
      'expected "VERIFIED" on https://yard.example/board within 40ms',
    )
  })

  it('see() does not pass when the text is in the DOM but not visible', async () => {
    const locator = locatorFrom({
      count: () => 1,
      isVisible: () => false,
      async waitFor() {
        throw new Error('Timeout 40ms exceeded.')
      },
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: () => locator,
    } as unknown as Page
    await expect(
      createContextApi(page, 'https://yard.example', 'test').see('VERIFIED', { timeout: 40 }),
    ).rejects.toThrow('expected "VERIFIED" on https://yard.example/board within 40ms')
  })

  it('see() matches a string exactly, so VERIFIED does not pass on PENDING VERIFICATION', async () => {
    const seen: Array<{ exact?: boolean }> = []
    const locator = locatorFrom({
      count: () => 1,
      async waitFor() {},
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: (_text: string, opts?: { exact?: boolean }) => {
        seen.push(opts ?? {})
        return locator
      },
    } as unknown as Page
    await createContextApi(page, 'https://yard.example', 'test').see('VERIFIED')
    expect(seen).toEqual([{ exact: true }])
  })

  it('hasControl() is by accessible name, never body text', async () => {
    const seen: Array<{ name?: string | RegExp; exact?: boolean }> = []
    const locator = locatorFrom({
      count: () => 1,
      async waitFor() {},
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByRole: (_role: string, opts?: { name?: string | RegExp; exact?: boolean }) => {
        seen.push(opts ?? {})
        return locator
      },
    } as unknown as Page
    await createContextApi(page, 'https://yard.example', 'test').hasControl('Cancel')
    expect(seen).toEqual([{ name: 'Cancel', exact: true }])
  })

  it('hasControl() does not pass when the control is in the tree but not visible', async () => {
    const locator = locatorFrom({
      count: () => 1,
      isVisible: () => false,
      async waitFor() {
        throw new Error('Timeout 40ms exceeded.')
      },
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByRole: () => locator,
    } as unknown as Page
    await expect(
      createContextApi(page, 'https://yard.example', 'test').hasControl('Cancel', { timeout: 40 }),
    ).rejects.toThrow(/^no button matching "Cancel" on https:\/\/yard.example\/board$/)
  })

  it('noControl() polls count() to zero and never waitFor(detached)', async () => {
    const records: AssertionCall[] = []
    let remaining = 2
    const locator = locatorFrom({
      records,
      count: () => {
        remaining -= 1
        return remaining > 0 ? 1 : 0
      },
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByRole: () => locator,
    } as unknown as Page
    await createContextApi(page, 'https://yard.example', 'test').noControl('Record as sent', {
      timeout: 200,
    })
    expect(records.filter((call) => call.method === 'waitFor')).toEqual([])
  })

  it('noControl() throws while the control is still offered', async () => {
    const locator = locatorFrom({ count: () => 1 })
    const page = {
      url: () => 'https://yard.example/board',
      getByRole: () => locator,
    } as unknown as Page
    await expect(
      createContextApi(page, 'https://yard.example', 'test').noControl('Record as sent', {
        timeout: 40,
      }),
    ).rejects.toThrow(
      'expected no button named "Record as sent" on https://yard.example/board within 40ms',
    )
  })

  it('gone() does not pass on a first sample of nothing — that is not evidence it left', async () => {
    const locator = locatorFrom({ count: () => 0 })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: () => locator,
    } as unknown as Page
    await expect(
      createContextApi(page, 'https://yard.example', 'test').gone(
        'Records that the invoice was sent.',
        { timeout: 40 },
      ),
    ).rejects.toThrow(/never saw "Records that the invoice was sent\."/)
  })

  it('gone() waits until text that was present has left', async () => {
    let count = 1
    const locator = locatorFrom({
      count: () => {
        const current = count
        count = 0
        return current
      },
    })
    const page = {
      url: () => 'https://yard.example/board',
      getByText: (_text: string, opts?: { exact?: boolean }) => {
        expect(opts).toEqual({ exact: true })
        return locator
      },
    } as unknown as Page
    await createContextApi(page, 'https://yard.example', 'test').gone('Working…', { timeout: 200 })
  })

  it('fill() reads the value back and fails when a different box took it', async () => {
    const locator = locatorFrom({
      count: () => 1,
      async waitFor() {},
      async fill() {},
      async inputValue() {
        return 'other'
      },
    })
    const page = {
      url: () => 'https://yard.example/form',
      getByLabel: () => locator,
    } as unknown as Page
    await expect(
      createContextApi(page, 'https://yard.example', 'test').fill('Quantity', '12'),
    ).rejects.toThrow('fill wrote "12" but the field reads "other" on https://yard.example/form')
  })

  it('fill() uses a label for a name and a locator for a selector', async () => {
    const labels: string[] = []
    const selectors: string[] = []
    const locator = locatorFrom({
      count: () => 1,
      async waitFor() {},
      async fill() {},
      async inputValue() {
        return '12'
      },
    })
    const page = {
      url: () => 'https://yard.example/form',
      getByLabel: (name: string) => {
        labels.push(name)
        return locator
      },
      locator: (selector: string) => {
        selectors.push(selector)
        return locator
      },
    } as unknown as Page
    const api = createContextApi(page, 'https://yard.example', 'test')
    await api.fill('Quantity', '12')
    await api.fill('input[name=qty]', '12')
    expect(labels).toEqual(['Quantity'])
    expect(selectors).toEqual(['input[name=qty]'])
  })

  it('attach() sets files through a bounded input locator', async () => {
    const records: AssertionCall[] = []
    const locator = locatorFrom({
      records,
      count: () => 1,
      async waitFor() {},
      async setInputFiles() {},
    })
    const page = {
      url: () => 'https://yard.example/form',
      locator: () => locator,
    } as unknown as Page
    await createContextApi(page, 'https://yard.example', 'test').attach('input[type=file]', {
      name: 'ticket.csv',
      mimeType: 'text/csv',
      buffer: new Uint8Array([1, 2]),
    })
    expect(records.some((call) => call.method === 'setInputFiles')).toBe(true)
    expect(
      records.filter((call) => call.method === 'waitFor' && typeof call.options === 'object'),
    ).not.toEqual([])
  })

  it('refuses a timeout that would make Playwright wait forever', async () => {
    const page = { url: () => 'https://yard.example/' } as unknown as Page
    const api = createContextApi(page, 'https://yard.example', 'test')
    await expect(api.see('x', { timeout: 0 })).rejects.toThrow(/positive finite/)
    await expect(api.see('x', { timeout: Number.NaN })).rejects.toThrow(/positive finite/)
    const previous = process.env.JOURNEYS_ASSERT_TIMEOUT
    process.env.JOURNEYS_ASSERT_TIMEOUT = '0'
    try {
      await expect(api.hasControl('Go')).rejects.toThrow(/positive finite/)
    } finally {
      if (previous === undefined) delete process.env.JOURNEYS_ASSERT_TIMEOUT
      else process.env.JOURNEYS_ASSERT_TIMEOUT = previous
    }
  })
})
