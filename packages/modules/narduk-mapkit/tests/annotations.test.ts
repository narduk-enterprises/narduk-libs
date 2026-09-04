import { MapKitAnnotationRegistry } from '../src/client/index.js'

import type { MapKitAnnotationDescriptor } from '../src/client/index.js'

interface FakeAnnotation {
  key: string
  title: string
}

interface FakeAnnotationMap {
  addAnnotations: (annotations: readonly FakeAnnotation[]) => void
  addCalls: FakeAnnotation[][]
  removeAnnotations: (annotations: readonly FakeAnnotation[]) => void
  removeCalls: FakeAnnotation[][]
}

function createFakeAnnotationMap(): FakeAnnotationMap {
  const addCalls: FakeAnnotation[][] = []
  const removeCalls: FakeAnnotation[][] = []
  return {
    addAnnotations: (annotations) => {
      addCalls.push([...annotations])
    },
    addCalls,
    removeAnnotations: (annotations) => {
      removeCalls.push([...annotations])
    },
    removeCalls,
  }
}

function marker(
  key: string,
  signature: string,
  update?: (annotation: FakeAnnotation) => void,
): MapKitAnnotationDescriptor<FakeAnnotation> {
  const descriptor: MapKitAnnotationDescriptor<FakeAnnotation> = {
    create: () => ({ key, title: signature }),
    key,
    signature,
  }
  return update ? { ...descriptor, update } : descriptor
}

