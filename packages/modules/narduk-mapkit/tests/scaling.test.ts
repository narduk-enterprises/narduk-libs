import { createFakeFrameScheduler } from './fake-timer.js'
import {
  createMapKitPinScalingController,
  createMapKitPinSizeCurve,
  cullProbeZoom,
  defaultMapKitPinRankFloor,
  defaultMapKitPinSizeCurve,
  defaultMapKitPinSizeStops,
  latchedPinMode,
  latchedStepIndex,
  MAPKIT_PIN_SCALE_PROPERTY,
  MAPKIT_PIN_SIZE_PROPERTY,
  mapKitZoomForSpan,
  MapKitAnnotationRegistry,
} from '../src/client/index.js'

import type {
  MapKitPinClassConfig,
  MapKitPinScalingChangeEvent,
  MapKitPinScalingOptions,
  MapKitPinScalingStyleTarget,
} from '../src/client/index.js'

/**
 * Type-level only: a real `HTMLElement` must stay assignable to the injected
 * container handle. Nothing else in a node-environment suite would catch a
 * structural shape that no longer accepts the real DOM.
 */
const realElementIsAccepted: MapKitPinScalingStyleTarget = {} as HTMLElement
void realElementIsAccepted

interface FakeAnnotation {
  visible: boolean
}

interface FakeContainer extends MapKitPinScalingStyleTarget {
  properties: Map<string, string>
  removes: number
  sets: number
}

function createContainer(): FakeContainer {
  const properties = new Map<string, string>()
  const container: FakeContainer = {
    properties,
    removes: 0,
    sets: 0,
    style: {
      removeProperty(name: string): string {
        container.removes += 1
        properties.delete(name)
        return ''
      },
      setProperty(name: string, value: string): void {
        container.sets += 1
        properties.set(name, value)
      },
    },
  }
  return container
}

interface Harness {
  annotation: (key: string) => FakeAnnotation
  container: FakeContainer
  controller: ReturnType<typeof createMapKitPinScalingController<FakeAnnotation>>
  events: MapKitPinScalingChangeEvent[]
  frames: ReturnType<typeof createFakeFrameScheduler>
  /** Every `visible` write the controller made, in order. */
  writes: Array<{ key: string; visible: boolean }>
  /** Set the zoom `readZoom` reports. */
  zoom: (value: number) => void
}

function createHarness(
  pins: readonly { classId: string; key: string }[],
  classes: Readonly<Record<string, MapKitPinClassConfig>>,
  overrides: Partial<MapKitPinScalingOptions<FakeAnnotation>> = {},
): Harness {
  const annotations = new Map<string, FakeAnnotation>()
  for (const pin of pins) annotations.set(pin.key, { visible: true })

  const container = createContainer()
  const events: MapKitPinScalingChangeEvent[] = []
  const frames = createFakeFrameScheduler()
  const writes: Array<{ key: string; visible: boolean }> = []
  const byAnnotation = new Map<FakeAnnotation, string>()
  for (const [key, annotation] of annotations) byAnnotation.set(annotation, key)
  let zoom: number | null = null

  const controller = createMapKitPinScalingController<FakeAnnotation>({
    annotations: { get: (key) => annotations.get(key) },
    cancelAnimationFrame: frames.cancelAnimationFrame,
    classes,
    container,
    onChange: (event) => events.push(event),
    readZoom: () => zoom,
    requestAnimationFrame: frames.requestAnimationFrame,
    setVisible: (annotation, visible) => {
      writes.push({ key: byAnnotation.get(annotation) ?? '?', visible })
      annotation.visible = visible
    },
    ...overrides,
  })

  controller.reconcile(pins)

  return {
    annotation: (key) => annotations.get(key)!,
    container,
    controller,
    events,
    frames,
    writes,
    zoom: (value) => {
      zoom = value
    },
  }
}

/* -------------------------------------------------------------- size curve */

