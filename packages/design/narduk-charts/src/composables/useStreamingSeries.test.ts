import { describe, expect, it, vi, afterEach } from 'vitest'
import { useStreamingSeries } from './useStreamingSeries'

describe('useStreamingSeries', () => {
  it('pushes and trims to maxPoints', () => {
    const { values, push } = useStreamingSeries(3, [1, 2])
    expect(values.value).toEqual([1, 2])
    push(3)
    push(4)
    expect(values.value).toEqual([2, 3, 4])
  })

  it('setWindow trims tail', () => {
    const { values, setWindow } = useStreamingSeries(4)
    setWindow([10, 20, 30, 40, 50])
    expect(values.value).toEqual([20, 30, 40, 50])
  })

  it('clear empties', () => {
    const { values, push, clear } = useStreamingSeries(5)
    push(1)
    clear()
    expect(values.value).toEqual([])
  })

  it('throttles when maxUpdatesPerSecond is set', () => {
    vi.useFakeTimers()
    const { values, push } = useStreamingSeries(10, [], { maxUpdatesPerSecond: 2 })
    push(1)
    push(2)
    expect(values.value).toEqual([1])
    vi.advanceTimersByTime(510)
    push(2)
    expect(values.value).toEqual([1, 2])
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
