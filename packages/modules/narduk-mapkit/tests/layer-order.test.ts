/**
 * Overlay draw order (narduk-libs#402) and the single-clock crossfade
 * (narduk-libs#421 §d), driven through the real `MapKitLayerRegistry` against a
 * map handle that models MapKit's own `tileOverlays` array.
 */
import { crossfadeMapKitOverlayOpacity } from '../src/client/runtime.js'
import { MapKitLayerRegistry } from '../src/client/index.js'

import type { MapKitLayerDescriptor, MapKitLayerMapHandle } from '../src/client/index.js'
import type { MapKitTileOverlaySource } from '../src/client/index.js'

class TileOverlay {
  opacity: number

  constructor(
    readonly urlTemplate: MapKitTileOverlaySource<unknown>,
    readonly options: Record<string, unknown> = {},
  ) {
    this.opacity = typeof options.opacity === 'number' ? options.opacity : 1
  }
}

const mapkit = { TileOverlay }

/** Models MapKit's own map: `addTileOverlay` appends, `tileOverlays` is writable. */
class OrderedMapHandle implements MapKitLayerMapHandle<TileOverlay> {
  tileOverlays: TileOverlay[] = []

  addTileOverlay(overlay: TileOverlay): void {
    if (!this.tileOverlays.includes(overlay)) this.tileOverlays.push(overlay)
  }

  removeTileOverlay(overlay: TileOverlay): void {
    this.tileOverlays = this.tileOverlays.filter((candidate) => candidate !== overlay)
  }
}

/** The 2.0.x-era handle, and the gonogo case: no `tileOverlays` at all. */
class MethodOnlyMapHandle implements MapKitLayerMapHandle<TileOverlay> {
  readonly attached: TileOverlay[] = []

  addTileOverlay(overlay: TileOverlay): void {
    this.attached.push(overlay)
  }

  removeTileOverlay(overlay: TileOverlay): void {
    const index = this.attached.indexOf(overlay)
    if (index >= 0) this.attached.splice(index, 1)
  }
}

function urlLayer(id: string, urlTemplate: string, order?: number): MapKitLayerDescriptor {
  return order === undefined ? { id, urlTemplate } : { id, order, urlTemplate }
}

describe('MapKitLayerRegistry overlay ordering (narduk-libs#402)', () => {
  it('keeps a replaced lower layer beneath the layer above it', async () => {
    const map = new OrderedMapHandle()
    const registry = new MapKitLayerRegistry({ crossfadeDurationMs: 0, map, mapkit })

    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png'))
    registry.register(urlLayer('data', '/data/{z}/{x}/{y}.png'))
    const data = registry.get('data')

    // Replacing the BOTTOM layer is the reported defect: addTileOverlay appends,
    // so the new base overlay landed on top of the data layer and hid it.
    await registry.replace('base', urlLayer('base', '/base-v2/{z}/{x}/{y}.png'))

    expect(map.tileOverlays).toStrictEqual([registry.get('base'), data])
    expect(map.tileOverlays.at(-1)).toBe(data)
  })

  it('places layers by explicit descriptor order regardless of registration order', () => {
    const map = new OrderedMapHandle()
    const registry = new MapKitLayerRegistry({ map, mapkit })

    registry.register(urlLayer('data', '/data/{z}/{x}/{y}.png', 10))
    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png', 0))

    expect(map.tileOverlays).toStrictEqual([registry.get('base'), registry.get('data')])
  })

  it('treats reconcile() array position as the draw order', async () => {
    const map = new OrderedMapHandle()
    const registry = new MapKitLayerRegistry({ crossfadeDurationMs: 0, map, mapkit })

    await registry.reconcile([
      urlLayer('base', '/base/{z}/{x}/{y}.png'),
      urlLayer('data', '/data/{z}/{x}/{y}.png'),
    ])
    expect(map.tileOverlays).toStrictEqual([registry.get('base'), registry.get('data')])

    // Change only the BASE source: reconcile() replaces it, and order must hold.
    await registry.reconcile([
      urlLayer('base', '/base-v2/{z}/{x}/{y}.png'),
      urlLayer('data', '/data/{z}/{x}/{y}.png'),
    ])
    expect(map.tileOverlays).toStrictEqual([registry.get('base'), registry.get('data')])
  })

  it('keeps a retiring overlay directly beneath its replacement mid-crossfade', () => {
    const map = new OrderedMapHandle()
    const frames: FrameRequestCallback[] = []
    const registry = new MapKitLayerRegistry({
      crossfadeDurationMs: 400,
      map,
      mapkit,
      now: () => 0,
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame: () => {},
    })

    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png'))
    registry.register(urlLayer('data', '/data/{z}/{x}/{y}.png'))
    const retiringBase = registry.get('base')
    const data = registry.get('data')

    void registry.replace('base', urlLayer('base', '/base-v2/{z}/{x}/{y}.png'))

    // Old base, new base, then data on top -- the array the gonogo consumer had
    // to assemble by hand.
    expect(map.tileOverlays).toStrictEqual([retiringBase, registry.get('base'), data])
  })

  it('leaves overlays the registry does not own alone', () => {
    const map = new OrderedMapHandle()
    const foreign = new TileOverlay('/foreign/{z}/{x}/{y}.png')
    map.addTileOverlay(foreign)
    const registry = new MapKitLayerRegistry({ map, mapkit })

    registry.register(urlLayer('data', '/data/{z}/{x}/{y}.png', 10))
    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png', 0))

    expect(map.tileOverlays).toStrictEqual([foreign, registry.get('base'), registry.get('data')])
  })

  it('exposes the ordered overlay list for a consumer that assigns it itself', () => {
    const map = new MethodOnlyMapHandle()
    const registry = new MapKitLayerRegistry({ map, mapkit })

    registry.register(urlLayer('data', '/data/{z}/{x}/{y}.png', 10))
    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png', 0))

    expect(registry.overlays()).toStrictEqual([registry.get('base'), registry.get('data')])
  })
})

