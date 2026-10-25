/**
 * @vitest-environment happy-dom
 *
 * `MapKitMovingMarkerLayer` against the deterministic fake MapKit, with a fake
 * clock driving both the animation frames and `now()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MapKitMovingMarkerLayer } from '../src/client/moving-markers.js'
import { createFakeMapKit } from '../src/testing/index.js'

import type {
  MapKitMovingMapLike,
  MapKitMovingMarker,
  MapKitMovingMarkerLayerOptions,
  MapKitMovingNamespaceLike,
} from '../src/client/moving-markers.js'
import type { FakeMapKitHandle } from '../src/testing/index.js'

import { createFakeTimer } from './fake-timer.js'

interface Bus extends MapKitMovingMarker {
  route?: string
}

const GLIDE = 10_000
let fake: FakeMapKitHandle
let map: MapKitMovingMapLike & { listeners?: unknown }
let mapkit: MapKitMovingNamespaceLike
let timer = createFakeTimer()
let hidden = false
let reduced = false

const frames = {
  cancelAnimationFrame: (handle: number) => {
    timer.cancel(handle)
  },
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    timer.schedule(() => {
      callback(timer.now())
    }, 16) as number,
}

function bus(id: string, lat: number, lng = -88): Bus {
  return { id, lat, lng }
}

function layer(
  extra: Partial<MapKitMovingMarkerLayerOptions<Bus>> = {},
): MapKitMovingMarkerLayer<Bus> {
  return new MapKitMovingMarkerLayer<Bus>({
    createElement: (marker) => {
      const el = document.createElement('i')
      el.textContent = marker.id
      return el
    },
    frames,
    glideMs: GLIDE,
    hidden: () => hidden,
    map,
    mapkit,
    now: timer.now,
    reducedMotion: () => reduced,
    ...extra,
  })
}

/** Advance in frame-sized steps, as a browser would. */
function run(ms: number): void {
  for (let spent = 0; spent < ms; spent += 16) timer.advance(16)
}

beforeEach(() => {
  timer = createFakeTimer(1000)
  hidden = false
  reduced = false
  fake = createFakeMapKit()
  const container = document.createElement('div')
  document.body.append(container)
  mapkit = fake.mapkit as unknown as MapKitMovingNamespaceLike
  map = new (fake.mapkit as unknown as { Map: new (el: HTMLElement) => MapKitMovingMapLike }).Map(
    container,
  )
  fake.inspect.reset()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('adding, moving and removing', () => {
  it('adds markers in one call, and a repeat poll touches nothing', () => {
    const l = layer()
    l.set([bus('1', 30), bus('2', 30.01)])
    expect(fake.inspect.count('addAnnotations')).toBe(1)
    expect(fake.inspect.annotationsAdded).toBe(2)
    fake.inspect.reset()

    l.set([bus('1', 30), bus('2', 30.01)])
    expect(fake.inspect.annotationsAdded).toBe(0)
    expect(fake.inspect.annotationsRemoved).toBe(0)
    expect(l.gliding).toBe(0)
  })

  it('removes a marker that stopped reporting', () => {
    const l = layer()
    l.set([bus('1', 30), bus('2', 30.01)])
    fake.inspect.reset()
    l.set([bus('1', 30)])
    expect(fake.inspect.annotationsRemoved).toBe(1)
    expect(l.size).toBe(1)
    expect(l.positionOf('2')).toBeUndefined()
  })

  it('draws a first fix at once', () => {
    const l = layer()
    l.set([bus('1', 30.5)])
    expect(l.positionOf('1')).toStrictEqual({ lat: 30.5, lng: -88 })
    expect(l.gliding).toBe(0)
  })

  it('does not rebuild the glyph unless the render key changes', () => {
    const createElement = vi.fn((marker: Bus) => {
      const el = document.createElement('i')
      el.textContent = marker.route ?? ''
      return el
    })
    const l = layer({ createElement, renderKey: (m) => m.route ?? '' })
    l.set([{ ...bus('1', 30), route: 'A' }])
    const calls = createElement.mock.calls.length
    l.set([{ ...bus('1', 30.0001), route: 'A' }])
    expect(createElement.mock.calls.length).toBe(calls)
    l.set([{ ...bus('1', 30.0001), route: 'B' }])
    expect(createElement.mock.calls.length).toBe(calls + 1)
    expect(l.hostFor('1')?.textContent).toBe('B')
  })
})

describe('gliding', () => {
  it('glides linearly from where the marker is drawn to the new fix', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    expect(l.gliding).toBe(1)

    run(GLIDE / 2)
    expect(l.positionOf('1')!.lat).toBeCloseTo(30.002, 3)

    run(GLIDE / 2 + 32)
    expect(l.positionOf('1')).toStrictEqual({ lat: 30.004, lng: -88 })
    expect(l.gliding).toBe(0)
    expect(timer.pending()).toBe(0)
  })

  it('restarts a glide from the drawn position, not the last report', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    run(GLIDE / 2)
    const mid = l.positionOf('1')!
    l.set([bus('1', 30.006)])
    expect(l.positionOf('1')).toStrictEqual(mid)
    run(GLIDE + 32)
    expect(l.positionOf('1')!.lat).toBeCloseTo(30.006, 6)
  })

  it('glides along the route line when it has one', () => {
    const route = [
      { lat: 30, lng: -88 },
      { lat: 30, lng: -87.995 },
      { lat: 30.004, lng: -87.995 },
    ]
    const l = layer({ lines: () => [route] })
    l.set([bus('1', 30, -88)])
    l.set([bus('1', 30.004, -87.995)])
    run(GLIDE * 0.25)
    // A straight line would already be north of the first leg.
    expect(l.positionOf('1')!.lat).toBeCloseTo(30, 4)
    run(GLIDE)
    expect(l.positionOf('1')).toStrictEqual({ lat: 30.004, lng: -87.995 })
  })

  it('writes the drawn position into the MapKit annotation', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    const annotation = fake.inspect.maps[0]!.annotations[0] as unknown as {
      coordinate: { latitude: number }
    }
    run(GLIDE / 2)
    expect(annotation.coordinate.latitude).toBeCloseTo(30.002, 3)
    run(GLIDE)
    expect(annotation.coordinate.latitude).toBeCloseTo(30.004, 6)
  })
})