describe('createMapKitPinSizeCurve', () => {
  it('hits every anchor exactly and clamps outside the range', () => {
    for (const stop of defaultMapKitPinSizeStops) {
      expect(defaultMapKitPinSizeCurve(stop.zoom)).toBe(stop.sizePx)
    }
    expect(defaultMapKitPinSizeCurve(1)).toBe(5)
    expect(defaultMapKitPinSizeCurve(18)).toBe(26)
    // An unmeasured zoom reads as the smallest size, never as the largest.
    expect(defaultMapKitPinSizeCurve(Number.NaN)).toBe(5)
  })

  it('interpolates linearly between anchors so a pinch does not pop', () => {
    expect(defaultMapKitPinSizeCurve(6.5)).toBeCloseTo(11, 10)
    expect(defaultMapKitPinSizeCurve(9.25)).toBeCloseTo(23, 10)
    // Monotone and continuous across every anchor.
    let previous = 0
    for (let zoom = 3; zoom <= 12; zoom += 0.01) {
      const size = defaultMapKitPinSizeCurve(zoom)
      expect(size).toBeGreaterThanOrEqual(previous)
      previous = size
    }
  })

  it('reproduces the stepped ladder exactly in step mode', () => {
    const stepped = createMapKitPinSizeCurve(defaultMapKitPinSizeStops, { interpolation: 'step' })
    const ladder = (zoom: number): number => {
      if (zoom <= 5) return 5
      if (zoom <= 6) return 8
      if (zoom <= 7) return 14
      if (zoom <= 8) return 18
      if (zoom <= 9) return 22
      return 26
    }
    for (let zoom = 3; zoom <= 12; zoom += 0.25) expect(stepped(zoom)).toBe(ladder(zoom))
  })

  it('rejects stops that cannot describe a curve', () => {
    expect(() => createMapKitPinSizeCurve([])).toThrow(RangeError)
    expect(() =>
      createMapKitPinSizeCurve([
        { sizePx: 4, zoom: 6 },
        { sizePx: 8, zoom: 5 },
      ]),
    ).toThrow(/ascend/)
    expect(() => createMapKitPinSizeCurve([{ sizePx: -1, zoom: 5 }])).toThrow(/non-negative/)
    expect(() => createMapKitPinSizeCurve([{ sizePx: 4, zoom: Number.NaN }])).toThrow(/finite/)
  })
})

/* -------------------------------------------------------------- hysteresis */

describe('latchedStepIndex', () => {
  const boundaries = [5, 6, 7, 8, 9, 10]

  it('classifies without a deadband when nothing is latched yet', () => {
    expect(latchedStepIndex(boundaries, 7, null, 0.15)).toBe(3)
    expect(latchedStepIndex(boundaries, 4.9, null, 0.15)).toBe(0)
    expect(latchedStepIndex(boundaries, 99, null, 0.15)).toBe(6)
  })

  it('needs overshoot in both directions once latched', () => {
    // Sitting just under the boundary that produced the band keeps the band.
    expect(latchedStepIndex(boundaries, 6.9, 3, 0.15)).toBe(3)
    expect(latchedStepIndex(boundaries, 6.8, 3, 0.15)).toBe(2)
    // And climbing back needs the same overshoot the other way.
    expect(latchedStepIndex(boundaries, 7.0, 2, 0.15)).toBe(2)
    expect(latchedStepIndex(boundaries, 7.2, 2, 0.15)).toBe(3)
  })

  it('cannot be thrashed by dithering on a boundary', () => {
    let index = latchedStepIndex(boundaries, 7, null, 0.15)
    const seen = new Set<number>([index])
    for (let tick = 0; tick < 40; tick++) {
      index = latchedStepIndex(boundaries, tick % 2 === 0 ? 6.999 : 7.001, index, 0.15)
      seen.add(index)
    }
    expect([...seen]).toEqual([3])
  })
})

describe('latchedPinMode', () => {
  it('classifies without a deadband when nothing is latched yet', () => {
    expect(latchedPinMode(11.9, 12, null, 1.5)).toBe('dot')
    expect(latchedPinMode(12, 12, null, 1.5)).toBe('symbol')
  })

  it('needs overshoot in both directions once latched', () => {
    expect(latchedPinMode(11, 12, 'symbol', 1.5)).toBe('symbol')
    expect(latchedPinMode(10.4, 12, 'symbol', 1.5)).toBe('dot')
    expect(latchedPinMode(13, 12, 'dot', 1.5)).toBe('dot')
    expect(latchedPinMode(13.6, 12, 'dot', 1.5)).toBe('symbol')
  })

  it('never collapses a class whose dot threshold is disabled', () => {
    expect(latchedPinMode(1, 0, null, 1.5)).toBe('symbol')
    expect(latchedPinMode(1, 0, 'dot', 1.5)).toBe('symbol')
  })
})

