import {
  createMapKitFocusPreserver,
  createMapKitHtmlSlotRenderer,
  createMapKitRenderScheduler,
} from '../src/client/index.js'
import { createFakeFrameScheduler } from './fake-timer.js'

import type { MapKitFocusableElement, MapKitRenderScheduler } from '../src/client/index.js'

describe('createMapKitRenderScheduler', () => {
  function createScheduler(onFlush: (regions: ReadonlySet<string>) => void): {
    frames: ReturnType<typeof createFakeFrameScheduler>
    scheduler: MapKitRenderScheduler
  } {
    const frames = createFakeFrameScheduler()
    const scheduler = createMapKitRenderScheduler({
      cancelAnimationFrame: frames.cancelAnimationFrame,
      onFlush,
      requestAnimationFrame: frames.requestAnimationFrame,
    })
    return { frames, scheduler }
  }

  it('coalesces many marks into a single flush per frame', () => {
    const flushes: string[][] = []
    const { frames, scheduler } = createScheduler((regions) => flushes.push([...regions].sort()))

    scheduler.mark('markers')
    scheduler.mark('legend')
    scheduler.mark('markers')
    scheduler.mark('readout')

    expect(flushes).toHaveLength(0)
    expect(frames.pending()).toBe(1)
    expect(scheduler.scheduled).toBe(true)
    expect([...scheduler.pendingRegions].sort()).toEqual(['legend', 'markers', 'readout'])

    frames.runFrame()

    expect(flushes).toEqual([['legend', 'markers', 'readout']])
    expect(scheduler.scheduled).toBe(false)
    expect(scheduler.pendingRegions.size).toBe(0)
  })

  it('does not schedule another frame when nothing new was marked', () => {
    const flushes: string[][] = []
    const { frames, scheduler } = createScheduler((regions) => flushes.push([...regions]))

    scheduler.mark('markers')
    frames.runFrame()
    frames.runFrame()

    expect(flushes).toEqual([['markers']])
    expect(frames.pending()).toBe(0)
  })

  it('defers a mark made during a flush to a follow-up frame', () => {
    const flushes: string[][] = []
    const frames = createFakeFrameScheduler()
    const scheduler = createMapKitRenderScheduler({
      cancelAnimationFrame: frames.cancelAnimationFrame,
      onFlush: (regions) => {
        flushes.push([...regions])
        if (flushes.length === 1) scheduler.mark('legend')
      },
      requestAnimationFrame: frames.requestAnimationFrame,
    })

    scheduler.mark('markers')
    frames.runFrame()

    // The re-entrant mark must not have recursed into the running flush.
    expect(flushes).toEqual([['markers']])
    expect(frames.pending()).toBe(1)

    frames.runFrame()

    expect(flushes).toEqual([['markers'], ['legend']])
    expect(frames.pending()).toBe(0)
  })

  it('reschedules regions marked before a throwing flush', () => {
    const flushes: string[][] = []
    const frames = createFakeFrameScheduler()
    const scheduler = createMapKitRenderScheduler({
      cancelAnimationFrame: frames.cancelAnimationFrame,
      onFlush: (regions) => {
        flushes.push([...regions])
        if (flushes.length === 1) throw new Error('render failed')
      },
      requestAnimationFrame: frames.requestAnimationFrame,
    })

    scheduler.mark('markers')
    expect(() => scheduler.flushNow()).toThrow('render failed')

    scheduler.mark('legend')
    frames.runFrame()

    expect(flushes).toEqual([['markers'], ['legend']])
  })

  it('flushes synchronously and cancels the pending frame', () => {
    const flushes: string[][] = []
    const { frames, scheduler } = createScheduler((regions) => flushes.push([...regions]))

    scheduler.mark('markers')
    scheduler.flushNow()

    expect(flushes).toEqual([['markers']])
    expect(frames.pending()).toBe(0)

    // Nothing is dirty, so a bare flushNow() must not fire an empty render.
    scheduler.flushNow()
    expect(flushes).toHaveLength(1)
  })

  it('cancel drops the pending frame and its regions without flushing', () => {
    const flushes: string[][] = []
    const { frames, scheduler } = createScheduler((regions) => flushes.push([...regions]))

    scheduler.mark('markers')
    scheduler.cancel()

    expect(frames.pending()).toBe(0)
    expect(scheduler.pendingRegions.size).toBe(0)

    frames.runFrame()
    expect(flushes).toHaveLength(0)
  })

  it('destroy is idempotent and makes later marks inert', () => {
    const flushes: string[][] = []
    const { frames, scheduler } = createScheduler((regions) => flushes.push([...regions]))

    scheduler.mark('markers')
    scheduler.destroy()
    scheduler.destroy()

    expect(scheduler.destroyed).toBe(true)
    expect(frames.pending()).toBe(0)

    scheduler.mark('legend')
    scheduler.flushNow()
    frames.runFrame()

    expect(flushes).toHaveLength(0)
    expect(scheduler.pendingRegions.size).toBe(0)
  })
})

