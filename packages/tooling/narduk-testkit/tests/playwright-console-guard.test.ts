import { mergeTests } from '@playwright/test'
import { describe, expect, it } from 'vitest'

import { test as e2eTest } from '../src/e2e/fixtures.js'
import { consoleGuardFixtures, test as guardTest } from '../src/playwright/console-guard.js'

import type { ConsoleMessage, Page } from '@playwright/test'
import type { ConsoleGuardOptions } from '../src/playwright/console-guard.js'

/** A page that records its listeners so a test can emit what a browser would. */
function stubPage() {
  const consoleListeners: Array<(message: ConsoleMessage) => void> = []
  const pageErrorListeners: Array<(error: Error) => void> = []
  const page = {
    on(event: string, listener: unknown) {
      if (event === 'console') consoleListeners.push(listener as (message: ConsoleMessage) => void)
      if (event === 'pageerror') pageErrorListeners.push(listener as (error: Error) => void)
      return page
    },
    route: () => Promise.resolve(),
  }
  return {
    emitConsole(type: string, text: string) {
      const message = {
        location: () => ({ columnNumber: 0, lineNumber: 0, url: '' }),
        text: () => text,
        type: () => type,
      } as unknown as ConsoleMessage
      for (const listener of consoleListeners) listener(message)
    },
    emitPageError(error: Error) {
      for (const listener of pageErrorListeners) listener(error)
    },
    page: page as unknown as Page,
  }
}

type GuardFixture = [
  (
    args: ConsoleGuardOptions & { page: Page },
    use: (value: unknown) => Promise<void>,
  ) => Promise<void>,
  { auto?: boolean },
]

const guard = consoleGuardFixtures.consoleGuard as unknown as GuardFixture

/** Run the fixture the way Playwright does: setup, the test body, then teardown. */
function runGuard(
  stub: ReturnType<typeof stubPage>,
  body: () => void,
  options: Partial<ConsoleGuardOptions> = {},
) {
  return guard[0](
    {
      consoleAllowlist: [],
      consoleLevels: ['error'],
      consoleTelemetry: 'live',
      consoleTelemetryHosts: [],
      page: stub.page,
      ...options,
    },
    () => {
      body()
      return Promise.resolve()
    },
  )
}

describe('console guard fixture', () => {
  it('is an automatic fixture, so a spec cannot forget to ask for it', () => {
    expect(guard[1].auto).toBe(true)
  })

  it('defaults to errors only, with an empty allowlist and live telemetry', () => {
    const fixtures = consoleGuardFixtures as unknown as Record<string, [unknown, { option: true }]>
    expect(fixtures.consoleLevels?.[0]).toEqual(['error'])
    expect(fixtures.consoleAllowlist?.[0]).toEqual([])
    expect(fixtures.consoleTelemetry?.[0]).toBe('live')
    for (const name of ['consoleAllowlist', 'consoleLevels', 'consoleTelemetry']) {
      expect(fixtures[name]?.[1]).toEqual({ option: true })
    }
  })

  it('fails the test after its body when the page logged console.error', async () => {
    const stub = stubPage()
    await expect(runGuard(stub, () => stub.emitConsole('error', 'kaboom'))).rejects.toThrow(
      /\[console:error\] kaboom/u,
    )
  })

  it('fails on an uncaught page exception', async () => {
    const stub = stubPage()
    await expect(runGuard(stub, () => stub.emitPageError(new Error('uncaught')))).rejects.toThrow(
      /\[pageerror\] uncaught/u,
    )
  })

  it('does not fail on a warning in the default errors-only mode', async () => {
    const stub = stubPage()
    await expect(runGuard(stub, () => stub.emitConsole('warning', 'meh'))).resolves.toBeUndefined()
  })

  it('fails on a warning once consoleLevels asks for it', async () => {
    const stub = stubPage()
    await expect(
      runGuard(stub, () => stub.emitConsole('warning', 'meh'), {
        consoleLevels: ['error', 'warning'],
      }),
    ).rejects.toThrow(/\[console:warning\] meh/u)
  })

  it('lets allowlisted text through and still fails on other text', async () => {
    const allowed = stubPage()
    await expect(
      runGuard(allowed, () => allowed.emitConsole('error', '[build] noisy'), {
        consoleAllowlist: [/^\[build\]/u],
      }),
    ).resolves.toBeUndefined()

    const mixed = stubPage()
    await expect(
      runGuard(
        mixed,
        () => {
          mixed.emitConsole('error', '[build] noisy')
          mixed.emitConsole('error', 'real')
        },
        { consoleAllowlist: [/^\[build\]/u] },
      ),
    ).rejects.toThrow(/real/u)
  })
})

describe('console guard composition', () => {
  it('exposes a test that merges with the e2e fixtures test and extends further', () => {
    expect(typeof guardTest.extend).toBe('function')
    const merged = mergeTests(guardTest, e2eTest)
    expect(typeof merged.extend).toBe('function')
    expect(typeof merged.describe).toBe('function')
  })
})