describe('cullProbeZoom', () => {
  it('asks a visible pin about further out and a hidden pin about further in', () => {
    expect(cullProbeZoom(6, true, 0.25)).toBe(6.25)
    expect(cullProbeZoom(6, false, 0.25)).toBe(5.75)
    expect(cullProbeZoom(6, null, 0.25)).toBe(6)
  })
})

describe('mapKitZoomForSpan', () => {
  it('inverts the web-mercator tile relationship', () => {
    // One 256px tile filling a 256px viewport is the whole world: z0.
    expect(mapKitZoomForSpan({ longitudeDelta: 360, widthPx: 256 })).toBeCloseTo(0, 10)
    expect(mapKitZoomForSpan({ longitudeDelta: 180, widthPx: 256 })).toBeCloseTo(1, 10)
    expect(mapKitZoomForSpan({ longitudeDelta: 360, widthPx: 1024 })).toBeCloseTo(2, 10)
    expect(mapKitZoomForSpan({ longitudeDelta: 5, widthPx: 1024, tileSizePx: 512 })).toBeCloseTo(
      Math.log2((360 * 1024) / (512 * 5)),
      10,
    )
  })

  it('reports null for state a zoom cannot be derived from', () => {
    expect(mapKitZoomForSpan({ longitudeDelta: 0, widthPx: 800 })).toBeNull()
    expect(mapKitZoomForSpan({ longitudeDelta: 10, widthPx: 0 })).toBeNull()
    expect(mapKitZoomForSpan({ longitudeDelta: Number.NaN, widthPx: 800 })).toBeNull()
    expect(mapKitZoomForSpan({ longitudeDelta: 10, tileSizePx: 0, widthPx: 800 })).toBeNull()
  })
})

/* -------------------------------------------------------------- controller */

describe('MapKitPinScalingController continuous zoom', () => {
  it('publishes the shared scale and touches no pin between thresholds', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { rig: { rank: 4 } })
    harness.controller.sample(9)
    harness.controller.flushNow()

    harness.container.sets = 0
    harness.writes.length = 0
    harness.events.length = 0

    harness.controller.sample(9.4)
    harness.controller.flushNow()

    expect(harness.container.sets).toBe(2)
    expect(harness.container.properties.get(MAPKIT_PIN_SIZE_PROPERTY)).toBe('23.60px')
    expect(harness.container.properties.get(MAPKIT_PIN_SCALE_PROPERTY)).toBe(
      (23.6 / 26).toFixed(3),
    )
    expect(harness.writes).toEqual([])
    expect(harness.events).toHaveLength(1)
    expect([...harness.events[0]!.changed]).toEqual([])
    expect(harness.events[0]!.reason).toBe('sample')
  })

  it('does nothing at all when the zoom has not moved', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { rig: { rank: 4 } })
    harness.controller.sample(9)
    harness.controller.flushNow()

    harness.container.sets = 0
    harness.events.length = 0

    harness.controller.sample(9)
    harness.controller.flushNow()
    harness.controller.sample(9)
    harness.controller.flushNow()

    expect(harness.container.sets).toBe(0)
    expect(harness.events).toEqual([])
  })

  it('coalesces many samples into one frame', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { rig: { rank: 4 } })
    harness.frames.runFrame()
    harness.events.length = 0

    harness.controller.sample(7)
    harness.controller.sample(8)
    harness.controller.sample(9)
    expect(harness.frames.pending()).toBe(1)

    harness.frames.runFrame()
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0]!.zoom).toBe(9)
    expect(harness.frames.pending()).toBe(0)
  })

  it('polls once per frame while a gesture runs and stops at rest', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { rig: { rank: 4 } })
    harness.zoom(8)
    harness.frames.runFrame()
    harness.events.length = 0

    harness.controller.beginGesture()
    expect(harness.controller.gesturing).toBe(true)

    for (let frame = 1; frame <= 4; frame++) {
      harness.zoom(8 + frame * 0.1)
      harness.frames.runFrame()
      // The loop re-arms itself from inside the frame: exactly one pending
      // frame at all times while the gesture is live.
      expect(harness.frames.pending()).toBe(1)
    }
    expect(harness.events.map((event) => event.zoom)).toEqual([8.1, 8.2, 8.3, 8.4])
    expect(harness.events.every((event) => event.reason === 'gesture')).toBe(true)

    // A frame where the camera did not move costs a frame and nothing else.
    const sets = harness.container.sets
    harness.frames.runFrame()
    expect(harness.events).toHaveLength(4)
    expect(harness.container.sets).toBe(sets)

    harness.zoom(8.9)
    harness.controller.endGesture()
    harness.frames.runFrame()
    expect(harness.events).toHaveLength(5)
    expect(harness.events[4]!.zoom).toBe(8.9)
    // No polling at rest.
    expect(harness.frames.pending()).toBe(0)
    expect(harness.controller.gesturing).toBe(false)
  })

  it('falls back to end-of-gesture snapping without a zoom reader', () => {
    // A consumer that pushes zooms instead of exposing a reader gets no poll
    // loop, and must not get a spinning one either.
    const events: MapKitPinScalingChangeEvent[] = []
    const frames = createFakeFrameScheduler()
    const controller = createMapKitPinScalingController({
      cancelAnimationFrame: frames.cancelAnimationFrame,
      classes: { rig: { rank: 4 } },
      onChange: (event) => events.push(event),
      requestAnimationFrame: frames.requestAnimationFrame,
    })
    controller.track('a', 'rig')
    frames.runFrame()
    events.length = 0

    controller.beginGesture()
    expect(frames.pending()).toBe(0)
    frames.runFrame()
    expect(events).toEqual([])

    // The consumer wired region-change-end only; the controller still lands.
    controller.endGesture()
    controller.sample(7.5)
    frames.runFrame()
    expect(events).toHaveLength(1)
    expect(events[0]!.zoom).toBe(7.5)
    expect(frames.pending()).toBe(0)
  })
})