describe('snap rules', () => {
  it('snaps a jump too long to be one poll of travel', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.5)])
    expect(l.positionOf('1')!.lat).toBe(30.5)
    expect(l.gliding).toBe(0)
  })

  it('snaps under reduced motion', () => {
    reduced = true
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    expect(l.positionOf('1')!.lat).toBe(30.004)
    expect(l.gliding).toBe(0)
  })

  it('snaps what changed while the tab was hidden, and runs no frames there', () => {
    const l = layer()
    l.set([bus('1', 30)])
    hidden = true
    l.set([bus('1', 30.004)])
    expect(l.positionOf('1')!.lat).toBe(30.004)
    expect(timer.pending()).toBe(0)
  })

  it('finishes a glide in progress when the tab comes back', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    run(1000)
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(timer.pending()).toBe(0)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(l.positionOf('1')!.lat).toBe(30.004)
    expect(l.gliding).toBe(0)
  })
})

describe('heading', () => {
  it('follows the move and takes the short way round a turn', () => {
    const l = layer()
    l.set([bus('1', 30, -88)])
    l.set([bus('1', 30, -87.998)]) // east
    expect(l.hostFor('1')?.getAttribute('data-mapkit-heading')).toBe('90')
    l.set([bus('1', 30.002, -87.998)]) // north
    expect(l.hostFor('1')?.getAttribute('data-mapkit-heading')).toBe('0')
    // 90 -> 0 went the short way (down to 0), never up through 270.
    expect(l.hostFor('1')?.style.getPropertyValue('--mapkit-heading')).toBe('0deg')
    l.set([bus('1', 30.002, -88)]) // west
    expect(
      Number.parseFloat(l.hostFor('1')?.style.getPropertyValue('--mapkit-heading') ?? ''),
    ).toBeCloseTo(-90, 0)
    expect(l.hostFor('1')?.getAttribute('data-mapkit-heading')).toBe('270')
  })

  it('ignores a move that is just GPS noise', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.0000405)]) // ~4.5 m
    expect(l.hostFor('1')?.hasAttribute('data-mapkit-heading')).toBe(false)
  })

  it('can be turned off', () => {
    const l = layer({ heading: false })
    l.set([bus('1', 30)])
    l.set([bus('1', 30.002)])
    expect(l.hostFor('1')?.hasAttribute('data-mapkit-heading')).toBe(false)
  })
})

