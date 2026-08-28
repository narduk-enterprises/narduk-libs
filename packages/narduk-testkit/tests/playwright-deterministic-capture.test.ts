import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureStableScreenshot,
  emulateReducedMotion,
  expectRepeatableCapture,
  freezePageClock,
  prepareDeterministicPage,
  waitForVisualQuiescence,
} from '../src/playwright/deterministic-capture.js'

import type { Page } from '@playwright/test'

const FROZEN = '2026-08-28T14:00:00.000Z'

interface InitScriptCall {
  argument: unknown
  script: (argument: never) => void
}

/**
 * The smallest object these helpers actually use, so a test can drive them without a browser.
 *
 * Every method records what it was asked for, which is the point: what matters about
 * `freezePageClock` is the script it installs and when, and what matters about
 * `captureStableScreenshot` is the viewport arithmetic around the two captures.
 */
function stubPage(
  options: {
    documentHeight?: number
    screenshots?: Uint8Array[]
    viewport?: { height: number; width: number } | null
  } = {},
) {
  const shots = [...(options.screenshots ?? [new Uint8Array([1, 2, 3])])]
  const initScripts: InitScriptCall[] = []
  const media: unknown[] = []
  const screenshotOptions: unknown[] = []
  const viewports: Array<{ height: number; width: number } | null> = []
  const loadStates: string[] = []
  let viewport = options.viewport === undefined ? { height: 800, width: 1280 } : options.viewport

  const page = {
    addInitScript: (script: (argument: never) => void, argument: unknown) => {
      initScripts.push({ argument, script })
      return Promise.resolve()
    },
    emulateMedia: (value: unknown) => {
      media.push(value)
      return Promise.resolve()
    },
    evaluate: (callback: unknown, argument: unknown) => {
      void callback
      void argument
      return Promise.resolve(options.documentHeight ?? 2000)
    },
    screenshot: (value: unknown) => {
      screenshotOptions.push(value)
      return Promise.resolve(
        shots.length > 1 ? (shots.shift() as Uint8Array) : (shots[0] as Uint8Array),
      )
    },
    setViewportSize: (size: { height: number; width: number }) => {
      viewports.push(size)
      viewport = size
      return Promise.resolve()
    },
    viewportSize: () => viewport,
    waitForLoadState: (state: string) => {
      loadStates.push(state)
      return Promise.resolve()
    },
  }

  return {
    initScripts,
    loadStates,
    media,
    page: page as unknown as Page,
    screenshotOptions,
    viewports,
  }
}

describe('freezePageClock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs the frozen clock before any page script runs', async () => {
    const stub = stubPage()
    await freezePageClock(stub.page, FROZEN)

    expect(stub.initScripts).toHaveLength(1)
    expect(stub.initScripts[0]?.argument).toEqual({
      fixedMs: Date.parse(FROZEN),
      freezePerformanceNow: false,
    })
  })

  it('pins the two time readers and leaves the rest of Date alone', async () => {
    const stub = stubPage()
    await freezePageClock(stub.page, new Date(FROZEN))

    const windowStub = {} as { Date: DateConstructor }
    vi.stubGlobal('window', windowStub)
    const call = stub.initScripts[0]
    ;(call?.script as (argument: unknown) => void)(call?.argument)

    const Frozen = windowStub.Date
    expect(Frozen.now()).toBe(Date.parse(FROZEN))
    expect(new Frozen().toISOString()).toBe(FROZEN)
    // Everything else still behaves like the real constructor.
    expect(new Frozen(0).toISOString()).toBe('1970-01-01T00:00:00.000Z')
    expect(Frozen.parse('2020-01-02T03:04:05.000Z')).toBe(Date.parse('2020-01-02T03:04:05.000Z'))
    expect(Frozen.UTC(2020, 0, 2)).toBe(Date.UTC(2020, 0, 2))
    expect(new Frozen() instanceof Date).toBe(true)
  })

  it('leaves performance alone unless asked, which is the whole reason it is not page.clock', async () => {
    const stub = stubPage()
    await freezePageClock(stub.page, FROZEN)
    vi.stubGlobal('window', {} as { Date: DateConstructor })
    const call = stub.initScripts[0]
    ;(call?.script as (argument: unknown) => void)(call?.argument)

    // The Resource Timing API is untouched: `page.clock` is what replaces it with a stub.
    expect(typeof performance.getEntriesByType).toBe('function')
    expect(Array.isArray(performance.getEntriesByType('resource'))).toBe(true)
  })

  it('refuses an instant it cannot read', async () => {
    const stub = stubPage()
    await expect(freezePageClock(stub.page, 'not a date')).rejects.toThrow(/real instant/)
  })
})

describe('prepareDeterministicPage', () => {
  it('freezes the clock and applies the emulation the config silently drops', async () => {
    const stub = stubPage()
    await prepareDeterministicPage(stub.page, { now: FROZEN })

    expect(stub.initScripts).toHaveLength(1)
    expect(stub.media).toEqual([{ reducedMotion: 'reduce' }])
  })

  it('leaves the clock alone when no instant is given', async () => {
    const stub = stubPage()
    await prepareDeterministicPage(stub.page)

    expect(stub.initScripts).toHaveLength(0)
    expect(stub.media).toEqual([{ reducedMotion: 'reduce' }])
  })

  it('can skip the motion emulation for a suite that is testing motion', async () => {
    const stub = stubPage()
    await prepareDeterministicPage(stub.page, { now: FROZEN, reducedMotion: false })

    expect(stub.media).toEqual([])
  })
})