describe('MapKitPinScalingController thresholds', () => {
  const pins = [
    { classId: 'rig', key: 'rig-1' },
    { classId: 'rig', key: 'rig-2' },
    { classId: 'buoy', key: 'buoy-1' },
  ]
  const classes: Record<string, MapKitPinClassConfig> = {
    // A buoy never collapses; a rig does.
    buoy: { dotBelowPx: 0, rank: 4 },
    rig: { rank: 4 },
  }

  it('holds dot mode across a boundary and needs overshoot both ways', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(7)
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('rig-1')?.mode).toBe('symbol')

    // 12.2px: past the raw 12px threshold, inside the deadband.
    harness.controller.sample(6.7)
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('rig-1')?.mode).toBe('symbol')

    harness.controller.sample(6.3)
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('rig-1')?.mode).toBe('dot')

    // Coming back through the same 12.2px does not flip it either.
    harness.controller.sample(6.7)
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('rig-1')?.mode).toBe('dot')

    harness.controller.sample(7)
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('rig-1')?.mode).toBe('symbol')
  })

  it('swaps only the pins that crossed', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(7)
    harness.controller.flushNow()
    harness.events.length = 0

    harness.controller.sample(6.3)
    harness.controller.flushNow()

    expect(harness.events).toHaveLength(1)
    // The buoy shares the frame and the zoom, and is untouched.
    expect([...harness.events[0]!.changed].sort()).toEqual(['rig-1', 'rig-2'])
    expect(harness.controller.presentationFor('buoy-1')?.mode).toBe('symbol')
  })

  it('latches the size step with hysteresis', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(7)
    harness.controller.flushNow()
    expect(harness.controller.sizeStep).toBe(3)

    harness.controller.sample(6.9)
    harness.controller.flushNow()
    expect(harness.controller.sizeStep).toBe(3)

    harness.controller.sample(6.8)
    harness.controller.flushNow()
    expect(harness.controller.sizeStep).toBe(2)

    harness.controller.sample(7.0)
    harness.controller.flushNow()
    expect(harness.controller.sizeStep).toBe(2)

    harness.controller.sample(7.2)
    harness.controller.flushNow()
    expect(harness.controller.sizeStep).toBe(3)
  })
})

