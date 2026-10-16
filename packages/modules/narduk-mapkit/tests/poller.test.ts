import { describe, expect, it, vi } from 'vitest'

import { createMapKitPoller, mapKitMapLimit } from '../src/client/poller.js'

import { createFakeTimer, flushMicrotasks } from './fake-timer.js'

function setup(run: () => Promise<number> = () => Promise.resolve(1)) {
  const timers = createFakeTimer()
  let visible = true
  const results: number[] = []
  const errors: unknown[] = []
  const runner = vi.fn(run)
  const poller = createMapKitPoller<number>({
    intervalMs: 15_000,
    isVisible: () => visible,
    onError: (error) => errors.push(error),
    onResult: (value) => results.push(value),
    run: runner,
    timers,
  })
  return {
    errors,
    poller,
    results,
    runner,
    setVisible: (value: boolean) => {
      visible = value
    },
    timers,
  }
}

describe('createMapKitPoller', () => {
  it('asks at once, then every interval', async () => {
    const { poller, results, runner, timers } = setup()
    poller.start()
    await flushMicrotasks()
    expect(runner).toHaveBeenCalledTimes(1)
    expect(results).toStrictEqual([1])

    timers.advance(14_999)
    expect(runner).toHaveBeenCalledTimes(1)
    timers.advance(1)
    await flushMicrotasks()
    expect(runner).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('never runs two requests at once', async () => {
    let release: (value: number) => void = vi.fn()
    const { poller, runner } = setup(
      () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
    )
    poller.start()
    poller.visibilityChanged()
    poller.start()
    expect(runner).toHaveBeenCalledTimes(1)
    release(1)
    await flushMicrotasks()
    poller.stop()
  })

  it('sets no timer while hidden, and asks straight away when the tab returns', async () => {
    const { poller, runner, setVisible, timers } = setup()
    poller.start()
    await flushMicrotasks()
    setVisible(false)
    poller.visibilityChanged()
    expect(timers.pending()).toBe(0)

    timers.advance(60_000)
    expect(runner).toHaveBeenCalledTimes(1)

    setVisible(true)
    poller.visibilityChanged()
    await flushMicrotasks()
    expect(runner).toHaveBeenCalledTimes(2)
    expect(timers.pending()).toBe(1)
    poller.stop()
  })

  it('does not start a request in a hidden tab', async () => {
    const { poller, runner, setVisible } = setup()
    setVisible(false)
    poller.start()
    await flushMicrotasks()
    expect(runner).not.toHaveBeenCalled()
  })

  it('throws away an answer that was in flight when it was restarted', async () => {
    const releases: Array<(value: number) => void> = []
    const { poller, results, runner } = setup(
      () =>
        new Promise<number>((resolve) => {
          releases.push(resolve)
        }),
    )
    poller.start()
    poller.restart()
    releases[0]?.(1)
    await flushMicrotasks()
    expect(results).toStrictEqual([])
    // The restart asked again once the stale request landed.
    expect(runner).toHaveBeenCalledTimes(2)
    releases[1]?.(2)
    await flushMicrotasks()
    expect(results).toStrictEqual([2])
    poller.stop()
  })

  it('drops an answer that lands after stop', async () => {
    let release: (value: number) => void = vi.fn()
    const { poller, results, timers } = setup(
      () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
    )
    poller.start()
    poller.stop()
    release(1)
    await flushMicrotasks()
    expect(results).toStrictEqual([])
    expect(timers.pending()).toBe(0)
  })

  it('keeps polling after a failed request and reports it', async () => {
    let calls = 0
    const { errors, poller, results, timers } = setup(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error('feed down')) : Promise.resolve(7)
    })
    poller.start()
    await flushMicrotasks()
    expect(errors).toHaveLength(1)
    timers.advance(15_000)
    await flushMicrotasks()
    expect(results).toStrictEqual([7])
    poller.stop()
  })
})

describe('createMapKitPoller default visibility', () => {
  it('reads document.hidden, like the moving-marker layer', async () => {
    const doc = { hidden: true }
    vi.stubGlobal('document', doc)
    try {
      const timers = createFakeTimer()
      const run = vi.fn(() => Promise.resolve(1))
      const poller = createMapKitPoller<number>({
        intervalMs: 1000,
        onResult: vi.fn(),
        run,
        timers,
      })
      poller.start()
      await flushMicrotasks()
      expect(run).not.toHaveBeenCalled()

      doc.hidden = false
      poller.visibilityChanged()
      await flushMicrotasks()
      expect(run).toHaveBeenCalledTimes(1)
      poller.stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('mapKitMapLimit', () => {
  it('keeps the input order and never exceeds the limit', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapKitMapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      await Promise.resolve()
      inFlight--
      return n * 10
    })
    expect(out).toStrictEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBe(2)
  })

  it('handles an empty list and a limit below one', async () => {
    expect(await mapKitMapLimit([], 3, (n: number) => Promise.resolve(n))).toStrictEqual([])
    expect(await mapKitMapLimit([1, 2], 0, (n: number) => Promise.resolve(n))).toStrictEqual([1, 2])
  })
})
