import { afterEach, describe, expect, it, vi } from 'vitest'

import { useInFlightTracker } from '../runtime/app/composables/useInFlightTracker'
import { useRefCountedSubscription } from '../runtime/app/composables/useRefCountedSubscription'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('async state regressions', () => {
  it('settling a cleared request preserves a newer request for the same key', async () => {
    const tracker = useInFlightTracker<number>()
    const old = deferred<number>()
    const fresh = deferred<number>()
    const first = tracker.dedupe('key', () => old.promise)
    tracker.clear()
    const second = tracker.dedupe('key', () => fresh.promise)
    old.resolve(1)
    await first
    const unexpected = vi.fn(async () => 3)
    const third = tracker.dedupe('key', unexpected)
    expect(unexpected).not.toHaveBeenCalled()
    fresh.resolve(2)
    expect(await second).toBe(2)
    expect(await third).toBe(2)
  })

  it('resubscribing during grace does not subscribe an already open channel twice', () => {
    vi.useFakeTimers()
    const onSubscribe = vi.fn()
    const onUnsubscribe = vi.fn()
    const tracker = useRefCountedSubscription({ onSubscribe, onUnsubscribe, gracePeriodMs: 100 })
    tracker.subscribe(['channel'])
    tracker.unsubscribe(['channel'])
    tracker.subscribe(['channel'])
    vi.advanceTimersByTime(100)
    expect(onSubscribe).toHaveBeenCalledTimes(1)
    expect(onUnsubscribe).not.toHaveBeenCalled()
    tracker.unsubscribe(['channel'])
    vi.advanceTimersByTime(100)
    expect(onUnsubscribe).toHaveBeenCalledWith(['channel'])
  })

  it('tracks keys that match Object prototype names', () => {
    vi.useFakeTimers()
    const onSubscribe = vi.fn()
    const onUnsubscribe = vi.fn()
    const tracker = useRefCountedSubscription({ onSubscribe, onUnsubscribe, gracePeriodMs: 100 })
    tracker.subscribe(['constructor', '__proto__'])
    expect(tracker.refCounts.constructor).toBe(1)
    expect(tracker.refCounts['__proto__']).toBe(1)
    expect(onSubscribe).toHaveBeenCalledWith(['constructor', '__proto__'])
    tracker.unsubscribe(['constructor', '__proto__'])
    vi.advanceTimersByTime(100)
    expect(onUnsubscribe).toHaveBeenCalledTimes(2)
  })
})