describe('MapKitPinScalingController culling', () => {
  const pins = [
    { classId: 'state', key: 'state-1' },
    { classId: 'platform', key: 'platform-1' },
    { classId: 'reef', key: 'reef-1' },
  ]
  const classes: Record<string, MapKitPinClassConfig> = {
    platform: { rank: 2 },
    reef: { rank: 3 },
    state: { rank: 1 },
  }

  it('drops the least distinctive class first, with hysteresis both ways', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(7)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(true)

    // Inside the deadband around the rank-floor step at z6.
    harness.controller.sample(6)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(true)

    harness.controller.sample(5.7)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(false)
    expect(harness.annotation('platform-1').visible).toBe(true)
    expect(harness.annotation('reef-1').visible).toBe(true)

    // Coming back through the same z6 does not restore it either.
    harness.controller.sample(6)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(false)

    harness.controller.sample(6.3)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(true)
  })

  it('honours a per-class minZoom independently of rank', () => {
    const harness = createHarness([{ classId: 'detail', key: 'd-1' }], {
      detail: { minZoom: 9, rank: Number.MAX_SAFE_INTEGER },
    })
    harness.controller.sample(10)
    harness.controller.flushNow()
    expect(harness.annotation('d-1').visible).toBe(true)

    harness.controller.sample(8.5)
    harness.controller.flushNow()
    expect(harness.annotation('d-1').visible).toBe(false)
  })

  it('exempts a selected pin from culling and from dot mode', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(7)
    harness.controller.flushNow()
    harness.controller.select('state-1')
    harness.controller.flushNow()
    harness.events.length = 0
    harness.writes.length = 0

    harness.controller.sample(4)
    harness.controller.flushNow()

    expect(harness.annotation('state-1').visible).toBe(true)
    expect(harness.controller.presentationFor('state-1')).toEqual({
      classId: 'state',
      mode: 'symbol',
      selected: true,
      sizePx: 5,
      visible: true,
    })
    // The rest of its class went with the cull; the selected pin did not, and
    // was not named for repainting either.
    expect(harness.annotation('platform-1').visible).toBe(false)
    expect(harness.writes.map((write) => write.key)).not.toContain('state-1')
    for (const event of harness.events) expect([...event.changed]).not.toContain('state-1')
  })

  it('returns a deselected pin to its class presentation', () => {
    const harness = createHarness(pins, classes)
    harness.controller.select('state-1')
    harness.controller.sample(4)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(true)

    harness.controller.deselect('state-1')
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(false)
    expect(harness.controller.presentationFor('state-1')?.visible).toBe(false)
  })

  it('gives a pin tracked into an already-culled class its class state', () => {
    const harness = createHarness(pins, classes)
    harness.controller.sample(4)
    harness.controller.flushNow()
    harness.events.length = 0

    harness.controller.track('state-2', 'state')
    harness.controller.flushNow()
    expect(harness.controller.presentationFor('state-2')?.visible).toBe(false)
    // No annotation exists for it yet, so nothing was written and nothing is
    // claimed to have been painted.
    for (const event of harness.events) expect([...event.changed]).not.toContain('state-2')
  })

  it('settles a pin whose annotation is built after it is tracked', () => {
    const annotations = new Map<string, FakeAnnotation>()
    const frames = createFakeFrameScheduler()
    const controller = createMapKitPinScalingController<FakeAnnotation>({
      annotations: { get: (key) => annotations.get(key) },
      cancelAnimationFrame: frames.cancelAnimationFrame,
      classes: { state: { rank: 1 } },
      requestAnimationFrame: frames.requestAnimationFrame,
    })

    // Tracked before the registry has built anything for it.
    controller.track('state-1', 'state')
    controller.sample(4)
    controller.flushNow()
    expect(controller.presentationFor('state-1')?.visible).toBe(false)

    // The registry catches up; the next frame applies the cull it could not.
    annotations.set('state-1', { visible: true })
    controller.refresh()
    controller.flushNow()
    expect(annotations.get('state-1')!.visible).toBe(false)

    // And the queue drains rather than retrying for ever.
    controller.refresh()
    controller.flushNow()
    controller.destroy()
    expect(annotations.get('state-1')!.visible).toBe(true)
  })

  it('never culls a class it was never told about', () => {
    const harness = createHarness([{ classId: 'mystery', key: 'm-1' }], {})
    harness.controller.sample(3)
    harness.controller.flushNow()
    expect(harness.annotation('m-1').visible).toBe(true)
  })
})