describe('emulateReducedMotion', () => {
  it('emulates on the page rather than trusting the project declaration', async () => {
    const stub = stubPage()
    await emulateReducedMotion(stub.page)

    expect(stub.media).toEqual([{ reducedMotion: 'reduce' }])
  })
})

describe('waitForVisualQuiescence', () => {
  it('waits for the network before looking at the DOM', async () => {
    const stub = stubPage()
    await waitForVisualQuiescence(stub.page)

    expect(stub.loadStates).toEqual(['networkidle'])
  })

  it('can skip the network wait for a page that holds a connection open', async () => {
    const stub = stubPage()
    await waitForVisualQuiescence(stub.page, { skipNetworkIdle: true })

    expect(stub.loadStates).toEqual([])
  })
})

describe('captureStableScreenshot', () => {
  it('photographs twice and returns the first when the page is at rest', async () => {
    const stub = stubPage({ screenshots: [new Uint8Array([7, 7, 7])] })
    const bytes = await captureStableScreenshot(stub.page, { path: 'shot.png' })

    expect(bytes).toEqual(new Uint8Array([7, 7, 7]))
    expect(stub.screenshotOptions).toHaveLength(2)
    expect(stub.screenshotOptions[0]).toMatchObject({ animations: 'disabled', path: 'shot.png' })
    // Only the first capture is written; the second exists to prove the first.
    expect(stub.screenshotOptions[1]).not.toHaveProperty('path')
  })

  it('re-settles and tries again when a capture pair disagrees, rather than failing on the spot', async () => {
    // Pair one disagrees; pair two matches. A loaded runner slipping one paint into the gap must
    // not turn into a red test, because "re-run it and it went away" is the whole problem here.
    const stub = stubPage({
      screenshots: [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        new Uint8Array([3]),
      ],
    })

    await expect(captureStableScreenshot(stub.page)).resolves.toEqual(new Uint8Array([3]))
    expect(stub.loadStates).toEqual(['networkidle', 'networkidle'])
  })

  it('fails, by name, when no pair ever agrees', async () => {
    const stub = stubPage({
      screenshots: [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        new Uint8Array([4]),
        new Uint8Array([5]),
        new Uint8Array([6]),
      ],
    })

    await expect(captureStableScreenshot(stub.page, { label: 'the dashboard' })).rejects.toThrow(
      /the dashboard was still changing.*3 consecutive capture pairs disagreed/s,
    )
  })

  it('can be told to try exactly once', async () => {
    const stub = stubPage({ screenshots: [new Uint8Array([1]), new Uint8Array([2])] })

    await expect(captureStableScreenshot(stub.page, { attempts: 1 })).rejects.toThrow(
      /1 consecutive capture pairs disagreed/,
    )
  })

  it('grows the viewport to the document instead of using Playwright fullPage, then restores it', async () => {
    const stub = stubPage({ documentHeight: 2400 })
    await captureStableScreenshot(stub.page, { fullPage: true })

    expect(stub.viewports).toEqual([
      { height: 2400, width: 1280 },
      { height: 800, width: 1280 },
    ])
    // The capture itself is an ordinary viewport shot: no `fullPage` reaches Playwright.
    expect(stub.screenshotOptions[0]).not.toHaveProperty('fullPage')
  })

  it('never asks for a viewport past the texture ceiling', async () => {
    const stub = stubPage({ documentHeight: 99_000 })
    await captureStableScreenshot(stub.page, { fullPage: true })

    expect(stub.viewports[0]).toEqual({ height: 16_384, width: 1280 })
  })

  it('restores the viewport even when no pair ever agrees', async () => {
    const stub = stubPage({
      documentHeight: 2400,
      screenshots: [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        new Uint8Array([4]),
        new Uint8Array([5]),
        new Uint8Array([6]),
      ],
    })

    await expect(captureStableScreenshot(stub.page, { fullPage: true })).rejects.toThrow()
    expect(stub.viewports.at(-1)).toEqual({ height: 800, width: 1280 })
  })

  it('passes documented masks through to Playwright', async () => {
    const stub = stubPage()
    await captureStableScreenshot(stub.page, {
      mask: [
        {
          locator: { selector: '.map-canvas' } as never,
          reason: 'a live WebGL canvas that renders a frame counter',
        },
      ],
      maskColor: '#000000',
    })

    expect(stub.screenshotOptions[0]).toMatchObject({
      mask: [{ selector: '.map-canvas' }],
      maskColor: '#000000',
    })
  })
})

describe('expectRepeatableCapture', () => {
  it('passes when every attempt produces the same bytes', async () => {
    let calls = 0
    const bytes = await expectRepeatableCapture(
      () => {
        calls += 1
        return Promise.resolve(new Uint8Array([9, 9]))
      },
      { attempts: 3 },
    )

    expect(calls).toBe(3)
    expect(bytes).toEqual(new Uint8Array([9, 9]))
  })

  it('names the attempt that drifted', async () => {
    const shots = [new Uint8Array([1]), new Uint8Array([1]), new Uint8Array([2])]
    let index = 0

    await expect(
      expectRepeatableCapture(() => Promise.resolve(shots[index++] as Uint8Array), {
        attempts: 3,
        label: 'the home screen',
      }),
    ).rejects.toThrow(/the home screen is not reproducible: attempt 3 of 3/)
  })

  it('always runs at least twice, whatever it is asked for', async () => {
    let calls = 0
    await expectRepeatableCapture(
      () => {
        calls += 1
        return Promise.resolve(new Uint8Array([0]))
      },
      { attempts: 1 },
    )

    expect(calls).toBe(2)
  })
})
