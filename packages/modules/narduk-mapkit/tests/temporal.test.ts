import { describe, expect, it } from 'vitest'
import { boundedFrameCache, nextDrawableFrame, temporalProgress } from '../src/client/temporal.js'

describe('temporal playback helpers', () => {
  it('requires current and next frames to be ready', () => {
    const readiness = new Map([[0, 'ready' as const], [1, 'loading' as const]])
    expect(nextDrawableFrame({ current: 0, frameCount: 2, readiness })).toBeNull()
    readiness.set(1, 'ready')
    expect(nextDrawableFrame({ current: 0, frameCount: 2, readiness })).toBe(1)
  })
  it('reports decoded readiness progress', () => { expect(temporalProgress({ current: 0, frameCount: 4, readiness: new Map([[0, 'ready'], [1, 'ready']]) })).toBe(0.5) })
  it('keeps the cache bounded in insertion order', () => { expect([...boundedFrameCache(new Map([[0, 'a'], [1, 'b'], [2, 'c']]), 2).keys()]).toEqual([1, 2]) })
})