describe('MapKitPinScalingController reconcile', () => {
  it('reports what changed in the tracked set', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { buoy: { rank: 4 }, rig: { rank: 2 } })
    expect(harness.controller.size).toBe(1)

    const result = harness.controller.reconcile([
      { classId: 'buoy', key: 'a' },
      { classId: 'rig', key: 'b' },
    ])
    expect(result).toEqual({ added: 1, removed: 0, unchanged: 0, updated: 1 })
    expect(harness.controller.presentationFor('a')?.classId).toBe('buoy')

    const second = harness.controller.reconcile([{ classId: 'buoy', key: 'a' }])
    expect(second).toEqual({ added: 0, removed: 1, unchanged: 1, updated: 0 })
    expect(harness.controller.size).toBe(1)
    expect(harness.controller.presentationFor('b')).toBeUndefined()
  })

  it('rejects blank and duplicate keys', () => {
    const harness = createHarness([], { rig: { rank: 2 } })
    expect(() => harness.controller.track(' ', 'rig')).toThrow(/pin key is required/)
    expect(() =>
      harness.controller.reconcile([
        { classId: 'rig', key: 'a' },
        { classId: 'rig', key: 'a' },
      ]),
    ).toThrow(/duplicate pin key/)
  })
})

describe('MapKitPinScalingController per-class curves', () => {
  it('publishes a scoped property pair for a class with its own curve', () => {
    const harness = createHarness([{ classId: 'buoy', key: 'b-1' }], {
      buoy: {
        rank: 4,
        sizeCurve: createMapKitPinSizeCurve([
          { sizePx: 4, zoom: 5 },
          { sizePx: 16, zoom: 10 },
        ]),
      },
    })
    harness.controller.sample(10)
    harness.controller.flushNow()

    expect(harness.container.properties.get(`${MAPKIT_PIN_SIZE_PROPERTY}-buoy`)).toBe('16.00px')
    expect(harness.container.properties.get(`${MAPKIT_PIN_SCALE_PROPERTY}-buoy`)).toBe('1.000')
    // The base pair is still published for every class that shares the default.
    expect(harness.container.properties.get(MAPKIT_PIN_SIZE_PROPERTY)).toBe('26.00px')
    expect(harness.controller.presentationFor('b-1')?.sizePx).toBe(16)
  })

  it('refuses a class id that cannot be a CSS identifier', () => {
    const harness = createHarness([], {
      'oil&gas': { rank: 2, sizeCurve: defaultMapKitPinSizeCurve },
    })
    expect(() => harness.controller.track('x', 'oil&gas')).toThrow(/CSS identifier/)
  })
})

describe('MapKitPinScalingController deferred painting', () => {
  it('withholds repaints for pins the consumer cannot see, then releases them', () => {
    const onScreen = new Set(['rig-1'])
    const harness = createHarness(
      [
        { classId: 'rig', key: 'rig-1' },
        { classId: 'rig', key: 'rig-2' },
      ],
      { rig: { rank: 4 } },
      { shouldPaint: (key) => onScreen.has(key) },
    )
    harness.controller.sample(7)
    harness.controller.flushNow()
    harness.events.length = 0

    harness.controller.sample(6.3)
    harness.controller.flushNow()

    expect([...harness.events[0]!.changed]).toEqual(['rig-1'])
    expect(harness.events[0]!.deferred).toBe(1)
    expect(harness.controller.deferredCount).toBe(1)

    // A pan brings the second pin into view without moving the zoom.
    onScreen.add('rig-2')
    harness.controller.flushDeferred()
    expect(harness.events).toHaveLength(2)
    expect([...harness.events[1]!.changed]).toEqual(['rig-2'])
    expect(harness.events[1]!.reason).toBe('paint')
    expect(harness.controller.deferredCount).toBe(0)

    // Culling itself is never deferred: the pin is hidden immediately.
    expect(harness.controller.presentationFor('rig-2')?.mode).toBe('dot')
  })

  it('does not emit when nothing was released', () => {
    const harness = createHarness([{ classId: 'rig', key: 'rig-1' }], { rig: { rank: 4 } }, {
      shouldPaint: () => false,
    })
    harness.controller.sample(7)
    harness.controller.flushNow()
    harness.events.length = 0

    harness.controller.flushDeferred()
    expect(harness.events).toEqual([])
  })
})

