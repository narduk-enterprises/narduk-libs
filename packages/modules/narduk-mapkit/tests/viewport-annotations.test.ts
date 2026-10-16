import { describe, expect, it, vi } from 'vitest'

import { MapKitViewportAnnotations } from '../src/client/viewport-annotations.js'

interface Stop {
  id: string
  lat: number
  lng: number
  name?: string
}

interface FakeAnnotation {
  id: string
  name?: string
}

function setup(extra: { pinned?: string[]; enterPadding?: number; keepPadding?: number } = {}) {
  const added: string[] = []
  const removed: string[] = []
  const updated: string[] = []
  const manager = new MapKitViewportAnnotations<Stop, FakeAnnotation>({
    create: (item) => {
      added.push(item.id)
      return { id: item.id, ...(item.name ? { name: item.name } : {}) }
    },
    key: (item) => item.id,
    map: {
      addAnnotations: vi.fn(),
      removeAnnotations: (annotations) => {
        removed.push(...annotations.map((annotation) => annotation.id))
      },
    },
    signature: (item) => item.name ?? '',
    update: (annotation, item) => {
      updated.push(item.id)
      annotation.name = item.name as string
    },
    ...(extra.pinned ? { pinned: () => extra.pinned as string[] } : {}),
    ...(extra.enterPadding === undefined ? {} : { enterPadding: extra.enterPadding }),
    ...(extra.keepPadding === undefined ? {} : { keepPadding: extra.keepPadding }),
  })
  return { added, manager, removed, updated }
}

const REGION = { centerLat: 30, centerLng: -88, latDelta: 0.1, lngDelta: 0.1 }
const stop = (id: string, lat: number, lng = -88): Stop => ({ id, lat, lng })

describe('MapKitViewportAnnotations', () => {
  it('holds everything back until the first region is known', () => {
    const { manager } = setup()
    manager.sync([stop('a', 30)], null)
    expect(manager.size).toBe(0)
  })

  it('adds only the stops near the region', () => {
    const { added, manager } = setup()
    const items = [stop('near', 30.01), stop('far', 31)]
    manager.sync(items, REGION)
    expect(added).toStrictEqual(['near'])
    expect(manager.has('far')).toBe(false)
  })

  it('adds a stop just off the edge when it is inside the enter margin', () => {
    const { manager } = setup()
    // The region's edge is 30.05; the 0.25 margin is a quarter of the region (0.025) beyond it.
    manager.sync([stop('edge', 30.07), stop('beyond', 30.08)], REGION)
    expect(manager.keys()).toStrictEqual(['edge'])
  })

  it('has hysteresis: a stop on the map stays past the enter margin, until the keep margin', () => {
    const { manager, removed } = setup()
    manager.sync([stop('a', 30.06)], REGION)
    expect(manager.has('a')).toBe(true)
    // 0.10 away: beyond the enter margin (0.075) but inside the keep margin (0.11).
    manager.sync([stop('a', 30.06)], { ...REGION, centerLat: 29.96 })
    expect(manager.has('a')).toBe(true)
    // 0.16 away: gone.
    manager.sync([stop('a', 30.06)], { ...REGION, centerLat: 29.9 })
    expect(manager.has('a')).toBe(false)
    expect(removed).toStrictEqual(['a'])
    // And coming back needs the tighter enter margin, not the keep margin.
    manager.sync([stop('a', 30.06)], { ...REGION, centerLat: 29.96 })
    expect(manager.has('a')).toBe(false)
  })

  it('does not re-add or touch a stop that is still in view', () => {
    const { added, manager, removed } = setup()
    manager.sync([stop('a', 30.01)], REGION)
    const result = manager.sync([stop('a', 30.01)], REGION)
    expect(added).toStrictEqual(['a'])
    expect(removed).toStrictEqual([])
    expect(result.unchanged).toBe(1)
  })

  it('updates a changed stop in place', () => {
    const { manager, updated } = setup()
    manager.sync([{ ...stop('a', 30.01), name: 'One' }], REGION)
    manager.sync([{ ...stop('a', 30.01), name: 'Two' }], REGION)
    expect(updated).toStrictEqual(['a'])
    expect(manager.get('a')?.name).toBe('Two')
  })

  it('keeps pinned stops wherever the region is', () => {
    const { manager } = setup({ pinned: ['sel'] })
    manager.sync([stop('sel', 45), stop('x', 45.01)], REGION)
    expect(manager.keys()).toStrictEqual(['sel'])
  })

  it('refuses an enter margin wider than the keep margin', () => {
    expect(() => setup({ enterPadding: 0.5, keepPadding: 0.1 })).toThrow()
  })

  it('removes everything on destroy', () => {
    const { manager, removed } = setup()
    manager.sync([stop('a', 30.01), stop('b', 30.02)], REGION)
    manager.destroy()
    expect(removed.sort()).toStrictEqual(['a', 'b'])
  })
})