describe('tiers, selection and the hit area', () => {
  it('writes the tier on every host, including later ones', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.setTier('dot')
    expect(l.hostFor('1')?.getAttribute('data-mapkit-tier')).toBe('dot')
    l.set([bus('1', 30), bus('2', 30.01)])
    expect(l.hostFor('2')?.getAttribute('data-mapkit-tier')).toBe('dot')
    expect(l.tier).toBe('dot')
  })

  it('applies the hit area again when the tier changes the geometry', () => {
    const l = layer({
      geometry: (tier) => ({
        anchor: 'center',
        size: tier === 'dot' ? { height: 12, width: 12 } : { height: 60, width: 60 },
      }),
      hitArea: true,
    })
    l.set([bus('1', 30)])
    const host = l.hostFor('1')!
    // A 60 px marker is already big enough: nothing to add.
    expect(host.hasAttribute('data-mapkit-hit-area')).toBe(false)
    l.setTier('dot')
    expect(host.hasAttribute('data-mapkit-hit-area')).toBe(true)
    expect(host.style.width).toBe('44px')
    l.setTier('symbol')
    expect(host.hasAttribute('data-mapkit-hit-area')).toBe(false)
    expect(host.style.width).toBe('')
  })

  it('grows the host to a 44px hit area over a smaller glyph', () => {
    const l = layer({
      geometry: { anchor: 'center', size: { height: 20, width: 20 } },
      hitArea: true,
    })
    l.set([bus('1', 30)])
    const host = l.hostFor('1')!
    expect(Number.parseFloat(host.style.width)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(host.style.height)).toBeGreaterThanOrEqual(44)
  })

  it('labels the host, selects on click and Enter, and reflects selection', () => {
    const onSelect = vi.fn()
    const l = layer({ label: (m) => `Bus ${m.id}`, onSelect })
    l.set([bus('1', 30)])
    const host = l.hostFor('1')!
    expect(host.getAttribute('aria-label')).toBe('Bus 1')
    expect(host.getAttribute('role')).toBe('button')

    host.click()
    expect(onSelect).toHaveBeenLastCalledWith('1', 'pointer')
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(onSelect).toHaveBeenLastCalledWith('1', 'keyboard')

    l.setSelected('1')
    expect(host.getAttribute('aria-pressed')).toBe('true')
    expect(host.hasAttribute('data-mapkit-selected')).toBe(true)
    host.click()
    expect(onSelect).toHaveBeenLastCalledWith(null, 'pointer')
    l.setSelected(null)
    expect(host.getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves the host decorative without a label', () => {
    const l = layer()
    l.set([bus('1', 30)])
    expect(l.hostFor('1')?.hasAttribute('role')).toBe(false)
  })
})

describe('follow camera', () => {
  it('keeps the map centred on the marker as it glides, and lets go on a user gesture', () => {
    const centre = vi.fn()
    map.setCenterAnimated = centre
    const listeners = new Map<string, () => void>()
    map.addEventListener = (type, listener) => {
      listeners.set(type, listener)
    }
    map.removeEventListener = (type) => {
      listeners.delete(type)
    }
    const onFollowEnd = vi.fn()
    const l = layer({ onFollowEnd })
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])

    expect(l.follow('1')).toBe(true)
    expect(l.followedId).toBe('1')
    const before = centre.mock.calls.length
    run(2000)
    expect(centre.mock.calls.length).toBeGreaterThan(before)

    listeners.get('scroll-start')?.()
    expect(l.followedId).toBeNull()
    expect(onFollowEnd).toHaveBeenCalledWith('1')
    const after = centre.mock.calls.length
    run(2000)
    expect(centre.mock.calls.length).toBe(after)
  })

  it('ends the previous follow when the target switches (ponytail-5 s5 #9)', () => {
    const onFollowEnd = vi.fn()
    const l = layer({ onFollowEnd })
    l.set([bus('1', 30), bus('2', 31)])
    l.follow('1')
    l.follow('2')
    expect(onFollowEnd).toHaveBeenCalledTimes(1)
    expect(onFollowEnd).toHaveBeenCalledWith('1')
    expect(l.followedId).toBe('2')
  })

  it('refuses an unknown id and ends when the followed marker goes away', () => {
    const onFollowEnd = vi.fn()
    const l = layer({ onFollowEnd })
    l.set([bus('1', 30)])
    expect(l.follow('nope')).toBe(false)
    l.follow('1')
    l.set([])
    expect(l.followedId).toBeNull()
    expect(onFollowEnd).toHaveBeenCalledWith('1')
  })
})

describe('destroy', () => {
  it('removes everything, stops the loop and ignores later sets', () => {
    const l = layer()
    l.set([bus('1', 30)])
    l.set([bus('1', 30.004)])
    l.destroy()
    expect(timer.pending()).toBe(0)
    expect(l.size).toBe(0)
    fake.inspect.reset()
    l.set([bus('2', 30)])
    expect(fake.inspect.annotationsAdded).toBe(0)
  })
})