describe('MapKitPinScalingController destroy', () => {
  it('restores exactly the pins it culled and drops only its own properties', () => {
    const harness = createHarness(
      [
        { classId: 'state', key: 'state-1' },
        { classId: 'reef', key: 'reef-1' },
      ],
      { reef: { rank: 3 }, state: { rank: 1 } },
    )
    harness.controller.sample(4)
    harness.controller.flushNow()
    expect(harness.annotation('state-1').visible).toBe(false)
    expect(harness.annotation('reef-1').visible).toBe(true)

    harness.writes.length = 0
    harness.controller.destroy()

    // Exactly one write: the pin it had hidden. The one it never touched stays
    // untouched, rather than being "restored" to a value it already had.
    expect(harness.writes).toEqual([{ key: 'state-1', visible: true }])
    expect(harness.container.removes).toBe(2)
    expect(harness.container.properties.size).toBe(0)
  })

  it('cancels the pending frame and goes inert', () => {
    const harness = createHarness([{ classId: 'rig', key: 'a' }], { rig: { rank: 4 } })
    harness.controller.beginGesture()
    harness.zoom(8)
    expect(harness.frames.pending()).toBe(1)

    harness.controller.destroy()
    expect(harness.frames.pending()).toBe(0)
    expect(harness.controller.destroyed).toBe(true)

    harness.events.length = 0
    harness.container.sets = 0
    harness.controller.sample(9)
    harness.controller.flushNow()
    harness.controller.beginGesture()
    harness.controller.track('b', 'rig')
    harness.controller.select('a')
    harness.controller.flushDeferred()
    harness.controller.refresh()
    harness.frames.runFrame()

    expect(harness.events).toEqual([])
    expect(harness.container.sets).toBe(0)
    expect(harness.controller.reconcile([{ classId: 'rig', key: 'z' }])).toEqual({
      added: 0,
      removed: 0,
      unchanged: 0,
      updated: 0,
    })

    // Idempotent: a second destroy writes nothing further.
    harness.controller.destroy()
    expect(harness.container.removes).toBeLessThanOrEqual(2)
  })
})

describe('MapKitPinScalingController with MapKitAnnotationRegistry', () => {
  it('drives the registry’s live annotations by key without forking it', () => {
    const added: FakeAnnotation[] = []
    const registry = new MapKitAnnotationRegistry<FakeAnnotation>({
      map: {
        addAnnotations: (annotations) => added.push(...annotations),
        removeAnnotations: () => undefined,
      },
    })
    registry.reconcile([
      { create: () => ({ visible: true }), key: 'state-1', signature: 'v1' },
      { create: () => ({ visible: true }), key: 'reef-1', signature: 'v1' },
    ])

    const frames = createFakeFrameScheduler()
    const controller = createMapKitPinScalingController<FakeAnnotation>({
      annotations: registry,
      cancelAnimationFrame: frames.cancelAnimationFrame,
      classes: { reef: { rank: 3 }, state: { rank: 1 } },
      requestAnimationFrame: frames.requestAnimationFrame,
    })
    controller.reconcile([
      { classId: 'reef', key: 'reef-1' },
      { classId: 'state', key: 'state-1' },
    ])
    controller.sample(4)
    controller.flushNow()

    expect(registry.get('state-1')?.visible).toBe(false)
    expect(registry.get('reef-1')?.visible).toBe(true)
    expect(added).toHaveLength(2)
    // The registry never learned about any of this; its own set is untouched.
    expect(registry.size).toBe(2)
  })
})

/* --------------------------------------------------------------- benchmark */

