import {
  boundedFrameCache,
  createTemporalLayerController,
  nextDrawableFrame,
  normalizeTemporalFrames,
  temporalProgress,
} from '../src/client/index.js'
import { createFakeTimer, flushMicrotasks } from './fake-timer.js'

import type {
  MapKitLayerDescriptor,
  MapKitLayerReplaceOptions,
  TemporalControllerEvent,
} from '../src/client/index.js'

describe('temporal playback helpers', () => {
  it('requires current and next frames to be ready', () => {
    const readiness = new Map([
      [0, 'ready' as const],
      [1, 'loading' as const],
    ])
    expect(nextDrawableFrame({ current: 0, frameCount: 2, readiness })).toBeNull()
    readiness.set(1, 'ready')
    expect(nextDrawableFrame({ current: 0, frameCount: 2, readiness })).toBe(1)
  })
  it('reports decoded readiness progress', () => {
    expect(
      temporalProgress({
        current: 0,
        frameCount: 4,
        readiness: new Map([
          [0, 'ready'],
          [1, 'ready'],
        ]),
      }),
    ).toBe(0.5)
  })
  it('keeps the cache bounded in insertion order', () => {
    expect([
      ...boundedFrameCache(
        new Map([
          [0, 'a'],
          [1, 'b'],
          [2, 'c'],
        ]),
        2,
      ).keys(),
    ]).toEqual([1, 2])
  })
})

describe('normalizeTemporalFrames', () => {
  it('accepts bare ids, keeps metadata, and drops blanks', () => {
    expect(
      normalizeTemporalFrames<{ coverage: number }>([
        '2026-08-25',
        '   ',
        { id: '2026-08-26', meta: { coverage: 0.8 } },
        { id: '', meta: { coverage: 1 } },
      ]),
    ).toEqual([{ id: '2026-08-25' }, { id: '2026-08-26', meta: { coverage: 0.8 } }])
  })

  it('returns an empty list for nullish input', () => {
    expect(normalizeTemporalFrames(null)).toEqual([])
    expect(normalizeTemporalFrames(undefined)).toEqual([])
  })
})

interface ReplaceCall {
  descriptor: MapKitLayerDescriptor
  id: string
  options: MapKitLayerReplaceOptions | undefined
}

function createRegistry(behavior?: (index: number) => Promise<void>) {
  const calls: ReplaceCall[] = []
  return {
    calls,
    replace(
      id: string,
      descriptor: MapKitLayerDescriptor,
      options?: MapKitLayerReplaceOptions,
    ): Promise<void> {
      calls.push({ descriptor, id, options })
      return behavior ? behavior(calls.length - 1) : Promise.resolve()
    },
  }
}

const DATES = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']

function urlFor(frameId: string): string {
  return `/tiles/${frameId}/{z}/{x}/{y}@{scale}x.png`
}

function descriptorForFrame(frame: { id: string }): MapKitLayerDescriptor {
  return { id: 'data', urlTemplate: urlFor(frame.id) }
}

function frameIdsFromCalls(calls: readonly ReplaceCall[]): string[] {
  return calls.map((call) => {
    const descriptor = call.descriptor
    return 'urlTemplate' in descriptor ? descriptor.urlTemplate.split('/')[2]! : 'async'
  })
}