describe('createMapKitHtmlSlotRenderer', () => {
  it('skips the write when the html is unchanged', () => {
    const renderer = createMapKitHtmlSlotRenderer()
    const writes: string[] = []
    const element = {
      get innerHTML(): string {
        return writes.at(-1) ?? ''
      },
      set innerHTML(html: string) {
        writes.push(html)
      },
    }

    expect(renderer.write(element, '<b>12.4 kn</b>')).toBe(true)
    expect(renderer.write(element, '<b>12.4 kn</b>')).toBe(false)
    expect(renderer.write(element, '<b>12.4 kn</b>')).toBe(false)
    expect(writes).toEqual(['<b>12.4 kn</b>'])

    expect(renderer.write(element, '<b>12.6 kn</b>')).toBe(true)
    expect(writes).toEqual(['<b>12.4 kn</b>', '<b>12.6 kn</b>'])
  })

  it('tracks elements independently and forgets on request', () => {
    const renderer = createMapKitHtmlSlotRenderer()
    const first = { innerHTML: '' }
    const second = { innerHTML: '' }

    expect(renderer.write(first, 'same')).toBe(true)
    expect(renderer.write(second, 'same')).toBe(true)
    expect(renderer.write(first, 'same')).toBe(false)

    renderer.forget(first)
    expect(renderer.write(first, 'same')).toBe(true)
    expect(renderer.write(second, 'same')).toBe(false)
  })

  it('writeAll reports how many slots actually changed', () => {
    const renderer = createMapKitHtmlSlotRenderer()
    const legend = { innerHTML: '' }
    const readout = { innerHTML: '' }

    expect(
      renderer.writeAll([
        { element: legend, html: 'legend' },
        { element: readout, html: 'readout' },
      ]),
    ).toBe(2)

    expect(
      renderer.writeAll([
        { element: legend, html: 'legend' },
        { element: readout, html: 'readout v2' },
      ]),
    ).toBe(1)

    expect(legend.innerHTML).toBe('legend')
    expect(readout.innerHTML).toBe('readout v2')
  })
})

describe('createMapKitFocusPreserver', () => {
  interface FakeField extends MapKitFocusableElement {
    focused: boolean
    key: string
    range: [number, number] | null
  }

  function createField(key: string, selectionStart = 3, selectionEnd = 5): FakeField {
    const field: FakeField = {
      focus: () => {
        field.focused = true
      },
      focused: false,
      key,
      range: null,
      selectionEnd,
      selectionStart,
      setSelectionRange: (start, end) => {
        field.range = [start, end]
      },
    }
    return field
  }

  it('restores focus and selection across a slot rewrite', () => {
    const before = createField('search')
    const after = createField('search', 0, 0)
    let active: unknown = before

    const preserver = createMapKitFocusPreserver({
      activeElement: () => active,
      identify: (element) => (element as FakeField | null)?.key ?? null,
      resolve: (key) => (key === after.key ? after : null),
    })

    const result = preserver.preserve(() => {
      // The rewrite destroys the focused node; the browser drops focus to body.
      active = null
      return 'rendered'
    })

    expect(result).toBe('rendered')
    expect(after.focused).toBe(true)
    expect(after.range).toEqual([3, 5])
  })

  it('restores focus even when the write throws', () => {
    const field = createField('search')
    const preserver = createMapKitFocusPreserver({
      activeElement: () => field,
      identify: () => field.key,
      resolve: () => field,
    })
    field.focused = false

    expect(() =>
      preserver.preserve(() => {
        throw new Error('render failed')
      }),
    ).toThrow('render failed')
    expect(field.focused).toBe(true)
  })

  it('captures nothing when no element is focused or none qualifies', () => {
    const unidentified = createField('search')
    const preserver = createMapKitFocusPreserver({
      activeElement: () => unidentified,
      identify: () => null,
      resolve: () => unidentified,
    })

    expect(preserver.capture()).toBeNull()
    expect(preserver.restore(null)).toBe(false)

    const empty = createMapKitFocusPreserver({
      activeElement: () => null,
      identify: () => 'search',
      resolve: () => unidentified,
    })
    expect(empty.capture()).toBeNull()
  })

  it('survives an element whose selection accessors throw', () => {
    const field: MapKitFocusableElement = {
      focus: () => {},
      get selectionStart(): number {
        throw new Error('InvalidStateError')
      },
      setSelectionRange: () => {
        throw new Error('InvalidStateError')
      },
    }
    const preserver = createMapKitFocusPreserver({
      activeElement: () => field,
      identify: () => 'number-input',
      resolve: () => field,
    })

    const snapshot = preserver.capture()

    expect(snapshot).toEqual({ key: 'number-input', selectionEnd: null, selectionStart: null })
    expect(preserver.restore(snapshot)).toBe(true)
  })

  it('reports false when the key no longer resolves after the rewrite', () => {
    const field = createField('search')
    const preserver = createMapKitFocusPreserver({
      activeElement: () => field,
      identify: () => field.key,
      resolve: () => null,
    })

    expect(preserver.restore(preserver.capture())).toBe(false)
  })
})