describe('MapKitPinScalingController cost with 2,000 pins', () => {
  const PINS = 2_000
  const classes: Record<string, MapKitPinClassConfig> = {
    'class-1': { rank: 1 },
    'class-2': { rank: 2 },
    'class-3': { rank: 3 },
    'class-4': { rank: 4 },
  }

  function createBenchHarness(): Harness {
    const pins = Array.from({ length: PINS }, (_, index) => ({
      classId: `class-${(index % 4) + 1}`,
      key: `pin-${index}`,
    }))
    return createHarness(pins, classes)
  }

  it('costs two property writes and nothing else between thresholds', () => {
    const harness = createBenchHarness()
    harness.controller.sample(9)
    harness.controller.flushNow()

    // Every pin is on screen and visible, so registering 2,000 of them wrote
    // no annotation state at all -- only the ones actually culled ever are.
    expect(harness.writes).toHaveLength(0)
    expect([...harness.events[0]!.changed]).toHaveLength(PINS)

    harness.container.sets = 0
    harness.writes.length = 0
    harness.events.length = 0

    harness.controller.sample(9.05)
    harness.controller.flushNow()

    expect(harness.container.sets).toBe(2)
    expect(harness.writes).toHaveLength(0)
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0]!.changed.size).toBe(0)
  })

  it('does no work at all on a repeated reading', () => {
    const harness = createBenchHarness()
    harness.controller.sample(9)
    harness.controller.flushNow()

    harness.container.sets = 0
    harness.events.length = 0
    for (let repeat = 0; repeat < 50; repeat++) {
      harness.controller.sample(9)
      harness.controller.flushNow()
    }
    expect(harness.container.sets).toBe(0)
    expect(harness.events).toHaveLength(0)
  })

  it('bounds a full zoom sweep by the crossings it actually makes', () => {
    const harness = createBenchHarness()
    harness.controller.sample(11)
    harness.controller.flushNow()

    harness.container.sets = 0
    harness.writes.length = 0
    harness.events.length = 0

    let frames = 0
    for (let zoom = 11; zoom >= 4; zoom -= 0.05) {
      harness.controller.sample(Number(zoom.toFixed(2)))
      harness.controller.flushNow()
      frames += 1
    }

    // Two property writes per frame is the ceiling, whatever the pin count.
    expect(harness.container.sets).toBeLessThanOrEqual(2 * frames)
    // Ranks 1 and 2 fall out on the way down; every other pin is untouched, and
    // no pin is written more than once because every threshold is latched.
    expect(harness.writes).toHaveLength(PINS / 2)
    expect(harness.writes.every((write) => write.visible === false)).toBe(true)
    expect(new Set(harness.writes.map((write) => write.key)).size).toBe(PINS / 2)

    // Each of the four classes crossed the dot threshold once and the cull at
    // most once, so no pin is named for repainting more than twice.
    const repaints = new Map<string, number>()
    for (const event of harness.events) {
      for (const key of event.changed) repaints.set(key, (repaints.get(key) ?? 0) + 1)
    }
    expect(Math.max(...repaints.values())).toBeLessThanOrEqual(2)
    expect([...repaints.keys()]).toHaveLength(PINS)

    // Sweeping back restores exactly what was culled, once each.
    harness.writes.length = 0
    for (let zoom = 4; zoom <= 11; zoom += 0.05) {
      harness.controller.sample(Number(zoom.toFixed(2)))
      harness.controller.flushNow()
    }
    expect(harness.writes).toHaveLength(PINS / 2)
    expect(harness.writes.every((write) => write.visible)).toBe(true)
  })

  it('keeps a dithering camera from thrashing any pin', () => {
    const harness = createBenchHarness()
    harness.controller.sample(6.667)
    harness.controller.flushNow()

    harness.writes.length = 0
    harness.events.length = 0
    for (let tick = 0; tick < 200; tick++) {
      // Straddling the raw 12px dot threshold and the z6 rank-floor step.
      harness.controller.sample(tick % 2 === 0 ? 6.66 : 6.68)
      harness.controller.flushNow()
    }

    expect(harness.writes).toHaveLength(0)
    for (const event of harness.events) expect(event.changed.size).toBe(0)
  })

  it('touches only the class that crossed', () => {
    // Give one class a dot threshold the others do not share.
    const pins = Array.from({ length: PINS }, (_, index) => ({
      classId: `class-${(index % 4) + 1}`,
      key: `pin-${index}`,
    }))
    const scoped = createHarness(pins, {
      ...classes,
      'class-4': { dotBelowPx: 20, rank: 4 },
    })

    scoped.controller.sample(9)
    scoped.controller.flushNow()
    scoped.events.length = 0

    // 18px at z8: below class-4's 20px threshold, far above the others' 12px.
    scoped.controller.sample(8)
    scoped.controller.flushNow()

    const changed = [...scoped.events.flatMap((event) => [...event.changed])]
    expect(changed).toHaveLength(PINS / 4)
    expect(changed.every((key) => Number(key.slice(4)) % 4 === 3)).toBe(true)
  })
})