describe('MapKitTemporalLayerController', () => {
  it('scrubs to a date and swaps the layer source', async () => {
    const registry = createRegistry()
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      onEvent: (event) => events.push(event),
      registry,
      timer: createFakeTimer(),
    })

    await controller.scrubToId('d3')

    expect(controller.index).toBe(3)
    expect(controller.frame?.id).toBe('d3')
    expect(registry.calls).toHaveLength(1)
    expect(registry.calls[0]?.id).toBe('data')
    expect(frameIdsFromCalls(registry.calls)).toEqual(['d3'])
    expect(controller.readinessOf(3)).toBe('ready')
    expect(events.map((event) => event.type)).toEqual(['change', 'readiness'])
    controller.destroy()
  })

  it('ignores an unknown frame id', async () => {
    const registry = createRegistry()
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      registry,
    })

    await controller.scrubToId('not-a-date')

    expect(registry.calls).toHaveLength(0)
    expect(controller.index).toBe(0)
  })

  it('steps forward and back, clamping at the ends unless wrapping', async () => {
    const registry = createRegistry()
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: ['a', 'b', 'c'],
      index: 2,
      layerId: 'data',
      registry,
    })

    await controller.stepForward()
    expect(controller.index).toBe(2)
    await controller.stepForward({ wrap: true })
    expect(controller.index).toBe(0)
    await controller.stepBack()
    expect(controller.index).toBe(0)
    await controller.stepBack({ wrap: true })
    expect(controller.index).toBe(2)
    await controller.stepBy(-2)
    expect(controller.index).toBe(0)
  })

  it('rejects a descriptor whose id does not match the layer', async () => {
    const controller = createTemporalLayerController({
      descriptorForFrame: () => ({ id: 'other', urlTemplate: '/tiles/{z}/{x}/{y}.png' }),
      frames: ['a', 'b'],
      layerId: 'data',
      registry: createRegistry(),
    })

    await expect(controller.scrubTo(1)).rejects.toThrow(/id "data"/)
  })

  it('marks a frame failed and reports the reason when the swap rejects', async () => {
    const failure = new Error('tile source unavailable')
    const registry = createRegistry(() => Promise.reject(failure))
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      onEvent: (event) => events.push(event),
      registry,
    })

    await controller.scrubTo(2)

    expect(controller.readinessOf(2)).toBe('failed')
    expect(events.some((event) => event.type === 'error' && event.reason === failure)).toBe(true)
  })

  it('loops the last N dates at the configured interval', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      prefetchFrame: () => Promise.resolve(),
      prefetchAhead: 3,
      registry,
      timer,
    })

    controller.play({ intervalMs: 900, windowSize: 3 })
    await flushMicrotasks()
    expect(controller.playing).toBe(true)
    expect(controller.index).toBe(7)

    for (const expected of [8, 9, 7, 8]) {
      timer.advance(900)
      await flushMicrotasks()
      expect(controller.index).toBe(expected)
    }

    expect(frameIdsFromCalls(registry.calls)).toEqual(['d7', 'd8', 'd9', 'd7', 'd8'])

    controller.pause()
    timer.advance(5_000)
    await flushMicrotasks()
    expect(registry.calls).toHaveLength(5)
    controller.destroy()
  })

  it('does not advance onto a frame whose source is not ready', async () => {
    let releaseFrame1: (() => void) | undefined
    const registry = createRegistry()
    const timer = createFakeTimer()
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: ['a', 'b'],
      layerId: 'data',
      onEvent: (event) => events.push(event),
      prefetchFrame: (_frame, index) =>
        index === 1
          ? new Promise<void>((resolve) => {
              releaseFrame1 = resolve
            })
          : Promise.resolve(),
      registry,
      timer,
    })

    controller.play({ intervalMs: 900, windowSize: 2 })
    await flushMicrotasks()
    expect(controller.index).toBe(0)
    expect(controller.readinessOf(1)).toBe('loading')

    timer.advance(900)
    await flushMicrotasks()
    expect(controller.index).toBe(0)
    expect(events.some((event) => event.type === 'stall')).toBe(true)

    releaseFrame1?.()
    await flushMicrotasks()
    expect(controller.readinessOf(1)).toBe('ready')

    timer.advance(900)
    await flushMicrotasks()
    expect(controller.index).toBe(1)
    controller.destroy()
  })

  it('skips a frame whose prefetch failed', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: ['a', 'b', 'c'],
      layerId: 'data',
      prefetchFrame: (_frame, index) =>
        index === 1 ? Promise.reject(new Error('decode failed')) : Promise.resolve(),
      registry,
      timer,
    })

    controller.play({ intervalMs: 900, windowSize: 3 })
    await flushMicrotasks()
    expect(controller.readinessOf(1)).toBe('failed')

    timer.advance(900)
    await flushMicrotasks()
    expect(controller.index).toBe(2)
    controller.destroy()
  })

  it('pauses when every other frame in the window has failed', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: ['a', 'b'],
      layerId: 'data',
      onEvent: (event) => events.push(event),
      prefetchFrame: (_frame, index) =>
        index === 1 ? Promise.reject(new Error('decode failed')) : Promise.resolve(),
      registry,
      timer,
    })

    controller.play({ intervalMs: 900, windowSize: 2 })
    await flushMicrotasks()
    timer.advance(900)
    await flushMicrotasks()

    expect(controller.playing).toBe(false)
    expect(events.some((event) => event.type === 'pause' && event.reason === 'stalled')).toBe(true)
  })

  it('refuses to loop and scrubs instantly under reduced motion', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      crossfadeDurationMs: 400,
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      onEvent: (event) => events.push(event),
      reducedMotion: true,
      registry,
      timer,
    })

    controller.play()
    expect(controller.playing).toBe(false)
    expect(timer.pending()).toBe(0)
    expect(
      events.some((event) => event.type === 'pause' && event.reason === 'reduced-motion'),
    ).toBe(true)

    await controller.scrubTo(4)
    expect(registry.calls[0]?.options?.crossfadeDurationMs).toBe(0)
    controller.destroy()
  })

  it('stops an active loop when reduced motion turns on', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      registry,
      timer,
    })

    controller.play({ intervalMs: 900, windowSize: 3 })
    await flushMicrotasks()
    expect(controller.playing).toBe(true)

    controller.setReducedMotion(true)
    expect(controller.playing).toBe(false)
    expect(timer.pending()).toBe(0)
    controller.destroy()
  })

  it('passes the configured crossfade through to the registry', async () => {
    const registry = createRegistry()
    const controller = createTemporalLayerController({
      activateWhen: 'first-image',
      crossfadeDurationMs: 350,
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      readinessTimeoutMs: 1_200,
      registry,
    })

    await controller.scrubTo(1)

    expect(registry.calls[0]?.options).toMatchObject({
      activateWhen: 'first-image',
      crossfadeDurationMs: 350,
      readinessTimeoutMs: 1_200,
    })
    expect(registry.calls[0]?.options?.signal).toBeDefined()
  })

  it('bounds tracked readiness while retaining the current frame', () => {
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      maxTrackedFrames: 2,
      prefetchFrame: () => Promise.resolve(),
      registry: createRegistry(),
    })

    controller.markReadiness(0, 'ready')
    controller.markReadiness(1, 'ready')
    controller.markReadiness(2, 'ready')

    expect(controller.readinessOf(0)).toBe('ready')
    expect(controller.readinessOf(2)).toBe('ready')
    expect(controller.readinessOf(1)).toBe('idle')
    expect(controller.progress()).toBeCloseTo(0.2, 5)
  })

  it('treats frames as ready when no readiness source is configured', () => {
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      registry: createRegistry(),
    })

    expect(controller.readinessOf(5)).toBe('ready')
    expect(controller.progress()).toBe(1)
  })

  it('re-anchors the index to the same date when the frame list grows', () => {
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: ['d1', 'd2'],
      index: 1,
      layerId: 'data',
      registry: createRegistry(),
    })

    controller.setFrames(['d0', 'd1', 'd2', 'd3'])

    expect(controller.index).toBe(2)
    expect(controller.frame?.id).toBe('d2')
    expect(controller.length).toBe(4)
  })

  it('stops timers and notifications on destroy', async () => {
    const registry = createRegistry()
    const timer = createFakeTimer()
    const events: TemporalControllerEvent[] = []
    const controller = createTemporalLayerController({
      descriptorForFrame,
      frames: DATES,
      layerId: 'data',
      registry,
      timer,
    })
    controller.subscribe((event) => events.push(event))

    controller.play({ intervalMs: 900, windowSize: 3 })
    await flushMicrotasks()
    const callsBefore = registry.calls.length
    controller.destroy()

    timer.advance(10_000)
    await flushMicrotasks()

    expect(controller.destroyed).toBe(true)
    expect(controller.playing).toBe(false)
    expect(registry.calls).toHaveLength(callsBefore)
    expect(timer.pending()).toBe(0)
    const afterDestroy = events.filter((event) => event.type === 'change')
    await controller.scrubTo(9)
    expect(events.filter((event) => event.type === 'change')).toHaveLength(afterDestroy.length)
  })
})
