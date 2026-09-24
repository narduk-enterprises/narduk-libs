import { createPmTilesFetchSource, createPmTilesTileSource } from '../src/client/index.js'

import type { PmTilesReader } from '../src/client/index.js'

function createReader(
  tiles: Record<string, ArrayBuffer | undefined>,
  failure?: unknown,
): PmTilesReader {
  return {
    getZxy: (z, x, y) => {
      if (failure) return Promise.reject(failure)
      const data = tiles[`${z}/${x}/${y}`]
      return Promise.resolve(data ? { data } : undefined)
    },
  }
}

function bytes(...values: number[]) {
  return new Uint8Array(values).buffer
}

describe('createPmTilesTileSource', () => {
  it('returns the tile body as bytes', async () => {
    const source = createPmTilesTileSource({ reader: createReader({ '7/31/48': bytes(1, 2, 3) }) })

    await expect(source.getTile(7, 31, 48)).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it('resolves to null for a tile the archive does not hold', async () => {
    const source = createPmTilesTileSource({ reader: createReader({}) })

    await expect(source.getTile(7, 31, 48)).resolves.toBeNull()
  })

  it('reports a failed read instead of throwing into the overlay', async () => {
    const failures: unknown[] = []
    const reason = new Error('range request failed')
    const source = createPmTilesTileSource({
      onError: (value) => failures.push(value),
      reader: createReader({}, reason),
    })

    await expect(source.getTile(7, 31, 48)).resolves.toBeNull()
    expect(failures).toEqual([reason])
  })
})

describe('createPmTilesFetchSource', () => {
  function respond(body: ArrayBuffer, init: { headers?: Record<string, string>; status?: number }) {
    return new Response(body, {
      ...(init.headers ? { headers: init.headers } : {}),
      status: init.status ?? 206,
    })
  }

  it('asks for exactly the requested byte range and reports the archive metadata', async () => {
    const calls: Array<{ range: string | null; url: string }> = []
    const source = createPmTilesFetchSource({
      fetch: (input, init) => {
        const headers = new Headers(init?.headers)
        calls.push({ range: headers.get('range'), url: String(input) })
        return Promise.resolve(
          respond(bytes(9, 9), { headers: { etag: '"v1"', 'cache-control': 'max-age=60' } }),
        )
      },
      url: 'https://data.example/river-network.pmtiles',
    })

    const response = await source.getBytes(16384, 128)

    expect(calls).toEqual([
      { range: 'bytes=16384-16511', url: 'https://data.example/river-network.pmtiles' },
    ])
    expect(new Uint8Array(response.data)).toEqual(new Uint8Array([9, 9]))
    expect(response.etag).toBe('"v1"')
    expect(response.cacheControl).toBe('max-age=60')
    expect(source.getKey()).toBe('https://data.example/river-network.pmtiles')
  })

  it('sends the caller headers and the archive etag', async () => {
    let seen: Headers | undefined
    const source = createPmTilesFetchSource({
      fetch: (_input, init) => {
        seen = new Headers(init?.headers)
        return Promise.resolve(respond(bytes(0), {}))
      },
      headers: { 'x-source': 'riverstatus' },
      url: 'https://data.example/a.pmtiles',
    })

    await source.getBytes(0, 16, undefined, '"v1"')

    expect(seen?.get('x-source')).toBe('riverstatus')
    expect(seen?.get('if-match')).toBe('"v1"')
  })

  it('treats a non-range error status as a failed read', async () => {
    const source = createPmTilesFetchSource({
      fetch: () => Promise.resolve(respond(bytes(0), { status: 403 })),
      url: 'https://data.example/a.pmtiles',
    })

    await expect(source.getBytes(0, 16)).rejects.toThrow('pmtiles range request failed: 403')
  })

  it('requires a url', () => {
    expect(() => createPmTilesFetchSource({ url: '  ' })).toThrow('pmtiles url is required')
  })
})
