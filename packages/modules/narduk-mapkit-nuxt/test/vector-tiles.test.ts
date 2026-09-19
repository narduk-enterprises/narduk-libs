// @vitest-environment happy-dom
import { effectScope, ref } from 'vue'

import { useMapKitVectorTiles } from '../src/runtime/composables/useMapKitVectorTiles'

import type { PmTilesReader, PmTilesSource } from '@narduk-enterprises/narduk-mapkit/client'

function createFakeWorker() {
  const worker = {
    addEventListener: () => {},
    postMessage: () => {},
    removeEventListener: () => {},
    terminate: () => {
      worker.terminated += 1
    },
    terminated: 0,
  }
  return worker
}

function createRecorder() {
  const keys: string[] = []
  const reader = (source: PmTilesSource): PmTilesReader => {
    keys.push(source.getKey())
    return { getZxy: () => Promise.resolve(undefined) }
  }
  return { keys, reader }
}

const style = () => ({ color: '#2563eb', width: 1 })

describe('useMapKitVectorTiles', () => {
  it('refuses to guess between a worker and a main-thread decoder', () => {
    const { reader } = createRecorder()

    expect(() =>
      useMapKitVectorTiles({
        decode: () => Promise.resolve(null),
        reader,
        style,
        url: '/tiles/rivers.pmtiles',
        worker: () => createFakeWorker() as unknown as Worker,
      }),
    ).toThrow(/not both/)
  })

  it('refuses to run without either one', () => {
    const { reader } = createRecorder()

    expect(() => useMapKitVectorTiles({ reader, style, url: '/tiles/rivers.pmtiles' })).toThrow(
      /decode function or a worker/,
    )
  })

  it('builds nothing at all until there is an archive to read', async () => {
    const { keys, reader } = createRecorder()
    const tiles = useMapKitVectorTiles({
      decode: () => Promise.resolve(null),
      reader,
      style,
      url: null,
    })

    expect(keys).toEqual([])
    expect(await tiles.imageForTile(0, 0, 0, 1)).toBeNull()
    expect(tiles.hitTest({ coordinate: { latitude: 45, longitude: -93 }, zoom: 7 })).toBeNull()
  })

  it('rebuilds the archive when the url changes', async () => {
    const url = ref('/tiles/one.pmtiles')
    const { keys, reader } = createRecorder()
    useMapKitVectorTiles({ decode: () => Promise.resolve(null), reader, style, url })

    expect(keys).toHaveLength(1)
    url.value = '/tiles/two.pmtiles'
    await Promise.resolve()

    expect(keys).toHaveLength(2)
    expect(keys[1]).toContain('two.pmtiles')
  })

  it('repaints a style change from the decoded tiles rather than refetching', async () => {
    const paint = ref(style)
    const { keys, reader } = createRecorder()
    useMapKitVectorTiles({
      decode: () => Promise.resolve(null),
      reader,
      style: paint,
      url: '/tiles/rivers.pmtiles',
    })

    paint.value = () => ({ color: '#dc2626', width: 3 })
    await Promise.resolve()

    // One archive, one fetch source: restyling is not a reason to re-read it.
    expect(keys).toHaveLength(1)
  })

  it('builds the decoder worker once and terminates it with the scope', () => {
    const { reader } = createRecorder()
    const workers: Array<ReturnType<typeof createFakeWorker>> = []
    const url = ref('/tiles/one.pmtiles')
    const scope = effectScope()

    scope.run(() => {
      useMapKitVectorTiles({
        reader,
        style,
        url,
        worker: () => {
          const worker = createFakeWorker()
          workers.push(worker)
          return worker as unknown as Worker
        },
      })
    })
    url.value = '/tiles/two.pmtiles'

    // The archive was swapped; the worker decoding its tiles was not.
    expect(workers).toHaveLength(1)
    expect(workers[0]?.terminated).toBe(0)

    scope.stop()

    expect(workers[0]?.terminated).toBe(1)
  })

  it('reports nothing under a tap until a tile has been decoded', () => {
    const { reader } = createRecorder()
    const tiles = useMapKitVectorTiles({
      decode: () => Promise.resolve(null),
      reader,
      style,
      url: '/tiles/rivers.pmtiles',
    })

    expect(
      tiles.hitTest({ coordinate: { latitude: 44.94, longitude: -93.09 }, zoom: 7 }),
    ).toBeNull()
    expect(tiles.cacheBytes.value).toBe(0)
  })
})