describe('MapKitAnnotationRegistry', () => {
  it('creates every key on the first reconcile in one batched add', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })

    const result = registry.reconcile([marker('a', 'a1'), marker('b', 'b1'), marker('c', 'c1')])

    expect(result).toEqual({ added: 3, recreated: 0, removed: 0, unchanged: 0, updated: 0 })
    expect(map.addCalls).toHaveLength(1)
    expect(map.addCalls[0]).toHaveLength(3)
    expect(map.removeCalls).toHaveLength(0)
    expect(registry.size).toBe(3)
    expect(registry.list()).toEqual(['a', 'b', 'c'])
  })

  it('makes no host call at all when the descriptors are identical', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    const descriptors = [marker('a', 'a1'), marker('b', 'b1')]
    registry.reconcile(descriptors)
    map.addCalls.length = 0
    map.removeCalls.length = 0

    const result = registry.reconcile(descriptors)

    expect(map.addCalls).toHaveLength(0)
    expect(map.removeCalls).toHaveLength(0)
    expect(result).toEqual({ added: 0, recreated: 0, removed: 0, unchanged: 2, updated: 0 })
  })

  it('leaves an unchanged signature completely untouched', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    const create = vi.fn(() => ({ key: 'a', title: 'a1' }))
    const update = vi.fn()
    registry.reconcile([{ create, key: 'a', signature: 'a1', update }])
    const original = registry.get('a')
    create.mockClear()

    // A new descriptor object, but the same signature: nothing may happen.
    registry.reconcile([{ create, key: 'a', signature: 'a1', update }])

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(registry.get('a')).toBe(original)
    expect(map.addCalls).toHaveLength(1)
    expect(map.removeCalls).toHaveLength(0)
  })

  it('applies a changed signature in place when an update hook is supplied', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    registry.reconcile([marker('a', 'a1', () => {})])
    const original = registry.get('a')
    map.addCalls.length = 0

    const result = registry.reconcile([
      marker('a', 'a2', (annotation) => {
        annotation.title = 'a2'
      }),
    ])

    expect(result).toEqual({ added: 0, recreated: 0, removed: 0, unchanged: 0, updated: 1 })
    expect(registry.get('a')).toBe(original)
    expect(original?.title).toBe('a2')
    expect(map.addCalls).toHaveLength(0)
    expect(map.removeCalls).toHaveLength(0)
  })

  it('recreates only the changed key when no update hook is supplied', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    registry.reconcile([marker('a', 'a1'), marker('b', 'b1')])
    const stableB = registry.get('b')
    const staleA = registry.get('a')
    map.addCalls.length = 0

    const result = registry.reconcile([marker('a', 'a2'), marker('b', 'b1')])

    expect(result).toEqual({ added: 1, recreated: 1, removed: 1, unchanged: 1, updated: 0 })
    expect(map.removeCalls).toEqual([[staleA]])
    expect(map.addCalls[0]).toEqual([{ key: 'a', title: 'a2' }])
    expect(registry.get('a')).not.toBe(staleA)
    expect(registry.get('b')).toBe(stableB)
  })

  it('batches a mixed add, remove, update, and recreate pass into one call each', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    registry.reconcile([
      marker('keep', 'k1'),
      marker('touch', 't1', () => {}),
      marker('rebuild', 'r1'),
      marker('drop-one', 'd1'),
      marker('drop-two', 'd2'),
    ])
    map.addCalls.length = 0

    const result = registry.reconcile([
      marker('keep', 'k1'),
      marker('touch', 't2', () => {}),
      marker('rebuild', 'r2'),
      marker('new-one', 'n1'),
      marker('new-two', 'n2'),
    ])

    expect(result).toEqual({ added: 3, recreated: 1, removed: 3, unchanged: 1, updated: 1 })
    expect(map.removeCalls).toHaveLength(1)
    expect(map.addCalls).toHaveLength(1)
    expect(map.removeCalls[0]?.map((annotation) => annotation.key)).toEqual([
      'drop-one',
      'drop-two',
      'rebuild',
    ])
    expect(map.addCalls[0]?.map((annotation) => annotation.key)).toEqual([
      'rebuild',
      'new-one',
      'new-two',
    ])
  })

  it('removes every dropped key in one call and skips the empty add', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    registry.reconcile([marker('a', 'a1'), marker('b', 'b1')])
    map.addCalls.length = 0

    const result = registry.reconcile([])

    expect(result).toEqual({ added: 0, recreated: 0, removed: 2, unchanged: 0, updated: 0 })
    expect(map.removeCalls).toHaveLength(1)
    expect(map.addCalls).toHaveLength(0)
    expect(registry.size).toBe(0)
  })

  it('rejects blank and duplicate keys', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })

    expect(() => registry.reconcile([marker('  ', 's')])).toThrow('annotation key is required')
    expect(() => registry.reconcile([marker('a', 'a1'), marker('a', 'a2')])).toThrow(
      'duplicate annotation key "a" in reconcile()',
    )
    expect(map.addCalls).toHaveLength(0)
    expect(registry.size).toBe(0)
  })

  it('registers and unregisters single annotations', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })

    const annotation = registry.register(marker('a', 'a1'))

    expect(registry.has('a')).toBe(true)
    expect(registry.get('a')).toBe(annotation)
    expect(map.addCalls).toEqual([[annotation]])
    expect(() => registry.register(marker('a', 'a2'))).toThrow(
      'annotation "a" is already registered',
    )

    registry.unregister('a')
    registry.unregister('missing')

    expect(registry.has('a')).toBe(false)
    expect(map.removeCalls).toEqual([[annotation]])
  })

  it('clears and destroys, then stays inert', () => {
    const map = createFakeAnnotationMap()
    const registry = new MapKitAnnotationRegistry({ map })
    registry.reconcile([marker('a', 'a1'), marker('b', 'b1')])

    registry.clear()
    expect(map.removeCalls).toHaveLength(1)
    expect(map.removeCalls[0]).toHaveLength(2)
    expect(registry.size).toBe(0)

    registry.clear()
    expect(map.removeCalls).toHaveLength(1)

    registry.reconcile([marker('c', 'c1')])
    registry.destroy()
    registry.destroy()

    expect(registry.destroyed).toBe(true)
    expect(registry.reconcile([marker('d', 'd1')])).toEqual({
      added: 0,
      recreated: 0,
      removed: 0,
      unchanged: 0,
      updated: 0,
    })
    expect(registry.size).toBe(0)
    expect(() => registry.register(marker('d', 'd1'))).toThrow('annotation registry is destroyed')
  })
})