describe('MapKitLayerRegistry null/undefined tolerance (the gonogo case)', () => {
  it('registers and replaces against a handle with no tileOverlays array', async () => {
    const map = new MethodOnlyMapHandle()
    const registry = new MapKitLayerRegistry({ crossfadeDurationMs: 0, map, mapkit })

    registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png'))
    await registry.replace('base', urlLayer('base', '/base-v2/{z}/{x}/{y}.png'))

    expect(map.attached).toStrictEqual([registry.get('base')])
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('degrades to attach order when tileOverlays is %s', (_label, value) => {
    const map: MapKitLayerMapHandle<TileOverlay> = {
      addTileOverlay: () => {},
      removeTileOverlay: () => {},
      tileOverlays: value as TileOverlay[] | null,
    }
    const registry = new MapKitLayerRegistry({ map, mapkit })

    expect(() => registry.register(urlLayer('base', '/base/{z}/{x}/{y}.png'))).not.toThrow()
    expect(registry.list()).toStrictEqual(['base'])
  })
})

describe('crossfade runs on one clock (narduk-libs#421 §d)', () => {
  it('completes when the frame timestamp uses a different epoch than now()', async () => {
    // A real browser hands `requestAnimationFrame` a `performance.now()` stamp
    // (epoch: page load) while `Date.now()` counts from 1970. Reading elapsed
    // time from the frame argument clamped progress to 0 forever.
    let clock = 1_764_000_000_000
    const frames: FrameRequestCallback[] = []
    const next = { opacity: 0 }
    const old = { opacity: 1 }
    const removed: Array<{ opacity: number }> = []

    const controller = crossfadeMapKitOverlayOpacity({
      durationMs: 400,
      nextOverlay: next,
      now: () => clock,
      oldOverlays: [old],
      removeOverlay: (overlay) => removed.push(overlay),
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame: () => {},
      targetOpacity: 1,
    })

    let pageClock = 0
    for (let i = 0; i < 40 && frames.length > 0; i += 1) {
      clock += 16
      pageClock += 16
      frames.shift()?.(pageClock)
    }

    await expect(controller.finished).resolves.toBeUndefined()
    expect(next.opacity).toBe(1)
    expect(removed).toStrictEqual([old])
  })

  it('does not finish before the duration has elapsed on that clock', () => {
    let clock = 5000
    const frames: FrameRequestCallback[] = []
    const next = { opacity: 0 }
    const removed: Array<{ opacity: number }> = []

    crossfadeMapKitOverlayOpacity({
      durationMs: 400,
      nextOverlay: next,
      now: () => clock,
      oldOverlays: [{ opacity: 1 }],
      removeOverlay: (overlay) => removed.push(overlay),
      requestAnimationFrame: (callback) => frames.push(callback),
      cancelAnimationFrame: () => {},
      targetOpacity: 1,
    })

    clock += 200
    frames.shift()?.(1_000_000_000)

    expect(removed).toStrictEqual([])
    expect(next.opacity).toBeGreaterThan(0)
    expect(next.opacity).toBeLessThan(1)
  })
})
